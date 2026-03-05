"""
Court Simulator Backend - Streamlined OpenAI Version
"""

import os
import re
import json
import time
import functools
import logging
import base64
import random
from datetime import datetime
from typing import Optional, List
from contextlib import asynccontextmanager

import anyio
import anyio.to_thread
import httpx

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# Load environment variables from the root .env file
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env"))

from services.judge_engine import JudgeEngine
from services.opponent_engine import OpponentEngine
from services.tts_provider import get_tts_provider
from services.stt_provider import get_stt_provider
from services.case_ingestion import CaseIngestionService
from multi_agent import multi_agent_service, Agent
from projected_timeline import router as projected_timeline_router
from projected_timeline.tracker import create_session
from projected_timeline.mcts import run_projection
from projected_timeline.models import PredictedTopicSets as TrackerTopicSets, HearingTurn as TrackerTurn
from model_router import (
    get_task_client,
    log_config as log_model_config,
    probe_all_tiers,
    _background_reachability_refresh,
    apply_runtime_override,
    clear_runtime_override,
    ModelTier,
    extract_content,
    task_extra_body,
)
from services.judge_config import (
    load_config as load_judge_config,
    save_config as save_judge_config,
    get_default_config as get_default_judge_config,
    RewardDimension as JudgeRewardDimension,
    ExternalLLMConfig as JudgeExternalLLMConfig,
    JudgeConfig,
    config_to_dict as judge_config_to_dict,
)
from services.opponent_config import (
    load_config as load_opponent_config,
    save_config as save_opponent_config,
    get_default_config as get_default_opponent_config,
    OpponentConfig,
    config_to_dict as opponent_config_to_dict,
)
from services.media_config import (
    load_tts_config, save_tts_config,
    get_default_tts_config,
    load_stt_config, save_stt_config,
    get_default_stt_config,
    TTSConfig, STTConfig,
    config_to_dict as media_config_to_dict,
)
from services.model_config import (
    load_model_config, save_model_config,
    get_default_model_config,
    ModelRuntimeConfig, TierConfig,
    config_to_dict as model_config_to_dict,
)

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

# Sparse MCTS: once any topic in the best agenda reaches this quality,
# expand all_topics to include the full candidate pool so future MCTS
# projections operate over the deeper topic set.
EXPANSION_QUALITY_THRESHOLD = 0.5

# Evict WS sessions that have been idle for this long (network-drop guard).
_SESSION_TTL = 3600.0  # 1 hour

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

class RewardDimensionModel(BaseModel):
    name: str
    weight: float
    description: str

class ExternalLLMConfigModel(BaseModel):
    enabled: bool = False
    base_url: str = ""
    api_key: str = ""
    model: str = ""
    tier_override: str = "LARGE"

class JudgeConfigRequest(BaseModel):
    judge_prompt: str
    scoring_prompt_template: str
    reward_dimensions: List[RewardDimensionModel]
    external_llm: ExternalLLMConfigModel = ExternalLLMConfigModel()

class OpponentConfigRequest(BaseModel):
    system_prompt: str
    aggressiveness: float = 0.7
    enabled_types: List[str] = ["rebuttal", "exploitation", "affirmative"]
    voice_id: str = ""

class TTSConfigRequest(BaseModel):
    enabled: bool = True
    api_key: str = ""
    base_url: str = ""
    voice: str = "onyx"
    model: str = "tts-1"

class STTConfigRequest(BaseModel):
    provider: str = "openai"
    api_key: str = ""
    base_url: str = ""
    whisper_model: str = "medium"
    device: str = "cuda"
    compute_type: str = "float16"

class TierConfigRequest(BaseModel):
    enabled: bool = False
    base_url: str = ""
    api_key: str = ""
    model: str = ""

class ModelRuntimeConfigRequest(BaseModel):
    large: TierConfigRequest = TierConfigRequest()
    small: TierConfigRequest = TierConfigRequest()
    tiny:  TierConfigRequest = TierConfigRequest()

# -----------------------------------------------------------------------------
# App Setup
# -----------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("Starting Court Simulator Backend...")
    logger.info(f"OpenAI API Key configured: {'Yes' if os.getenv('OPENAI_API_KEY') else 'No'}")
    logger.info("Model routing config:")
    log_model_config()
    # Probe all tier URLs once at startup (non-blocking httpx) so every
    # subsequent LLM call is just a cache lookup with no network overhead.
    await probe_all_tiers()

    async def _background_session_evict() -> None:
        """Periodically evict WS sessions that were dropped without a clean disconnect."""
        while True:
            await anyio.sleep(300)   # every 5 minutes
            manager.evict_stale()
            multi_agent_manager.evict_stale()

    async with anyio.create_task_group() as _lifespan_tg:
        _lifespan_tg.start_soon(_background_reachability_refresh)
        _lifespan_tg.start_soon(_background_session_evict)
        yield
        _lifespan_tg.cancel_scope.cancel()

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
        # setdefault is atomic in CPython — safe against rapid reconnects that
        # race past the await above and both attempt to initialise the session.
        self.session_data.setdefault(session_id, {
            'transcript': '',
            'questions_asked': [],
            'phase': 'OFF_RECORD',
            '_last_active': time.monotonic(),
        })

    def touch(self, session_id: str) -> None:
        """Update last-active timestamp so TTL eviction doesn't expire live sessions."""
        sess = self.session_data.get(session_id)
        if sess is not None:
            sess['_last_active'] = time.monotonic()

    def evict_stale(self) -> None:
        """Remove sessions idle longer than _SESSION_TTL (network-drop guard)."""
        now = time.monotonic()
        stale = [
            sid for sid, s in self.session_data.items()
            if now - s.get('_last_active', now) > _SESSION_TTL
            and sid not in self.active_connections
        ]
        for sid in stale:
            del self.session_data[sid]
            logger.info("Evicted stale judge session %s", sid)

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
global_opponent_engine = OpponentEngine()


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

@app.get("/api/scores/{session_id}")
async def get_scores(session_id: str):
    """Return cumulative argument scores for both sides of a judge session."""
    return global_judge_engine.get_session_scores(session_id)

@app.get("/api/opponent/{session_id}")
async def get_opponent_summary(session_id: str):
    """Return the opponent engine's argument history for a session."""
    return global_opponent_engine.get_session_summary(session_id)

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


