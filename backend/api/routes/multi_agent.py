"""REST routes for TTS and multi-agent CRUD/intro endpoints."""

import re
import logging

from fastapi import APIRouter, HTTPException

from model_router import get_task_client, extract_content, task_extra_body
from multi_agent import multi_agent_service
from services.tts_provider import get_tts_provider
from schemas.requests import TTSRequest, AgentConfig, JudgeIntroRequest

logger = logging.getLogger("court-simulator")
router = APIRouter(tags=["multi-agent"])

@router.post("/api/tts")
async def text_to_speech(request: TTSRequest):
    try:
        provider = get_tts_provider()
        audio_data = await provider.synthesize(request.text, request.voice)
        return {"audio": audio_data, "format": provider.audio_format}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# -----------------------------------------------------------------------------
# Multi-Agent REST Endpoints
# -----------------------------------------------------------------------------

@router.get("/api/multi-agent/agents")
async def get_agents():
    """Get all available agents (defaults + custom versions + new custom agents)."""
    try:
        all_agents = multi_agent_service.get_all_agents()
        agents_data = [agent.to_dict() for agent in all_agents]
        return {"agents": agents_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/multi-agent/agents")
async def save_agent(agent: AgentConfig):
    """Save a new version of an agent (Write button)."""
    try:
        saved_agent = multi_agent_service.save_agent_version(agent.model_dump())
        return {"agent": saved_agent.to_dict()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/multi-agent/agents/new")
async def create_new_agent(agent: AgentConfig):
    """Create a completely new agent."""
    try:
        new_agent = multi_agent_service.create_new_agent(agent.model_dump())
        return {"agent": new_agent.to_dict()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/multi-agent/agents/{agent_id}/reset")
async def reset_agent(agent_id: str):
    """Get the original default version of an agent (Reset button)."""
    try:
        original = multi_agent_service.get_original_agent(agent_id)
        if not original:
            raise HTTPException(status_code=404, detail=f"Agent {agent_id} not found")
        return {"agent": original.to_dict()}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/api/multi-agent/agents/{agent_id}")
async def delete_agent(agent_id: str):
    """Delete a custom agent (cannot delete default agents)."""
    try:
        deleted = multi_agent_service.delete_agent(agent_id)
        if not deleted:
            raise HTTPException(
                status_code=400, 
                detail=f"Cannot delete default agent '{agent_id}'. Use Reset instead."
            )
        return {"success": True, "message": f"Agent '{agent_id}' deleted"}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def _extract_final_draft(text: str) -> str:
    """Strip inline reasoning / draft analysis that some models emit as plain text.

    Handles three leak patterns:

    1. Numbered bold sections — DeepSeek-R1 / OpenRouter style:
         "1. **Analyze the case...**\\n..."

    2. Bullet-point constraint checking — inline self-review before or after speech:
         "* 3-5 sentences? Yes (4 sentences)."
         "* \\"We convene to assess...\\" (21 words)"

    3. Everything else: return text unchanged.
    """
    # ── Pattern 2: bullet-point constraint checking ───────────────────────────
    # Detect: lines like "* 3-5 sentences? Yes", "* Under 80 words?",
    # "* "Sentence." (N words)", "* No quotation marks? Yes."
    _BULLET_CHECK = re.compile(
        r'^\*\s+(?:\d+-\d+\s+sentences|Under\s+\d+\s+words|No\s+quotation|\w+.*\?\s*(?:Yes|No|\d))',
        re.MULTILINE | re.IGNORECASE,
    )
    if _BULLET_CHECK.search(text):
        # Priority 1: prose lines that are NOT bullet lines and look like speech
        # (contain a capital letter start and end with sentence-ending punctuation).
        prose_lines = []
        for line in text.splitlines():
            stripped = line.strip()
            if stripped and not stripped.startswith('*') and not stripped.startswith('#'):
                prose_lines.append(stripped)
        prose = ' '.join(prose_lines).strip()
        if len(prose) > 40:
            return prose

        # Priority 2: quoted strings embedded in bullet lines — the model often
        # writes "* \"Sentence.\" (N words)" — extract the quoted fragments.
        quoted = re.findall(r'"([^"]{15,})"', text)
        if quoted:
            return ' '.join(q.strip().rstrip('.') + '.' for q in quoted
                            if not re.search(r'\?\s*(?:Yes|No)', q))

    # ── Pattern 1: numbered bold sections ────────────────────────────────────
    if not re.search(r'Thinking Process|^\d+\.\s+\*\*', text, re.MULTILINE):
        return text

    # Strategy 1a: extract speech blocks between a section header and a metadata line.
    drafts = re.findall(
        r'\d+\.\s+\*\*[^*\n]+\*\*:?\s*([\s\S]+?)(?=\*Word Count|\*Sentence|\*Constraint|\n\d+\.|\Z)',
        text,
    )
    if drafts:
        candidate = drafts[-1].strip().strip('"')
        candidate = re.sub(r'\n\*[^\n]*', '', candidate).strip()
        if len(candidate) > 20:
            return candidate

    # Strategy 1b: take everything after the last bold section header.
    m = re.search(r'\d+\.\s+\*\*[^*\n]+\*\*:?\s*([\s\S]+)$', text)
    if m:
        candidate = m.group(1).strip().strip('"')
        candidate = re.sub(r'\n\*[^\n]*', '', candidate).strip()
        if len(candidate) > 20:
            return candidate

    return text


@router.post("/api/multi-agent/judge-intro")
async def generate_judge_intro(request: JudgeIntroRequest):
    """Generate a judge's opening introduction for the hearing and return TTS audio."""
    client, model = get_task_client("judge_intro")
    if not client:
        # Fallback text when no LLM is available
        fallback = (
            "Good morning, counsel. This court is now in session. "
            "We have reviewed the briefs submitted by both parties. "
            "Counsel for the petitioner, you may proceed with your argument."
        )
        tts_provider = get_tts_provider()
        audio = await tts_provider.synthesize(fallback, voice=request.voice)
        return {"text": fallback, "audio": audio, "format": tts_provider.audio_format}

    # Build a concise list of the key topics if provided
    topics_hint = ""
    if request.agenda_topics:
        topics_hint = (
            "\nThe court is particularly interested in these issues: "
            + "; ".join(request.agenda_topics[:8]) + "."
        )

    system_msg = (
        "You are the Chief Justice of an appellate moot-court panel opening oral argument. "
        "Your response must be ONLY the spoken opening statement itself — 3 to 5 sentences, "
        "under 80 words, formal register, no quotation marks. "
        "Do not include any analysis, self-checks, word counts, bullet points, "
        "revision notes, or commentary of any kind. "
        "Speak the statement directly, as if addressing the courtroom."
    )
    prompt = (
        f"Case summary: {request.case_summary}\n"
        f"{topics_hint}\n\n"
        "Deliver the opening statement now. "
        "Summarise the case in one sentence, note the key issues, "
        "then invite petitioner's counsel to proceed."
    )

    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
            max_tokens=600,
            extra_body=task_extra_body("judge_intro"),
        )
        intro_text = _extract_final_draft(extract_content(resp).strip('"'))
    except Exception as e:
        logger.error("Judge intro generation failed: %s", e)
        intro_text = (
            "Good morning, counsel. This court is now in session. "
            "We have reviewed the briefs and are prepared to hear argument. "
            "Counsel for the petitioner, you may proceed."
        )

    tts_provider = get_tts_provider()
    try:
        audio = await tts_provider.synthesize(intro_text, voice=request.voice)
    except Exception as e:
        logger.error("Judge intro TTS failed: %s", e)
        audio = ""

    return {"text": intro_text, "audio": audio, "format": tts_provider.audio_format}

