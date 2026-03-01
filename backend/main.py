"""
Court Simulator Backend - Streamlined OpenAI Version
"""

import os
import re
import json
import asyncio
import functools
import logging
import base64
import random
from datetime import datetime
from typing import Optional, List
from contextlib import asynccontextmanager

import anyio
import anyio.to_thread

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# Load environment variables from the root .env file
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env"))

from services.judge_engine import JudgeEngine
from services.tts_provider import get_tts_provider
from services.stt_provider import get_stt_provider
from services.case_ingestion import CaseIngestionService
from multi_agent import multi_agent_service, Agent
from projected_timeline import router as projected_timeline_router
from projected_timeline.tracker import create_session
from projected_timeline.mcts import run_projection
from projected_timeline.models import PredictedTopicSets as TrackerTopicSets, HearingTurn as TrackerTurn
from services.judge_engine import get_openai_client
from model_router import get_task_client, log_config as log_model_config

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger('court-simulator')

# -----------------------------------------------------------------------------
# MCTS projection gate constants
# -----------------------------------------------------------------------------

# Don't run MCTS until the speaker has said at least this many words total.
# Before this threshold the remaining-topic pool is the entire agenda (70+ items)
# and MCTS would create an exponential node explosion with no useful signal.
MCTS_MIN_WORDS = 40

# Only re-run MCTS every N sentence-buffer flushes.
# Projection results change slowly; running on every flush wastes CPU
# and — because MCTS is synchronous C-extension work — blocks the event loop.
MCTS_DEBOUNCE_TURNS = 3

# -----------------------------------------------------------------------------
# Models
# -----------------------------------------------------------------------------

class SeedQuestionRequest(BaseModel):
    appellant_brief: str
    appellee_brief: str
    system_prompt: Optional[str] = None

class SynthesisRequest(BaseModel):
    transcript: str
    seed_questions: List[dict]
    brief_summary: str
    asked_questions: List[str] = []
    system_prompt: Optional[str] = None

class SummarizeRequest(BaseModel):
    appellant_brief: str
    appellee_brief: str
    system_prompt: Optional[str] = None

class TTSRequest(BaseModel):
    text: str
    voice: str = 'onyx'

# Multi-Agent Models
class MultiAgentSummarizeRequest(BaseModel):
    user_brief: str
    opposing_brief: str

class AgendaGenerationRequest(BaseModel):
    brief_summary: str

class JudgeIntroRequest(BaseModel):
    case_summary: str
    agenda_topics: List[str] = []
    voice: str = "onyx"

class AgentConfig(BaseModel):
    id: Optional[str] = None
    name: str
    color: str
    description: str
    triggers: List[str]
    example_questions: List[str]
    extra_prompt: str
    version: Optional[int] = None

# -----------------------------------------------------------------------------
# App Setup
# -----------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Court Simulator Backend...")
    logger.info(f"OpenAI API Key configured: {'Yes' if os.getenv('OPENAI_API_KEY') else 'No'}")
    logger.info("Model routing config:")
    log_model_config()
    yield

app = FastAPI(title="Court Simulator API", lifespan=lifespan)

_cors_origins = ["http://localhost:3000", "http://localhost:5173"]
if os.getenv("CORS_ORIGINS"):
    _cors_origins.extend(o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip())

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projected_timeline_router)

# -----------------------------------------------------------------------------
# Connection Manager
# -----------------------------------------------------------------------------