def _extract_final_draft(text: str) -> str:
    """Strip inline 'Thinking Process' / draft analysis that some models emit as plain text.

    Some thinking-capable models (e.g. DeepSeek-R1 via OpenRouter) write their
    chain-of-thought as numbered sections ("1. **Analyze...**", "2. **Drafting...**")
    rather than inside <think> tags, so extract_content's tag-stripping won't catch it.
    This function detects that pattern and returns only the last coherent speech block.
    """
    if not re.search(r'Thinking Process|(?m)^\d+\.\s+\*\*', text):
        return text

    # Strategy 1: extract speech blocks that appear between a section header and
    # a metadata line (*Word Count*, *Sentence Count*, *Constraint*, next numbered section).
    drafts = re.findall(
        r'\d+\.\s+\*\*[^*\n]+\*\*:?\s*([\s\S]+?)(?=\*Word Count|\*Sentence|\*Constraint|\n\d+\.|\Z)',
        text,
    )
    if drafts:
        candidate = drafts[-1].strip().strip('"')
        candidate = re.sub(r'\n\*[^\n]*', '', candidate).strip()
        if len(candidate) > 20:
            return candidate

    # Strategy 2: take everything after the last bold section header
    m = re.search(r'\d+\.\s+\*\*[^*\n]+\*\*:?\s*([\s\S]+)$', text)
    if m:
        candidate = m.group(1).strip().strip('"')
        candidate = re.sub(r'\n\*[^\n]*', '', candidate).strip()
        if len(candidate) > 20:
            return candidate

    return text


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

    system_msg = (
        "You are the Chief Justice of an appellate moot-court panel. "
        "Output ONLY the opening statement — no analysis, no revision steps, "
        "no word counts, no commentary. Speak directly and formally."
    )
    prompt = (
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


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

def _redact_api_keys(d):
    """Recursively replace every 'api_key' value with '' before sending to the client."""
    if isinstance(d, dict):
        return {k: ("" if k == "api_key" else _redact_api_keys(v)) for k, v in d.items()}
    return d


# -----------------------------------------------------------------------------
# Judge Configuration endpoints
# -----------------------------------------------------------------------------

@app.get("/api/judge-config")
async def get_judge_config():
    """Return the current judge configuration (loaded from disk)."""
    cfg = await anyio.to_thread.run_sync(load_judge_config)
    return _redact_api_keys(judge_config_to_dict(cfg))


@app.get("/api/judge-config/default")
async def get_default_judge_config_endpoint():
    """Return the hardcoded default judge configuration (never reads disk)."""
    return _redact_api_keys(judge_config_to_dict(get_default_judge_config()))


@app.post("/api/judge-config")
async def save_judge_config_endpoint(req: JudgeConfigRequest):
    """Validate and persist judge configuration; apply/clear runtime LLM overrides."""
    # Validate reward dimensions
    if not req.reward_dimensions:
        raise HTTPException(status_code=422, detail="reward_dimensions must not be empty")
    if any(d.weight <= 0 for d in req.reward_dimensions):
        raise HTTPException(status_code=422, detail="All reward dimension weights must be > 0")
    weight_sum = sum(d.weight for d in req.reward_dimensions)
    if abs(weight_sum - 1.0) > 0.01:
        raise HTTPException(
            status_code=422,
            detail=f"Reward dimension weights must sum to 1.0 (got {weight_sum:.4f})"
        )

    ext = req.external_llm
    if ext.enabled:
        if not ext.base_url.strip():
            raise HTTPException(status_code=422, detail="external_llm.base_url is required when enabled")
        if not ext.api_key.strip():
            raise HTTPException(status_code=422, detail="external_llm.api_key is required when enabled")
        if not ext.model.strip():
            raise HTTPException(status_code=422, detail="external_llm.model is required when enabled")
        if ext.tier_override not in ("LARGE", "SMALL", "BOTH"):
            raise HTTPException(status_code=422, detail="tier_override must be LARGE, SMALL, or BOTH")

    # Build dataclass objects
    cfg = JudgeConfig(
        judge_prompt=req.judge_prompt,
        scoring_prompt_template=req.scoring_prompt_template,
        reward_dimensions=[
            JudgeRewardDimension(name=d.name, weight=d.weight, description=d.description)
            for d in req.reward_dimensions
        ],
        external_llm=JudgeExternalLLMConfig(
            enabled=ext.enabled,
            base_url=ext.base_url,
            api_key=ext.api_key,
            model=ext.model,
            tier_override=ext.tier_override,
        ),
    )

    await anyio.to_thread.run_sync(lambda: save_judge_config(cfg))

    # Apply or clear runtime model-tier overrides
    if ext.enabled:
        tier_map = {
            "LARGE": [ModelTier.LARGE],
            "SMALL": [ModelTier.SMALL],
            "BOTH":  [ModelTier.LARGE, ModelTier.SMALL],
        }
        for tier in tier_map[ext.tier_override]:
            apply_runtime_override(tier, ext.base_url, ext.model, ext.api_key)
    else:
        clear_runtime_override(ModelTier.LARGE)
        clear_runtime_override(ModelTier.SMALL)

    return _redact_api_keys(judge_config_to_dict(cfg))


# -----------------------------------------------------------------------------
# Opponent Configuration endpoints
# -----------------------------------------------------------------------------

@app.get("/api/opponent-config")
async def get_opponent_config():
    """Return the current opponent configuration (loaded from disk)."""
    cfg = await anyio.to_thread.run_sync(load_opponent_config)
    return opponent_config_to_dict(cfg)


@app.get("/api/opponent-config/default")
async def get_default_opponent_config_endpoint():
    """Return the hardcoded default opponent configuration (no disk I/O)."""
    return opponent_config_to_dict(get_default_opponent_config())


@app.post("/api/opponent-config")
async def save_opponent_config_endpoint(req: OpponentConfigRequest):
    """Validate and persist opponent configuration."""
    # Validate aggressiveness range
    if not (0.0 <= req.aggressiveness <= 1.0):
        raise HTTPException(status_code=422, detail="aggressiveness must be between 0.0 and 1.0")

    # Validate enabled_types
    valid_types = {"rebuttal", "exploitation", "affirmative"}
    for t in req.enabled_types:
        if t not in valid_types:
            raise HTTPException(status_code=422, detail=f"Invalid response type: {t}")
    if not req.enabled_types:
        raise HTTPException(status_code=422, detail="At least one response type must be enabled")

    cfg = OpponentConfig(
        system_prompt=req.system_prompt,
        aggressiveness=req.aggressiveness,
        enabled_types=req.enabled_types,
        voice_id=req.voice_id,
    )
    await anyio.to_thread.run_sync(lambda: save_opponent_config(cfg))
    return opponent_config_to_dict(cfg)


# -----------------------------------------------------------------------------
# TTS Configuration endpoints
# -----------------------------------------------------------------------------

@app.get("/api/tts-config")
async def get_tts_config_endpoint():
    cfg = await anyio.to_thread.run_sync(load_tts_config)
    return _redact_api_keys(media_config_to_dict(cfg))

@app.get("/api/tts-config/default")
async def get_default_tts_config_endpoint():
    return _redact_api_keys(media_config_to_dict(get_default_tts_config()))

@app.post("/api/tts-config")
async def save_tts_config_endpoint(req: TTSConfigRequest):
    _openai_voices = {"alloy", "ash", "coral", "echo", "fable", "onyx", "nova", "shimmer", "verse"}
    provider = os.getenv("TTS_PROVIDER", "openai").lower()
    if provider != "cartesia" and req.voice and req.voice not in _openai_voices:
        raise HTTPException(status_code=422, detail=f"voice must be one of {sorted(_openai_voices)}")
    if not req.model.strip():
        raise HTTPException(status_code=422, detail="model must not be empty")
    cfg = TTSConfig(
        enabled=req.enabled,
        api_key=req.api_key,
        base_url=req.base_url,
        voice=req.voice,
        model=req.model,
    )
    await anyio.to_thread.run_sync(lambda: save_tts_config(cfg))
    return _redact_api_keys(media_config_to_dict(cfg))


@app.get("/api/tts/voices")
async def get_tts_voices():
    """Return available TTS voices for the active provider."""
    provider = os.getenv("TTS_PROVIDER", "openai").lower().strip()
    if provider == "cartesia":
        api_key = os.getenv("CARTESIA_API_KEY", "")
        if not api_key:
            return []
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    "https://api.cartesia.ai/voices",
                    headers={"Authorization": f"Bearer {api_key}", "Cartesia-Version": "2024-06-10"},
                )
                resp.raise_for_status()
                return [{"id": v["id"], "name": v["name"]} for v in resp.json()]
        except Exception as e:
            logger.warning("Failed to fetch Cartesia voices: %s", e)
            return []
    # OpenAI / fallback
    return [{"id": n, "name": n.capitalize()}
            for n in ["alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "shimmer", "verse"]]


# -----------------------------------------------------------------------------
# STT Configuration endpoints
# -----------------------------------------------------------------------------

@app.get("/api/stt-config")
async def get_stt_config_endpoint():
    cfg = await anyio.to_thread.run_sync(load_stt_config)
    return _redact_api_keys(media_config_to_dict(cfg))

@app.get("/api/stt-config/default")
async def get_default_stt_config_endpoint():
    return _redact_api_keys(media_config_to_dict(get_default_stt_config()))

@app.post("/api/stt-config")
async def save_stt_config_endpoint(req: STTConfigRequest):
    if req.provider not in ("openai", "local"):
        raise HTTPException(status_code=422, detail="provider must be 'openai' or 'local'")
    valid_local_models = {"tiny", "base", "small", "medium", "large-v3"}
    if req.provider == "local" and req.whisper_model not in valid_local_models:
        raise HTTPException(status_code=422, detail=f"whisper_model must be one of {sorted(valid_local_models)}")
    if req.device not in ("cuda", "cpu"):
        raise HTTPException(status_code=422, detail="device must be 'cuda' or 'cpu'")
    valid_compute = {"float16", "int8_float16", "int8"}
    if req.compute_type not in valid_compute:
        raise HTTPException(status_code=422, detail=f"compute_type must be one of {sorted(valid_compute)}")
    cfg = STTConfig(
        provider=req.provider,
        api_key=req.api_key,
        base_url=req.base_url,
        whisper_model=req.whisper_model,
        device=req.device,
        compute_type=req.compute_type,
    )
    await anyio.to_thread.run_sync(lambda: save_stt_config(cfg))
    return _redact_api_keys(media_config_to_dict(cfg))


# -----------------------------------------------------------------------------
# Model tier runtime configuration endpoints
# -----------------------------------------------------------------------------

@app.get("/api/model-config")
async def get_model_config_endpoint():
    cfg = await anyio.to_thread.run_sync(load_model_config)
    return _redact_api_keys(model_config_to_dict(cfg))

@app.get("/api/model-config/default")
async def get_default_model_config_endpoint():
    return _redact_api_keys(model_config_to_dict(get_default_model_config()))

@app.post("/api/model-config")
async def save_model_config_endpoint(req: ModelRuntimeConfigRequest):
    """Apply per-tier runtime overrides and persist to disk."""
    tier_map = {
        ModelTier.LARGE: req.large,
        ModelTier.SMALL: req.small,
        ModelTier.TINY:  req.tiny,
    }
    for tier, tcfg in tier_map.items():
        if tcfg.enabled:
            if not tcfg.base_url.strip():
                raise HTTPException(status_code=422, detail=f"{tier.value}.base_url is required when enabled")
            if not tcfg.model.strip():
                raise HTTPException(status_code=422, detail=f"{tier.value}.model is required when enabled")
            apply_runtime_override(tier, tcfg.base_url, tcfg.model, tcfg.api_key)
        else:
            clear_runtime_override(tier)

    cfg = ModelRuntimeConfig(
        large=TierConfig(enabled=req.large.enabled, base_url=req.large.base_url,
                         api_key=req.large.api_key, model=req.large.model),
        small=TierConfig(enabled=req.small.enabled, base_url=req.small.base_url,
                         api_key=req.small.api_key, model=req.small.model),
        tiny= TierConfig(enabled=req.tiny.enabled,  base_url=req.tiny.base_url,
                         api_key=req.tiny.api_key,  model=req.tiny.model),
    )
    await anyio.to_thread.run_sync(lambda: save_model_config(cfg))
    return _redact_api_keys(model_config_to_dict(cfg))


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
        # setdefault is atomic in CPython — safe against rapid reconnects.
        self.session_data.setdefault(session_id, {
            'transcript': '',
            'sentence_buffer': '',    # accumulates STT text until sentence boundary
            '_silence_scope': None,   # anyio.CancelScope for the active silence-flush task
            '_tg': None,              # anyio TaskGroup for the WebSocket connection lifetime
            'questions_asked': [],    # List of {agent_id, agent_name, question, color}
            'agents': [],
            'brief_summary': '',
            'phase': 'SETUP',
            'last_agent_interrupt_time': None,  # datetime of last TTS interrupt
            '_last_active': time.monotonic(),   # for TTL eviction (network-drop guard)
            # PCM audio buffer: accumulate small chunks before sending to STT
            '_pcm_buffer': b'',
            # MCTS projection state
            'projection_flush_count': 0,   # total sentence-buffer flushes processed
            'last_mcts_flush': 0,          # flush count when MCTS last ran
            'last_predicted_next': [],     # cached MCTS result between runs
            # anyio.Lock — acquired for the duration of agent evaluation so
            # only one evaluation cycle runs at a time.  move_on_after(30)
            # at the call site prevents a hung LLM call from permanently
            # blocking future evaluations.
            '_eval_lock': anyio.Lock(),
            # anyio.Lock — serialises concurrent calls to check_tracker_and_counter
            # from the receive loop and the silence-flush background task.
            '_tracker_lock': anyio.Lock(),
        })
    
    def touch(self, session_id: str) -> None:
        sess = self.session_data.get(session_id)
        if sess is not None:
            sess['_last_active'] = time.monotonic()

    def evict_stale(self) -> None:
        from services.stt_provider import GladiaLiveProvider
        now = time.monotonic()
        stale = [
            sid for sid, s in self.session_data.items()
            if now - s.get('_last_active', now) > _SESSION_TTL
            and sid not in self.active_connections
        ]
        for sid in stale:
            # Release the Gladia concurrent session slot before dropping state
            stt = self.session_data[sid].get('_stt_provider')
            if isinstance(stt, GladiaLiveProvider):
                stt.stop_session(sid)
            del self.session_data[sid]
            logger.info("Evicted stale multi-agent session %s", sid)

    def disconnect(self, session_id: str):
        # The anyio task group (stored as '_tg') cancels all child tasks
        # (silence flush, agent eval, counter-args) automatically when the
        # WebSocket handler exits.  No manual task cancellation needed here.
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
            manager.touch(session_id)   # keep TTL alive
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

    # Score the current transcript segment.  The interrupt response is already
    # sent above, so latency here only affects the score panel — not the main UX.
    config = session.get('config') or {}
    speaker = config.get('user_position', 'appellant')
    utterance = session.get('transcript', '').strip()
    brief_summary = (session.get('brief_summary') or '').strip() or None
    last_q = ((session.get('questions_asked') or []) + [None])[-1]

    score = await engine.score_argument(
        session_id, speaker, utterance,
        brief_summary=brief_summary,
        judge_question_answered=last_q,
    )
    if score:
        await manager.send_json(session_id, {
            "type": "argument_score",
            "data": {
                "speaker": score.speaker,
                "clarity": round(score.clarity, 1),
                "legal_reasoning": round(score.legal_reasoning, 1),
                "responsiveness": round(score.responsiveness, 1),
                "persuasiveness": round(score.persuasiveness, 1),
                "overall": round(score.overall, 1),
                "feedback": score.feedback,
            },
        })

async def _process_ma_transcript(sid: str, transcript: str) -> None:
    """Process a new STT transcript through the multi-agent pipeline.

    Called by the audio handler (local Whisper path) and the Gladia live
    transcript-drain task so the pipeline logic only lives in one place.
    """
    s = multi_agent_manager.session_data.get(sid)
    if s is None:
        return
    tg = s.get('_tg')

    s['transcript'] = s.get('transcript', '') + ' ' + transcript
    await multi_agent_manager.send_json(sid, {
        "type": "transcript_update",
        "data": {"text": transcript},
    })

    buf = s.get('sentence_buffer', '') + ' ' + transcript
    s['sentence_buffer'] = buf.lstrip()

    # Cancel any pending sentence-silence scope — new words just arrived
    old_scope: anyio.CancelScope | None = s.get('_silence_scope')
    if old_scope is not None:
        old_scope.cancel()

    parts = multi_agent_manager._SENTENCE_BOUNDARY_RE.split(s['sentence_buffer'])
    complete_sentences: list[str] = []
    if len(parts) > 1:
        complete_sentences = parts[:-1]
        s['sentence_buffer'] = parts[-1]
    elif len(s['sentence_buffer'].split()) >= multi_agent_manager.SENTENCE_BUFFER_FLUSH_WORDS:
        complete_sentences = [s['sentence_buffer']]
        s['sentence_buffer'] = ''

    if complete_sentences and tg:
        flushed = ' '.join(complete_sentences)
        logger.info("[MultiAgent] Sentence buffer flushed (%d words): %s…",
                    len(flushed.split()), flushed[:80])
        tracker_state, predicted_next = await check_tracker_and_counter(sid, flushed)

        async def _fire_questions(ts=tracker_state, pn=predicted_next):
            await check_multi_agent_questions(sid, tracker_state=ts, predicted_next=pn)
        tg.start_soon(_fire_questions)

        async def _fire_score(text=flushed):
            s2 = multi_agent_manager.session_data.get(sid, {})
            brief = (s2.get('brief_summary') or '').strip() or None
            last_q_obj = ((s2.get('questions_asked') or []) + [None])[-1]
            last_q_text = last_q_obj.get('question') if last_q_obj else None
            score = await global_judge_engine.score_argument(
                sid, 'appellant', text,
                brief_summary=brief,
                judge_question_answered=last_q_text,
            )
            if score:
                await multi_agent_manager.send_json(sid, {
                    "type": "argument_score",
                    "data": {
                        "speaker": score.speaker,
                        "clarity": round(score.clarity, 1),
                        "legal_reasoning": round(score.legal_reasoning, 1),
                        "responsiveness": round(score.responsiveness, 1),
                        "persuasiveness": round(score.persuasiveness, 1),
                        "overall": round(score.overall, 1),
                        "feedback": score.feedback,
                    },
                })
        tg.start_soon(_fire_score)

        async def _fire_opponent(text=flushed, ts=tracker_state, pn=predicted_next):
            traj_ctx = _build_trajectory_context(ts, pn or []) if ts else None
            opp = await global_opponent_engine.generate_response(
                sid, text, trajectory_context=traj_ctx,
            )
            if opp:
                tts_p = get_tts_provider()
                opp_cfg = await anyio.to_thread.run_sync(load_opponent_config)
                audio_b64 = await tts_p.synthesize(opp.argument, voice=opp_cfg.voice_id or "default")
                await multi_agent_manager.send_json(sid, {
                    "type": "opponent_response",
                    "data": {
                        "response_type": opp.response_type,
                        "argument": opp.argument,
                        "strategy_note": opp.strategy_note,
                        "topic": opp.topic,
                        "strength": round(opp.strength, 1),
                        "timestamp": datetime.now().isoformat(),
                        "audio": audio_b64 or None,
                        "audio_format": tts_p.audio_format if audio_b64 else None,
                    },
                })
        tg.start_soon(_fire_opponent)

    # Sentence-silence timer: flush the remaining buffer if no new text arrives
    if s.get('sentence_buffer', '').strip() and tg:
        new_scope = anyio.CancelScope()
        s['_silence_scope'] = new_scope

        async def _silence_flush(_scope=new_scope):
            with _scope:
                await anyio.sleep(multi_agent_manager.SILENCE_FLUSH_TIMEOUT)
            if _scope.cancelled_caught:
                return
            s2 = multi_agent_manager.session_data.get(sid, {})
            remaining = s2.get('sentence_buffer', '').strip()
            if remaining and s2.get('phase') == 'RECORDING':
                logger.info("[MultiAgent] Silence timeout — flushing buffer (%d words): %s…",
                            len(remaining.split()), remaining[:80])
                s2['sentence_buffer'] = ''
                try:
                    ts, pn = await check_tracker_and_counter(sid, remaining)
                    inner_tg = s2.get('_tg')
                    if inner_tg:
                        async def _fire_silence_questions(ts=ts, pn=pn):
                            await check_multi_agent_questions(
                                sid, tracker_state=ts, predicted_next=pn,
                            )
                        inner_tg.start_soon(_fire_silence_questions)
                except Exception as exc:
                    logger.warning("[MultiAgent] Silence flush failed: %s", exc)

        tg.start_soon(_silence_flush)


# -----------------------------------------------------------------------------
# Multi-Agent WebSocket
# -----------------------------------------------------------------------------

@app.websocket("/ws/multi-agent/{session_id}")
async def multi_agent_websocket(websocket: WebSocket, session_id: str):
    """WebSocket endpoint for multi-agent simulation."""
    await multi_agent_manager.connect(session_id, websocket)
    stt_provider = get_stt_provider()
    # Store provider in session so evict_stale can clean up Gladia sessions
    multi_agent_manager.session_data[session_id]['_stt_provider'] = stt_provider

    try:
        # Open a task group for the lifetime of this WebSocket connection.
        # All fire-and-forget work (agent eval, silence flush, counter-args,
        # quality refinement) is started via tg.start_soon() so it runs
        # concurrently and is automatically cancelled on disconnect.
        async with anyio.create_task_group() as tg:
            multi_agent_manager.session_data[session_id]['_tg'] = tg
            while True:
                message = await websocket.receive()
                # Hypercorn (trio backend) returns a disconnect dict instead of raising
                # WebSocketDisconnect when the client closes the connection.
                if message.get("type") == "websocket.disconnect":
                    break
                multi_agent_manager.touch(session_id)   # keep TTL alive
                if "text" in message:
                    data = json.loads(message["text"])
                    msg_type, payload = data.get("type"), data.get("data", {})

                    if msg_type == "config":
                        # Initialize session with agents and brief summary
                        agents_data = payload.get('agents', [])
                        agents = [Agent.from_dict(a) for a in agents_data]
                        brief_summary = payload.get('brief_summary', '')
                        opposing_brief = payload.get('opposing_brief', '')
                        multi_agent_manager.session_data[session_id].update({
                            'agents': agents,
                            'brief_summary': brief_summary,
                            'opposing_brief': opposing_brief,
                            'phase': 'READY'
                        })
                        # Initialise opponent engine with the opposing brief
                        if opposing_brief:
                            global_opponent_engine.init_session(
                                session_id, opposing_brief, brief_summary,
                            )
                        await multi_agent_manager.send_json(session_id, {
                            "type": "config_ack",
                            "data": {"status": "ready", "agent_count": len(agents)}
                        })

                    elif msg_type == "audio":
                        audio_bytes = base64.b64decode(payload.get("audio", ""))
                        if audio_bytes and len(audio_bytes) > 10:
                            from services.stt_provider import GladiaLiveProvider
                            if isinstance(stt_provider, GladiaLiveProvider):
                                stt_provider.send_audio(session_id, audio_bytes)
                            else:
                                # Batch mode: accumulate PCM chunks (~256 ms each)
                                # into a buffer and transcribe once we have ~2.5 s.
                                from services.stt_provider import pcm_rms_energy
                                _PCM_BUFFER_BYTES = 80000  # ~2.5 s at 16 kHz 16-bit mono
                                _PCM_ENERGY_GATE  = 150    # RMS threshold; silence ≈ 10–50

                                rms = pcm_rms_energy(audio_bytes)
                                sess = multi_agent_manager.session_data[session_id]
                                if rms < _PCM_ENERGY_GATE:
                                    # Silent chunk — if buffer has content, flush it
                                    # (speaker may have paused), otherwise skip.
                                    if len(sess.get('_pcm_buffer', b'')) < 8000:
                                        continue

                                sess['_pcm_buffer'] = sess.get('_pcm_buffer', b'') + audio_bytes
                                if len(sess['_pcm_buffer']) >= _PCM_BUFFER_BYTES:
                                    pcm_chunk = sess['_pcm_buffer']
                                    sess['_pcm_buffer'] = b''
                                    transcript = await stt_provider.transcribe(pcm_chunk, "pcm")
                                    if transcript.strip():
                                        await _process_ma_transcript(session_id, transcript.strip())

                    elif msg_type == "phase_change":
                        new_phase = payload.get("phase")
                        sess = multi_agent_manager.session_data[session_id]

                        # When entering RECORDING with Gladia live: start the live session
                        # and a background task that drains transcript results into the pipeline.
                        if new_phase == 'RECORDING':
                            from services.stt_provider import GladiaLiveProvider
                            if isinstance(stt_provider, GladiaLiveProvider):
                                gladia_ok = await stt_provider.start_session(session_id)

                                if gladia_ok:
                                    async def _drain_gladia(sid: str = session_id):
                                        """Poll Gladia for final transcripts and feed them to the pipeline."""
                                        from services.stt_provider import GladiaLiveProvider as _GLP
                                        try:
                                            while True:
                                                await anyio.sleep(0.1)
                                                s = multi_agent_manager.session_data.get(sid, {})
                                                if s.get('phase') not in ('RECORDING',):
                                                    break
                                                if not isinstance(stt_provider, _GLP):
                                                    break
                                                tx = stt_provider.get_transcript(sid)
                                                if tx:
                                                    await _process_ma_transcript(sid, tx)
                                        except Exception as exc:
                                            logger.error("[GladiaLive] Drain task error for %s: %s", sid, exc, exc_info=True)

                                    tg.start_soon(_drain_gladia)
                                else:
                                    logger.error("[MultiAgent] Gladia live session failed to start for %s — STT unavailable", session_id)
                                    await multi_agent_manager.send_json(session_id, {
                                        "type": "stt_error",
                                        "data": {
                                            "message": "Speech-to-text is temporarily unavailable (rate limit). Please wait ~30 seconds and try again.",
                                        },
                                    })

                        # Flush any remaining sentence buffer when leaving RECORDING.
                        # Cancel the silence-flush scope first so it doesn't also
                        # process the same buffer content concurrently.
                        if sess.get('phase') == 'RECORDING' and new_phase != 'RECORDING':
                            old_scope: anyio.CancelScope | None = sess.get('_silence_scope')
                            if old_scope is not None:
                                old_scope.cancel()
                            # Stop Gladia live session if active
                            from services.stt_provider import GladiaLiveProvider
                            if isinstance(stt_provider, GladiaLiveProvider):
                                stt_provider.stop_session(session_id)
                            # Drain any buffered PCM before flushing the text buffer
                            leftover_pcm = sess.get('_pcm_buffer', b'')
                            if leftover_pcm and len(leftover_pcm) > 1000:
                                sess['_pcm_buffer'] = b''
                                try:
                                    tail_text = await stt_provider.transcribe(leftover_pcm, "pcm")
                                    if tail_text.strip():
                                        await _process_ma_transcript(session_id, tail_text.strip())
                                except Exception as exc:
                                    logger.warning("[MultiAgent] PCM drain on phase change failed: %s", exc)
                            else:
                                sess['_pcm_buffer'] = b''
                            remaining = sess.get('sentence_buffer', '').strip()
                            if remaining:
                                logger.info("[MultiAgent] Phase→%s: flushing remaining buffer (%d words)",
                                            new_phase, len(remaining.split()))
                                sess['sentence_buffer'] = ''
                                tracker_state, predicted_next = await check_tracker_and_counter(session_id, remaining)
                                async def _fire_phase_questions(ts=tracker_state, pn=predicted_next):
                                    await check_multi_agent_questions(
                                        session_id, tracker_state=ts, predicted_next=pn,
                                    )
                                tg.start_soon(_fire_phase_questions)

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

                        # Sparse MCTS: preserve the full candidate pool for
                        # lazy expansion once the student starts progressing.
                        full_pool_raw = pts_raw.get("full_topic_pool", []) if pts_raw else []
                        full_topic_pool = [
                            {"title": t["title"], "description": t.get("description", "")}
                            for t in full_pool_raw
                        ] if full_pool_raw else list(all_topics)

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
                            "full_topic_pool":  full_topic_pool,
                            "sparse_expanded":  False,
                        })
                        logger.info(
                            "[MultiAgent] set_agenda: tracker_ready=%s, topics_indexed=%d, full_pool=%d",
                            tracker is not None, len(topic_map), len(full_topic_pool),
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
        pass
    except BaseException as e:
        logger.error("Multi-agent WebSocket error: %s", e, exc_info=True)
    finally:
        # Release the Gladia concurrent session slot on any disconnect so the
        # next session start doesn't hit the 429 concurrent-session limit.
        from services.stt_provider import GladiaLiveProvider
        if isinstance(stt_provider, GladiaLiveProvider):
            stt_provider.stop_session(session_id)
        multi_agent_manager.disconnect(session_id)
        global_opponent_engine.evict_session(session_id)


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
        max_tokens=500,
        extra_body=task_extra_body("counter_argument"),
    )
    return extract_content(resp)


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
    # Fix #4: explicit None check — a falsy but non-None tracker object would
    # previously skip the update silently.
    if tracker is None or not utterance.strip():
        return None, session.get("last_predicted_next", [])

    # ── Serialise concurrent tracker/MCTS-gate mutations ─────────────────
    # Both the receive loop and the silence-flush background task can call
    # check_tracker_and_counter concurrently.  The _tracker_lock ensures the
    # fast synchronous mutations (flush_count, addressed_titles, last_mcts_flush)
    # are performed by exactly one task at a time; MCTS and send_json run outside.
    tracker_lock: anyio.Lock = session.get('_tracker_lock') or anyio.Lock()
    state = None
    refinement_args = ()
    addressed = set()
    remaining = []
    root_label = ""
    quality_map: dict = {}
    flush_count = 0
    last_mcts_flush_prev = 0
    run_mcts = False
    predicted_next = session.get("last_predicted_next", [])

    with anyio.move_on_after(5) as lock_scope:
        async with tracker_lock:
            # ── Tracker update (synchronous — no LLM call inside) ─────────
            state, refinement_args = tracker.update(
                TrackerTurn(speaker="petitioner", utterance=utterance)
            )

            # ── Update addressed-topic set ─────────────────────────────────
            addressed = session.get("addressed_titles", set())
            if state.last_human_matched_topic:
                addressed.add(state.last_human_matched_topic)
                session["addressed_titles"] = addressed

            all_topics = session.get("all_topics", [])
            root_label = session.get("case_summary", "")
            quality_map = _build_quality_map(state)

            # ── Sparse MCTS expansion ─────────────────────────────────────
            # The initial tree only covers SPARSE_MCTS_INITIAL_DEPTH topics.
            # Once any addressed topic reaches EXPANSION_QUALITY_THRESHOLD,
            # swap all_topics to the full candidate pool so MCTS projection
            # can explore the deeper topic space.
            if not session.get("sparse_expanded", False) and quality_map:
                max_quality = max(quality_map.values()) if quality_map else 0.0
                if max_quality >= EXPANSION_QUALITY_THRESHOLD:
                    full_pool = session.get("full_topic_pool", [])
                    if full_pool and len(full_pool) > len(all_topics):
                        existing_titles = {t["title"] for t in all_topics}
                        new_topics = [t for t in full_pool if t["title"] not in existing_titles]
                        all_topics = all_topics + new_topics
                        session["all_topics"] = all_topics
                        # Also update topic_map for new topics
                        topic_map = session.get("topic_map", {})
                        for t in new_topics:
                            if t["title"] not in topic_map:
                                topic_map[t["title"]] = {
                                    "agenda_id": None,
                                    "agent_id": None,
                                    "description": t.get("description", ""),
                                }
                        session["topic_map"] = topic_map
                        session["sparse_expanded"] = True
                        session["_just_expanded"] = True
                        logger.info(
                            "[SparseMCTS] Expansion triggered (max_quality=%.2f ≥ %.2f): "
                            "%d → %d topics",
                            max_quality, EXPANSION_QUALITY_THRESHOLD,
                            len(all_topics) - len(new_topics), len(all_topics),
                        )

            remaining  = [t for t in all_topics if t["title"] not in addressed]

            # ── MCTS gate ──────────────────────────────────────────────────
            just_expanded       = session.pop("_just_expanded", False)
            word_count          = len(session.get("transcript", "").split())
            flush_count         = session.get("projection_flush_count", 0) + 1
            session["projection_flush_count"] = flush_count
            last_mcts_flush_prev = session.get("last_mcts_flush", -MCTS_DEBOUNCE_TURNS)
            since_last_mcts      = flush_count - last_mcts_flush_prev

            run_mcts = (
                len(remaining) >= 2
                and (
                    just_expanded
                    or (word_count >= MCTS_MIN_WORDS and since_last_mcts >= MCTS_DEBOUNCE_TURNS)
                )
            )
            if run_mcts:
                # Mark the flush optimistically inside the lock so a concurrent
                # task skips MCTS rather than launching a second projection.
                session["last_mcts_flush"] = flush_count

            predicted_next = session.get("last_predicted_next", [])

    if lock_scope.cancelled_caught:
        logger.warning("[Tracker] Skipping update for %s — tracker lock timed out", session_id)
        return None, session.get("last_predicted_next", [])

    # state must be set if we reach here (lock was acquired)
    assert state is not None

    # Schedule LLM quality refinement outside the lock — it's slow and fire-and-forget.
    if refinement_args:
        session_tg = session.get('_tg')
        if session_tg:
            session_tg.start_soon(tracker.schedule_quality_refinement, *refinement_args)

    mcts_tree: dict | None = None

    if run_mcts:
        try:
            # Run CPU-bound MCTS in a thread so the event loop stays free.
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
            # Fix #3: reset last_mcts_flush so the next flush retries rather than
            # reusing a stale result for another full debounce cycle.
            session["last_mcts_flush"] = last_mcts_flush_prev
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

    # ── Counter-argument: ALL agents concurrently, select a winner ──────
    # Mirrors the agent-question pipeline: every agent generates a counter,
    # all appear in the per-agent QuestionFeed grid (question_type="counter"),
    # and a TINY-model selector picks the single best response to speak aloud.
    matched = state.last_human_matched_topic
    if matched:
        async def _fire_all_counters(sid, matched_topic, topic_info, agents, utt, brief_summary):
            try:
                topic_desc = topic_info.get("description", "") if topic_info else ""
                results: list = [None] * len(agents)

                async def _gen(idx, agent):
                    try:
                        text = await generate_counter_argument(
                            agent=agent,
                            topic_title=matched_topic,
                            topic_description=topic_desc,
                            recent_utterance=utt,
                            brief_summary=brief_summary,
                        )
                        if text:
                            results[idx] = (agent, text)
                    except Exception as e:
                        logger.error("Counter-arg gen failed for %s: %s", agent.name, e)

                async with anyio.create_task_group() as gen_tg:
                    for i, agent in enumerate(agents):
                        gen_tg.start_soon(_gen, i, agent)

                candidates = [r for r in results if r is not None]
                if not candidates:
                    return

                winner_agent, winner_text = await _select_best_question(
                    candidates, utt, brief_summary,
                )

                audio_b64 = ""
                audio_format = "opus"
                if winner_agent:
                    try:
                        tts = get_tts_provider()
                        audio_b64 = await tts.synthesize(winner_text)
                        audio_format = tts.audio_format
                    except Exception as e:
                        logger.warning("[Counter] TTS failed for %s: %s", winner_agent.name, e)

                now_iso = datetime.now().isoformat()
                for agent, text in candidates:
                    is_winner = winner_agent and agent.id == winner_agent.id
                    q_data = {
                        "agent_id":      agent.id,
                        "agent_name":    agent.name,
                        "color":         agent.color,
                        "question":      text,
                        "timestamp":     now_iso,
                        "selected":      bool(is_winner),
                        "question_type": "counter",
                        "topic":         matched_topic,
                        "audio":         audio_b64 if is_winner else "",
                        "audio_format":  audio_format if is_winner else "",
                    }
                    if is_winner:
                        session.get("questions_asked", []).append(q_data)
                    await multi_agent_manager.send_json(sid, {
                        "type": "agent_question",
                        "data": q_data,
                    })

                if winner_agent:
                    logger.info("[Counter] %s selected (of %d): %s…",
                                winner_agent.name, len(candidates), winner_text[:60])
            except Exception as e:
                logger.error("Counter-argument pipeline failed: %s", e)

        agents_list = session.get("agents", [])
        topic_info = session.get("topic_map", {}).get(matched)
        if agents_list:
            session_tg = session.get('_tg')
            if session_tg:
                session_tg.start_soon(
                    _fire_all_counters,
                    session_id, matched, topic_info, agents_list, utterance,
                    session.get("brief_summary", ""),
                )

    return state, predicted_next