class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}
        self.session_data: dict[str, dict] = {}
    
    async def connect(self, session_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[session_id] = websocket
        if session_id not in self.session_data:
            self.session_data[session_id] = {
                'transcript': '',
                'questions_asked': [],
                'phase': 'OFF_RECORD'
            }
    
    def disconnect(self, session_id: str):
        if session_id in self.active_connections:
            del self.active_connections[session_id]

    async def send_json(self, session_id: str, data: dict):
        if session_id in self.active_connections:
            try:
                await self.active_connections[session_id].send_json(data)
            except Exception as e:
                logger.debug("send_json failed for %s (client disconnected): %s", session_id, e)
                self.disconnect(session_id)

manager = ConnectionManager()
global_judge_engine = JudgeEngine()


# -----------------------------------------------------------------------------
# REST Endpoints
# -----------------------------------------------------------------------------

@app.post("/api/seed-questions")
async def generate_seed_questions(request: SeedQuestionRequest):
    try:
        questions = await global_judge_engine.generate_seed_questions(
            appellant_brief=request.appellant_brief,
            appellee_brief=request.appellee_brief,
            system_prompt=request.system_prompt
        )
        return {"questions": questions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/summarize-briefs")
async def summarize_briefs(request: SummarizeRequest):
    try:
        summary = await global_judge_engine.summarize_briefs(
            appellant_text=request.appellant_brief,
            appellee_text=request.appellee_brief,
            system_prompt=request.system_prompt
        )
        return {"summary": summary}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/synthesize-question")
async def synthesize_question(request: SynthesisRequest):
    try:
        # Pass seed questions as text list for synthesis
        seed_texts = [q.get('text', str(q)) if isinstance(q, dict) else str(q) for q in request.seed_questions]
        result = await global_judge_engine.synthesize_question(
            transcript=request.transcript,
            seed_questions=seed_texts,
            brief_summary=request.brief_summary,
            asked_questions=request.asked_questions,
            system_prompt=request.system_prompt
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/tts")
async def text_to_speech(request: TTSRequest):
    try:
        provider = get_tts_provider()
        audio_data = await provider.synthesize(request.text, request.voice)
        return {"audio": audio_data, "format": provider.audio_format}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/upload-brief")
async def upload_brief(file: UploadFile = File(...), role: str = "appellant"):
    try:
        service = CaseIngestionService()
        content = await file.read()
        return await service.process_pdf(content, role)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# -----------------------------------------------------------------------------
# Multi-Agent REST Endpoints
# -----------------------------------------------------------------------------

@app.get("/api/multi-agent/agents")
async def get_agents():
    """Get all available agents (defaults + custom versions + new custom agents)."""
    try:
        all_agents = multi_agent_service.get_all_agents()
        agents_data = [agent.to_dict() for agent in all_agents]
        return {"agents": agents_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/multi-agent/agents")
async def save_agent(agent: AgentConfig):
    """Save a new version of an agent (Write button)."""
    try:
        saved_agent = multi_agent_service.save_agent_version(agent.model_dump())
        return {"agent": saved_agent.to_dict()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/multi-agent/agents/new")
async def create_new_agent(agent: AgentConfig):
    """Create a completely new agent."""
    try:
        new_agent = multi_agent_service.create_new_agent(agent.model_dump())
        return {"agent": new_agent.to_dict()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/multi-agent/agents/{agent_id}/versions")
async def get_agent_versions(agent_id: str):
    """Get version history for an agent (for Undo functionality)."""
    try:
        versions = multi_agent_service.get_agent_versions(agent_id)
        return {"versions": versions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/multi-agent/agents/{agent_id}/reset")
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

@app.delete("/api/multi-agent/agents/{agent_id}")
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

@app.post("/api/multi-agent/summarize")
async def multi_agent_summarize(request: MultiAgentSummarizeRequest):
    """Generate a summary of both briefs for multi-agent simulation."""
    try:
        summary = await multi_agent_service.generate_brief_summary(
            user_brief=request.user_brief,
            opposing_brief=request.opposing_brief
        )
        return {"summary": summary}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/multi-agent/judge-intro")
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

    prompt = (
        "You are the Chief Justice presiding over an appellate moot-court hearing. "
        "Write a brief, authoritative opening statement (3-5 sentences) to begin the hearing. "
        "Summarize the case in one sentence, note the key issues the court will examine, "
        "and invite counsel for the petitioner to begin.\n\n"
        f"Case summary: {request.case_summary}\n"
        f"{topics_hint}\n\n"
        "Rules:\n"
        "- Be formal but natural, as a real chief justice would speak.\n"
        "- Do NOT use quotation marks around your output.\n"
        "- Keep it under 80 words.\n"
        "- End by inviting the petitioner's counsel to proceed."
    )

    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=200,
        )
        intro_text = resp.choices[0].message.content.strip().strip('"')
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


# -----------------------------------------------------------------------------
# Multi-Agent Connection Manager
# -----------------------------------------------------------------------------

class MultiAgentConnectionManager:
    # Minimum seconds between agent audio interruptions (matches courtroom page cooldown)
    AGENT_INTERRUPT_COOLDOWN_SECONDS = 15
    # Minimum word count before any agent can interrupt
    MIN_WORDS_BEFORE_INTERRUPT = 10

    # Sentence buffer: flush threshold (words) when no punctuation boundary found
    SENTENCE_BUFFER_FLUSH_WORDS = 25

    # Seconds of silence before auto-flushing the sentence buffer
    SILENCE_FLUSH_TIMEOUT = 3.0

    # Regex: split on sentence-ending punctuation followed by whitespace or end-of-string
    _SENTENCE_BOUNDARY_RE = re.compile(r'(?<=[.!?])\s+')

    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}
        self.session_data: dict[str, dict] = {}
    
    async def connect(self, session_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[session_id] = websocket
        if session_id not in self.session_data:
            self.session_data[session_id] = {
                'transcript': '',
                'sentence_buffer': '',    # accumulates STT text until sentence boundary
                'silence_flush_task': None,  # asyncio.Task for silence-timeout flush
                'questions_asked': [],    # List of {agent_id, agent_name, question, color}
                'agents': [],
                'brief_summary': '',
                'phase': 'SETUP',
                'last_agent_interrupt_time': None,  # datetime of last TTS interrupt
                # MCTS projection state
                'projection_flush_count': 0,   # total sentence-buffer flushes processed
                'last_mcts_flush': 0,          # flush count when MCTS last ran
                'last_predicted_next': [],     # cached MCTS result between runs
                # Prevents concurrent agent evaluation storms.
                # asyncio is single-threaded: set this before the first await in
                # check_multi_agent_questions so a second concurrent call sees it.
                '_eval_lock': False,
            }
    
    def disconnect(self, session_id: str):
        # Cancel any pending silence-flush task
        sess = self.session_data.get(session_id, {})
        task = sess.get('silence_flush_task')
        if task and not task.done():
            task.cancel()
        if session_id in self.active_connections:
            del self.active_connections[session_id]
        if session_id in self.session_data:
            del self.session_data[session_id]

    async def send_json(self, session_id: str, data: dict):
        if session_id in self.active_connections:
            try:
                await self.active_connections[session_id].send_json(data)
            except Exception as e:
                logger.debug("send_json failed for %s (client disconnected): %s", session_id, e)
                self.disconnect(session_id)

multi_agent_manager = MultiAgentConnectionManager()

# -----------------------------------------------------------------------------
# WebSocket
# -----------------------------------------------------------------------------

@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await manager.connect(session_id, websocket)
    stt_provider = get_stt_provider()
    tts_provider = get_tts_provider()
    
    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            if "text" in message:
                data = json.loads(message["text"])
                msg_type, payload = data.get("type"), data.get("data", {})

                if msg_type == "config":
                    custom_synthesis = payload.get('synthesis_prompt')
                    if custom_synthesis:
                        preview = (custom_synthesis[:150] + '...') if len(custom_synthesis) > 150 else custom_synthesis
                        logger.info(f"[Judge] Session {session_id}: using CUSTOM synthesis prompt. Preview: {preview.replace(chr(10), ' ')}")
                    else:
                        logger.info(f"[Judge] Session {session_id}: no custom synthesis prompt; using default system prompt")
                    manager.session_data[session_id].update({
                        'config': payload,
                        'seed_questions': payload.get('seed_questions', []),
                        'brief_summary': payload.get('brief_summary', ''),
                        'custom_synthesis_prompt': custom_synthesis
                    })
                
                elif msg_type == "audio":
                    audio_bytes = base64.b64decode(payload.get("audio", ""))
                    if audio_bytes and audio_bytes[:4] == b'\x1a\x45\xdf\xa3':
                        transcript = await stt_provider.transcribe(audio_bytes, "webm")
                        if transcript.strip():
                            manager.session_data[session_id]['transcript'] += " " + transcript
                            await manager.send_json(session_id, {
                                "type": "transcript_update",
                                "data": {"text": transcript}
                            })
                            await check_and_trigger_interrupt(session_id, global_judge_engine, tts_provider)
                
                elif msg_type == "phase_change":
                    manager.session_data[session_id]['phase'] = payload.get("phase")
                    await manager.send_json(session_id, {
                        "type": "phase_update",
                        "data": {"phase": payload.get("phase")}
                    })
    except WebSocketDisconnect:
        manager.disconnect(session_id)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(session_id)

async def check_and_trigger_interrupt(session_id, engine, tts):
    session = manager.session_data.get(session_id, {})
    if session.get('phase') != 'PROCEEDING': return

    custom_prompt = session.get('custom_synthesis_prompt')
    if custom_prompt:
        logger.info(f"[Judge] Interrupt check: using custom synthesis prompt (len={len(custom_prompt)})")
    else:
        logger.info("[Judge] Interrupt check: using default system prompt")
    brief_summary = (session.get('brief_summary') or '').strip()
    seed_questions = session.get('seed_questions') or []
    asked_questions = session.get('questions_asked') or []

    should, question, _ = await engine.should_interrupt(
        session_id,
        session.get('transcript', ''),
        session.get('config'),
        custom_system_prompt=custom_prompt,
        brief_summary=brief_summary if brief_summary else None,
        seed_questions=seed_questions if seed_questions else None,
        asked_questions=asked_questions if asked_questions else None,
    )
    
    if should and question:
        session['questions_asked'].append(question)
        session['last_interrupt_time'] = datetime.now()
        audio = await tts.synthesize(question, voice="onyx")
        await manager.send_json(session_id, {
            "type": "judge_interrupt",
            "data": {"question": question, "audio": audio, "audio_format": tts.audio_format}
        })

# -----------------------------------------------------------------------------
# Multi-Agent WebSocket
# -----------------------------------------------------------------------------

@app.websocket("/ws/multi-agent/{session_id}")
async def multi_agent_websocket(websocket: WebSocket, session_id: str):
    """WebSocket endpoint for multi-agent simulation."""
    await multi_agent_manager.connect(session_id, websocket)
    stt_provider = get_stt_provider()
    
    try:
        while True:
            message = await websocket.receive()
            # Hypercorn (trio backend) returns a disconnect dict instead of raising
            # WebSocketDisconnect when the client closes the connection.
            if message.get("type") == "websocket.disconnect":
                break
            if "text" in message:
                data = json.loads(message["text"])
                msg_type, payload = data.get("type"), data.get("data", {})

                if msg_type == "config":
                    # Initialize session with agents and brief summary
                    agents_data = payload.get('agents', [])
                    agents = [Agent.from_dict(a) for a in agents_data]
                    multi_agent_manager.session_data[session_id].update({
                        'agents': agents,
                        'brief_summary': payload.get('brief_summary', ''),
                        'phase': 'READY'
                    })
                    await multi_agent_manager.send_json(session_id, {
                        "type": "config_ack",
                        "data": {"status": "ready", "agent_count": len(agents)}
                    })
                
                elif msg_type == "audio":
                    audio_bytes = base64.b64decode(payload.get("audio", ""))
                    if audio_bytes and len(audio_bytes) > 100:
                        transcript = await stt_provider.transcribe(audio_bytes, "webm")
                        if transcript.strip():
                            # Always append to the running transcript and notify
                            multi_agent_manager.session_data[session_id]['transcript'] += " " + transcript
                            await multi_agent_manager.send_json(session_id, {
                                "type": "transcript_update",
                                "data": {"text": transcript}
                            })

                            # ── Sentence buffer ─────────────────────────────
                            # Accumulate STT fragments until a sentence boundary
                            # (., !, ?) or a word-count flush threshold is
                            # reached.  This mirrors how a real courtroom lets the
                            # practitioner finish a thought before an agent
                            # interjects, producing more natural interruptions.
                            sess = multi_agent_manager.session_data[session_id]
                            buf = sess['sentence_buffer'] + ' ' + transcript
                            sess['sentence_buffer'] = buf.lstrip()

                            # Cancel any pending silence-flush timer (new audio arrived)
                            old_task = sess.get('silence_flush_task')
                            if old_task and not old_task.done():
                                old_task.cancel()

                            # Split on sentence-ending punctuation
                            parts = multi_agent_manager._SENTENCE_BOUNDARY_RE.split(sess['sentence_buffer'])
                            complete_sentences: list[str] = []

                            if len(parts) > 1:
                                # Everything except the last fragment is a complete sentence
                                complete_sentences = parts[:-1]
                                sess['sentence_buffer'] = parts[-1]
                            elif len(sess['sentence_buffer'].split()) >= multi_agent_manager.SENTENCE_BUFFER_FLUSH_WORDS:
                                # Fallback: no punctuation but buffer is large — flush it
                                complete_sentences = [sess['sentence_buffer']]
                                sess['sentence_buffer'] = ''

                            # Only run tracker + agent interruption when we have
                            # complete sentence(s) — batched into one check.
                            if complete_sentences:
                                flushed = ' '.join(complete_sentences)
                                logger.info("[MultiAgent] Sentence buffer flushed (%d words): %s…",
                                            len(flushed.split()), flushed[:80])
                                tracker_state, predicted_next = await check_tracker_and_counter(session_id, flushed)
                                # Fire-and-forget: agent evaluation can take 10-30s on a
                                # single local GPU.  Awaiting it would block websocket.receive()
                                # for that entire duration, preventing disconnect handling and
                                # causing "Cannot call receive once a disconnect message has
                                # been received" errors.  The _eval_lock inside the function
                                # prevents concurrent duplicate evaluation storms.
                                asyncio.create_task(check_multi_agent_questions(
                                    session_id, tracker_state=tracker_state, predicted_next=predicted_next,
                                ))

                            # Start a silence-flush timer: if no new audio arrives
                            # within SILENCE_FLUSH_TIMEOUT seconds, auto-flush the
                            # remaining buffer so agents can respond to the pause.
                            if sess['sentence_buffer'].strip():
                                async def _silence_flush(sid: str = session_id):
                                    await asyncio.sleep(multi_agent_manager.SILENCE_FLUSH_TIMEOUT)
                                    s = multi_agent_manager.session_data.get(sid, {})
                                    remaining = s.get('sentence_buffer', '').strip()
                                    if remaining and s.get('phase') == 'RECORDING':
                                        logger.info("[MultiAgent] Silence timeout — flushing buffer (%d words): %s…",
                                                    len(remaining.split()), remaining[:80])
                                        s['sentence_buffer'] = ''
                                        try:
                                            ts, pn = await check_tracker_and_counter(sid, remaining)
                                            asyncio.create_task(check_multi_agent_questions(
                                                sid, tracker_state=ts, predicted_next=pn,
                                            ))
                                        except Exception as exc:
                                            logger.warning("[MultiAgent] Silence flush failed: %s", exc)
                                sess['silence_flush_task'] = asyncio.create_task(_silence_flush())
                
                elif msg_type == "phase_change":
                    new_phase = payload.get("phase")
                    sess = multi_agent_manager.session_data[session_id]

                    # Flush any remaining sentence buffer when leaving RECORDING
                    if sess.get('phase') == 'RECORDING' and new_phase != 'RECORDING':
                        remaining = sess.get('sentence_buffer', '').strip()
                        if remaining:
                            logger.info("[MultiAgent] Phase→%s: flushing remaining buffer (%d words)",
                                        new_phase, len(remaining.split()))
                            sess['sentence_buffer'] = ''
                            tracker_state, predicted_next = await check_tracker_and_counter(session_id, remaining)
                            asyncio.create_task(check_multi_agent_questions(
                                session_id, tracker_state=tracker_state, predicted_next=predicted_next,
                            ))

                    sess['phase'] = new_phase
                    await multi_agent_manager.send_json(session_id, {
                        "type": "phase_update",
                        "data": {"phase": new_phase}
                    })
                
                elif msg_type == "set_agenda":
                    pts_raw      = payload.get("predicted_topic_sets")
                    agenda_items = payload.get("agenda_items", [])

                    # Build reverse lookup: topic_title → {agenda_id, agent_id, description}
                    topic_map: dict = {}
                    all_topics: list = []
                    for item in agenda_items:
                        for t in item.get("topics", []):
                            topic_map[t["title"]] = {
                                "agenda_id":   item["id"],
                                "agent_id":    item.get("agentId"),
                                "description": t.get("description", ""),
                            }
                            all_topics.append({"title": t["title"], "description": t.get("description", "")})

                    tracker = None
                    if pts_raw:
                        try:
                            tracker = create_session(TrackerTopicSets(**pts_raw))
                        except Exception as e:
                            logger.warning("Tracker init failed: %s", e)

                    multi_agent_manager.session_data[session_id].update({
                        "tracker":          tracker,
                        "topic_map":        topic_map,
                        "all_topics":       all_topics,
                        "addressed_titles": set(),
                        "case_summary":     pts_raw.get("case_summary", "") if pts_raw else "",
                    })
                    logger.info(
                        "[MultiAgent] set_agenda: tracker_ready=%s, topics_indexed=%d",
                        tracker is not None, len(topic_map),
                    )
                    await multi_agent_manager.send_json(session_id, {
                        "type": "agenda_set_ack",
                        "data": {"tracker_ready": tracker is not None, "topics_indexed": len(topic_map)},
                    })

                elif msg_type == "update_agents":
                    # Allow updating agents mid-session
                    agents_data = payload.get('agents', [])
                    agents = [Agent.from_dict(a) for a in agents_data]
                    multi_agent_manager.session_data[session_id]['agents'] = agents
                    await multi_agent_manager.send_json(session_id, {
                        "type": "agents_updated",
                        "data": {"agent_count": len(agents)}
                    })

    except WebSocketDisconnect:
        multi_agent_manager.disconnect(session_id)
    except Exception as e:
        logger.error(f"Multi-agent WebSocket error: {e}")
        multi_agent_manager.disconnect(session_id)


async def generate_counter_argument(
    agent,
    topic_title: str,
    topic_description: str,
    recent_utterance: str,
    brief_summary: str,
) -> str:
    """Generate a 1-2 sentence counter-argument from an agent's perspective."""
    client, model = get_task_client("counter_argument")
    if not client:
        return ""
    prompt = (
        f"You are {agent.name}. {agent.description}\n"
        f"The speaker just addressed the topic: \"{topic_title}\"\n"
        f"Topic context: {topic_description}\n"
        f"Their argument: \"{recent_utterance}\"\n\n"
        f"Case summary: {brief_summary}\n\n"
        "Provide a sharp 1-2 sentence counter-argument or probing follow-up "
        "from your perspective. Be direct and specific to the topic."
    )
    resp = await client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.7,
        max_tokens=150,
    )
    return resp.choices[0].message.content.strip()


def _format_agenda_confidences(state) -> list:
    """Serialise TrackerStateResponse.agenda_confidences to a JSON-safe list."""
    return [
        {
            "prediction_id": ac.prediction_id,
            "lens": ac.lens,
            "confidence": ac.confidence,
            "topics_coverage": [
                {
                    "order": tc.order,
                    "title": tc.title,
                    "addressed": tc.addressed,
                    "address_turn": tc.address_turn,
                    "quality": tc.quality,
                }
                for tc in ac.topics_coverage
            ],
            "uncovered_titles": ac.uncovered_titles,
            "weak_titles": ac.weak_titles,
        }
        for ac in state.agenda_confidences
    ]


def _build_quality_map(state) -> dict[str, float]:
    """Extract title→quality mapping from the best-matching agenda.

    Used to feed live quality scores into MCTS projection so the tree
    gravitates toward topics the advocate argued weakly or hasn't addressed.
    """
    best = next(
        (ac for ac in state.agenda_confidences
         if ac.prediction_id == state.best_prediction_id),
        None,
    )
    if not best:
        return {}
    return {
        tc.title: tc.quality
        for tc in best.topics_coverage
        if tc.addressed   # only include addressed topics; unaddressed = absent → urgency
    }


def _build_trajectory_context(state, predicted_next: list) -> dict | None:
    """Build the trajectory_context dict passed to agent question prompts."""
    best = next(
        (ac for ac in state.agenda_confidences
         if ac.prediction_id == state.best_prediction_id),
        None,
    )
    if not best:
        return None
    return {
        "current_lens":    best.lens,
        "uncovered_topics": best.uncovered_titles,
        "weak_topics":     best.weak_titles,
        "predicted_next":   predicted_next,
    }


async def check_tracker_and_counter(session_id: str, utterance: str):
    """Update the trajectory tracker, conditionally run MCTS re-projection, and fire counter-arguments.

    Key optimisations vs. the original:
    - tracker.update() is now synchronous (embedding + heuristic quality only).
    - LLM quality refinement is scheduled as a fire-and-forget background task.
    - MCTS projection runs in a thread pool (anyio.to_thread.run_sync) so it
      never blocks the asyncio event loop.
    - MCTS is gated behind MCTS_MIN_WORDS and debounced every MCTS_DEBOUNCE_TURNS
      flushes; stale results are reused between runs.

    Returns (tracker_state, predicted_next).
    """
    session = multi_agent_manager.session_data.get(session_id, {})
    tracker = session.get("tracker")
    if not tracker or not utterance.strip():
        return None, session.get("last_predicted_next", [])

    # ── Tracker update (now synchronous — no LLM call inside) ─────────────
    state, refinement_args = tracker.update(TrackerTurn(speaker="petitioner", utterance=utterance))

    # Schedule LLM quality refinement as a background coroutine.
    # It runs on the event loop after this call returns so it never delays
    # the agent-question path.
    if refinement_args:
        asyncio.create_task(tracker.schedule_quality_refinement(*refinement_args))

    # ── Update addressed-topic set ─────────────────────────────────────────
    addressed = session.get("addressed_titles", set())
    if state.last_human_matched_topic:
        addressed.add(state.last_human_matched_topic)
        session["addressed_titles"] = addressed

    all_topics = session.get("all_topics", [])
    remaining  = [t for t in all_topics if t["title"] not in addressed]
    root_label = session.get("case_summary", "")
    quality_map = _build_quality_map(state)

    # ── MCTS gate: skip if not enough context or too soon since last run ───
    word_count       = len(session.get("transcript", "").split())
    flush_count      = session.get("projection_flush_count", 0) + 1
    session["projection_flush_count"] = flush_count
    last_mcts_flush  = session.get("last_mcts_flush", -MCTS_DEBOUNCE_TURNS)
    since_last_mcts  = flush_count - last_mcts_flush

    run_mcts = (
        word_count >= MCTS_MIN_WORDS
        and since_last_mcts >= MCTS_DEBOUNCE_TURNS
        and len(remaining) >= 2
    )

    predicted_next = session.get("last_predicted_next", [])
    mcts_tree: dict | None = None

    if run_mcts:
        session["last_mcts_flush"] = flush_count
        try:
            # Run CPU-bound MCTS in a thread so the event loop stays free.
            # anyio.to_thread.run_sync works with both asyncio and trio backends.
            proj_fn = functools.partial(
                run_projection,
                remaining,
                root_label=root_label,
                quality_map=quality_map,
            )
            predicted_next, mcts_tree = await anyio.to_thread.run_sync(proj_fn)
            session["last_predicted_next"] = predicted_next
            logger.info(
                "[MCTS] Projection ran (words=%d, flush=%d, remaining=%d) → %d topics",
                word_count, flush_count, len(remaining), len(predicted_next),
            )
        except Exception as e:
            logger.warning("MCTS projection failed: %s", e)
    else:
        reason = (
            f"words={word_count}<{MCTS_MIN_WORDS}" if word_count < MCTS_MIN_WORDS
            else f"debounce ({since_last_mcts}/{MCTS_DEBOUNCE_TURNS} flushes)"
        )
        logger.debug("[MCTS] Skipped projection (%s), reusing cached %d topics", reason, len(predicted_next))

    # ── Send agenda update to frontend ────────────────────────────────────
    await multi_agent_manager.send_json(session_id, {
        "type": "agenda_update",
        "data": {
            "best_prediction_id":       state.best_prediction_id,
            "agenda_confidences":       _format_agenda_confidences(state),
            "last_human_matched_topic": state.last_human_matched_topic,
            "predicted_next_topics":    predicted_next,
            "mcts_tree":                mcts_tree,
            "regeneration_needed":      state.regeneration_needed,
        },
    })

    # ── Counter-argument: fire-and-forget ─────────────────────────────────
    matched = state.last_human_matched_topic
    if matched:
        async def _fire_counter(sid, matched_topic, topic_info, agent, utt, brief_summary):
            try:
                counter = await generate_counter_argument(
                    agent=agent,
                    topic_title=matched_topic,
                    topic_description=topic_info.get("description", "") if topic_info else "",
                    recent_utterance=utt,
                    brief_summary=brief_summary,
                )
                if counter:
                    await multi_agent_manager.send_json(sid, {
                        "type": "agent_counter_argument",
                        "data": {
                            "agent_id":         agent.id,
                            "agent_name":       agent.name,
                            "color":            agent.color,
                            "topic":            matched_topic,
                            "counter_argument": counter,
                            "timestamp":        datetime.now().isoformat(),
                        },
                    })
            except Exception as e:
                logger.error("Counter-argument generation failed: %s", e)

        topic_info = session.get("topic_map", {}).get(matched)
        agent = None

        if topic_info and topic_info.get("agent_id"):
            agent = next(
                (a for a in session.get("agents", []) if a.id == topic_info["agent_id"]),
                None,
            )

        if not agent:
            agents = session.get("agents", [])
            topic_lower = matched.lower()
            desc_lower  = (topic_info.get("description", "") if topic_info else "").lower()
            best_score, best_agent = 0, None
            for a in agents:
                score = sum(
                    1 for t in (a.triggers if hasattr(a, 'triggers') else [])
                    if t.lower() in topic_lower or t.lower() in desc_lower
                )
                if score > best_score:
                    best_score, best_agent = score, a
            agent = best_agent or (random.choice(agents) if agents else None)

        if agent:
            asyncio.create_task(_fire_counter(
                session_id, matched, topic_info, agent, utterance,
                session.get("brief_summary", ""),
            ))

    return state, predicted_next


async def check_multi_agent_questions(session_id: str, tracker_state=None, predicted_next=None):
    """Check each agent to see if they want to ask a question.

    When tracker_state is supplied (from check_tracker_and_counter), agents
    receive trajectory context so they can probe uncovered topics and align
    with the dominant judicial lens.  After each agent question the tracker is
    updated as a judge turn, keeping confidence scores and MCTS projections
    consistent with what the simulated panel is actually asking.

    Interruption logic (mirrors courtroom page):
    - Hard cooldown: no agent can interrupt within AGENT_INTERRUPT_COOLDOWN_SECONDS
      of the last agent interrupt.
    - Minimum speech: at least MIN_WORDS_BEFORE_INTERRUPT words must be in the
      transcript before any agent fires.
    - One-per-cycle: only the first agent that wants to ask fires (prevents
      overlapping TTS).  The winning agent's question is synthesized to TTS
      audio and sent alongside the text.
    """
    session = multi_agent_manager.session_data.get(session_id, {})

    # ── Hard constraints — all synchronous, no lock needed ────────────────
    phase = session.get('phase')
    if phase != 'RECORDING':
        logger.debug("[MultiAgent] Skip interrupt check — phase=%s (need RECORDING)", phase)
        return

    transcript = session.get('transcript', '')
    word_count = len(transcript.strip().split())
    if word_count < multi_agent_manager.MIN_WORDS_BEFORE_INTERRUPT:
        logger.debug("[MultiAgent] Skip interrupt — only %d words (need %d)",
                     word_count, multi_agent_manager.MIN_WORDS_BEFORE_INTERRUPT)
        return

    last_interrupt = session.get('last_agent_interrupt_time')
    if last_interrupt is not None:
        elapsed = (datetime.now() - last_interrupt).total_seconds()
        if elapsed < multi_agent_manager.AGENT_INTERRUPT_COOLDOWN_SECONDS:
            logger.debug("[MultiAgent] Skip interrupt — cooldown %.1fs / %ds",
                         elapsed, multi_agent_manager.AGENT_INTERRUPT_COOLDOWN_SECONDS)
            return

    # ── Concurrency guard (set after cheap pre-checks, before first await) ──
    # asyncio is single-threaded: check-and-set here is atomic because there
    # is no await between the check and the assignment.  A silence-flush timer
    # firing concurrently with a sentence-boundary flush would otherwise send
    # 2×N LLM requests simultaneously, each serialised on the single GPU.
    if session.get('_eval_lock'):
        logger.debug("[MultiAgent] Skip interrupt — evaluation already in progress")
        return
    session['_eval_lock'] = True

    logger.info("[MultiAgent] Interrupt pre-checks passed (phase=%s, words=%d, agents=%d)",
                phase, word_count, len(session.get('agents', [])))

    agents        = session.get('agents', [])
    brief_summary = session.get('brief_summary', '')
    asked_texts   = [q.get('question', '') for q in session.get('questions_asked', [])]

    # Build initial trajectory context from the supplied tracker state
    trajectory_context = (
        _build_trajectory_context(tracker_state, predicted_next or [])
        if tracker_state else None
    )

    # ── Agent evaluation — all agents concurrently, first yes wins ───────
    # anyio task groups (trio-compatible structured concurrency).
    # Each slot is pre-filled with a "no" sentinel so ordering is preserved
    # even if tasks complete out of order.
    # try/finally guarantees _eval_lock is released even if the task group
    # or TTS raises an unexpected exception.
    results: list = [(a, False, None) for a in agents]

    async def _eval_agent(idx: int, agent) -> None:
        try:
            logger.info("[MultiAgent] Evaluating agent '%s' (id=%s) for interrupt…", agent.name, agent.id)
            should_ask, question = await multi_agent_service.analyze_agent_question(
                agent=agent,
                transcript=transcript,
                brief_summary=brief_summary,
                questions_already_asked=asked_texts,
                trajectory_context=trajectory_context,
            )
            logger.info("[MultiAgent] Agent '%s' → should_ask=%s, question=%s",
                        agent.name, should_ask, (question[:60] + '…') if question else None)
            results[idx] = (agent, should_ask, question)
        except Exception as e:
            logger.error("Error checking agent %s: %s", agent.name, e)
            # results[idx] stays (agent, False, None)

    try:
        async with anyio.create_task_group() as tg:
            for i, agent in enumerate(agents):
                tg.start_soon(_eval_agent, i, agent)

        # Pick the first agent (by original list order) that wants to interrupt
        winner_agent, winner_question = None, None
        for agent, should_ask, question in results:
            if should_ask and question:
                winner_agent, winner_question = agent, question
                break

        if winner_agent and winner_question:
            # Mark interrupt time immediately to prevent overlapping calls
            session['last_agent_interrupt_time'] = datetime.now()

            # Synthesize TTS audio for the agent's question
            audio_b64 = ""
            audio_format = "opus"
            try:
                tts = get_tts_provider()
                audio_b64 = await tts.synthesize(winner_question)
                audio_format = tts.audio_format
            except Exception as e:
                logger.warning("[MultiAgent] TTS synthesis failed for %s: %s", winner_agent.name, e)

            question_data = {
                "agent_id":     winner_agent.id,
                "agent_name":   winner_agent.name,
                "color":        winner_agent.color,
                "question":     winner_question,
                "timestamp":    datetime.now().isoformat(),
                "audio":        audio_b64,
                "audio_format": audio_format,
            }
            session['questions_asked'].append(question_data)

            await multi_agent_manager.send_json(session_id, {
                "type": "agent_question",
                "data": question_data,
            })
            logger.info("[MultiAgent] %s interrupted: %s…", winner_agent.name, winner_question[:60])

            # Feed the agent question into the tracker as a judge turn (sync, no LLM)
            tracker = session.get("tracker")
            if tracker:
                try:
                    new_state, _ = tracker.update(TrackerTurn(speaker="judge", utterance=winner_question))
                    new_predicted = session.get("last_predicted_next", [])
                    await multi_agent_manager.send_json(session_id, {
                        "type": "agenda_update",
                        "data": {
                            "best_prediction_id":       new_state.best_prediction_id,
                            "agenda_confidences":       _format_agenda_confidences(new_state),
                            "last_human_matched_topic": new_state.last_human_matched_topic,
                            "predicted_next_topics":    new_predicted,
                            "mcts_tree":                None,
                            "triggered_by":             f"agent:{winner_agent.id}",
                            "regeneration_needed":      new_state.regeneration_needed,
                        },
                    })
                except Exception as e:
                    logger.warning("Tracker update from agent question failed: %s", e)

    finally:
        # Always release the lock so the next sentence flush can evaluate.
        if session:
            session['_eval_lock'] = False


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