async def _select_best_question(
    candidates: list,
    transcript: str,
    brief_summary: str,
) -> tuple:
    """Use the TINY model to pick the best question from agent candidates.

    Parameters
    ----------
    candidates : list of (Agent, question_str)
    transcript : recent advocate speech
    brief_summary : judicial summary for context

    Returns (agent, question) — the selected winner.  Falls back to
    random.choice if the TINY model is unavailable or parsing fails.
    """
    if len(candidates) <= 1:
        return candidates[0] if candidates else (None, None)

    client, model = get_task_client("question_selection")
    if not client:
        return random.choice(candidates)

    q_list = "\n".join(
        f"{i + 1}. [{agent.name}]: {question}"
        for i, (agent, question) in enumerate(candidates)
    )

    prompt = (
        "You are selecting the single best judicial question to ask during "
        "a moot-court hearing.\n\n"
        f"RECENT TRANSCRIPT:\n{transcript[-800:]}\n\n"
        f"CASE SUMMARY:\n{brief_summary[:400]}\n\n"
        f"CANDIDATE QUESTIONS:\n{q_list}\n\n"
        "Pick the question that is most:\n"
        "1. Relevant to what the advocate just argued\n"
        "2. Substantive and probing\n"
        "3. Not redundant with recent discussion\n\n"
        "Respond with ONLY the number (e.g. '1' or '2'). Nothing else."
    )

    SELECTION_TIMEOUT = 8  # seconds — fall back to random if TINY is slow

    try:
        result = [None]

        async def _call_llm():
            result[0] = await client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=10,
                extra_body=task_extra_body("question_selection"),
            )

        with anyio.CancelScope() as scope:
            scope.deadline = anyio.current_time() + SELECTION_TIMEOUT
            await _call_llm()

        if scope.cancelled_caught:
            logger.warning(
                "[QuestionSelect] TINY selection timed out after %ds — falling back to random",
                SELECTION_TIMEOUT,
            )
            return random.choice(candidates)

        content = extract_content(result[0])
        match = re.search(r"(\d+)", content)
        if match:
            idx = int(match.group(1)) - 1
            if 0 <= idx < len(candidates):
                logger.info(
                    "[QuestionSelect] TINY chose candidate %d/%d (%s)",
                    idx + 1, len(candidates), candidates[idx][0].name,
                )
                return candidates[idx]
    except Exception as e:
        logger.warning("[QuestionSelect] TINY selection failed: %s — falling back to random", e)

    return random.choice(candidates)


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
    - One-per-cycle: a random agent that wants to ask fires (prevents
      overlapping TTS and adds variety).  The winning agent's question is
      synthesized to TTS audio and sent alongside the text.
    """
    session = multi_agent_manager.session_data.get(session_id, {})

    # ── Quick pre-checks (no lock needed) ─────────────────────────────────
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

    # ── Concurrency guard: anyio.Lock with a 30 s timeout ────────────────
    # Only one evaluation cycle runs at a time — prevents a silence-flush
    # and a sentence-boundary flush from firing 2×N simultaneous LLM calls.
    # The lock covers ONLY the LLM evaluation + winner selection + time-marking;
    # TTS synthesis and WS sends happen outside so the lock is released before
    # the next caller starts waiting (evaluation ~13s vs TTS ~5s — dropping
    # the hold time prevents 30 s probe timeouts on back-to-back flushes).
    lock: anyio.Lock = session.get('_eval_lock') or anyio.Lock()

    # Outputs captured inside the lock, consumed after release.
    winner_agent    = None
    winner_question = None
    candidates      = []
    now_iso         = None

    with anyio.move_on_after(30) as lock_scope:
        async with lock:
            # ── Re-check cooldown INSIDE the lock ─────────────────────────
            # A concurrent call might have fired an agent question between our
            # initial pre-check and acquiring this lock, so we must re-verify.
            last_interrupt = session.get('last_agent_interrupt_time')
            if last_interrupt is not None:
                elapsed = (datetime.now() - last_interrupt).total_seconds()
                if elapsed < multi_agent_manager.AGENT_INTERRUPT_COOLDOWN_SECONDS:
                    logger.debug("[MultiAgent] Skip interrupt — cooldown %.1fs / %ds (re-checked inside lock)",
                                 elapsed, multi_agent_manager.AGENT_INTERRUPT_COOLDOWN_SECONDS)
                    return

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

            # ── Agent evaluation — all agents concurrently, first yes wins ──
            # anyio task groups (trio-compatible structured concurrency).
            # Each slot is pre-filled with a "no" sentinel so ordering is
            # preserved even if tasks complete out of order.
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

            async with anyio.create_task_group() as eval_tg:
                for i, agent in enumerate(agents):
                    eval_tg.start_soon(_eval_agent, i, agent)

            # Use TINY model to select the best question from candidates —
            # adds intelligent selection so the court hears the most relevant
            # question rather than a random pick.
            candidates = [(agent, question) for agent, should_ask, question in results
                          if should_ask and question]
            if candidates:
                winner_agent, winner_question = await _select_best_question(
                    candidates, transcript, brief_summary,
                )
                # Mark interrupt time NOW (inside the lock) so any concurrent
                # caller that acquires the lock next sees the cooldown and exits
                # without running another full evaluation cycle.
                session['last_agent_interrupt_time'] = datetime.now()
                now_iso = datetime.now().isoformat()

    if lock_scope.cancelled_caught:
        logger.warning("[MultiAgent] Skip interrupt — eval lock timed out (hung LLM call?)")
        return

    # ── Post-lock: TTS synthesis + WS sends ───────────────────────────────
    # The eval lock is now RELEASED.  TTS and network I/O run here so they
    # never block the next evaluation cycle from starting.
    if candidates and winner_agent and winner_question:
        # Synthesize TTS audio only for the selected winner
        audio_b64 = ""
        audio_format = "opus"
        try:
            tts = get_tts_provider()
            audio_b64 = await tts.synthesize(winner_question)
            audio_format = tts.audio_format
        except Exception as e:
            logger.warning("[MultiAgent] TTS synthesis failed for %s: %s", winner_agent.name, e)

        # Send ALL candidate questions to the frontend (for the per-agent
        # question grid), but mark only the winner as "selected" so the
        # Judge Activity feed shows a single voice per cycle.
        for agent, question in candidates:
            is_winner = (agent.id == winner_agent.id)
            question_data = {
                "agent_id":     agent.id,
                "agent_name":   agent.name,
                "color":        agent.color,
                "question":     question,
                "timestamp":    now_iso,
                "selected":     is_winner,
                "audio":        audio_b64 if is_winner else "",
                "audio_format": audio_format if is_winner else "",
            }
            if is_winner:
                session['questions_asked'].append(question_data)
            await multi_agent_manager.send_json(session_id, {
                "type": "agent_question",
                "data": question_data,
            })

        # Record the winner's question into the opponent engine so it can
        # exploit weaknesses that the panel has identified.
        global_opponent_engine.record_judge_question(session_id, winner_question)
        logger.info("[MultiAgent] %s selected (of %d candidates): %s…",
                    winner_agent.name, len(candidates), winner_question[:60])

        # Refresh the agenda panel after the agent interrupts.
        # We do NOT feed the agent question to the tracker as a "judge" turn —
        # agent questions are simulated advocate probes, not judicial direction,
        # and skewing the confidence scores toward agent-favoured topics would
        # corrupt the predicted trajectory.  Use the last known tracker state
        # from the human's own speech instead.
        tracker = session.get("tracker")
        if tracker is not None:
            try:
                last_state = tracker.state()  # current state without advancing turn count
                new_predicted = session.get("last_predicted_next", [])
                await multi_agent_manager.send_json(session_id, {
                    "type": "agenda_update",
                    "data": {
                        "best_prediction_id":       last_state.best_prediction_id,
                        "agenda_confidences":       _format_agenda_confidences(last_state),
                        "last_human_matched_topic": last_state.last_human_matched_topic,
                        "predicted_next_topics":    new_predicted,
                        "mcts_tree":                None,
                        "triggered_by":             f"agent:{winner_agent.id}",
                        "regeneration_needed":      last_state.regeneration_needed,
                    },
                })
            except Exception as e:
                logger.warning("Agenda refresh after agent question failed: %s", e)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
