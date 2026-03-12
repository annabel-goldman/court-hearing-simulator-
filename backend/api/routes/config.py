"""REST routes for runtime configuration endpoints."""

import os
import logging

import anyio
import anyio.to_thread
from fastapi import APIRouter, HTTPException

from model_router import apply_runtime_override, clear_runtime_override, ModelTier
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
from schemas.requests import (
    JudgeConfigRequest,
    OpponentConfigRequest,
    TTSConfigRequest,
    STTConfigRequest,
    ModelRuntimeConfigRequest,
)

logger = logging.getLogger("court-simulator")
router = APIRouter(tags=["config"])

def _redact_api_keys(d):
    """Recursively replace every 'api_key' value with '' before sending to the client."""
    if isinstance(d, dict):
        return {k: ("" if k == "api_key" else _redact_api_keys(v)) for k, v in d.items()}
    return d


# -----------------------------------------------------------------------------
# Judge Configuration endpoints
# -----------------------------------------------------------------------------

@router.get("/api/judge-config")
async def get_judge_config():
    """Return the current judge configuration (loaded from disk)."""
    cfg = await anyio.to_thread.run_sync(load_judge_config)
    return _redact_api_keys(judge_config_to_dict(cfg))


@router.get("/api/judge-config/default")
async def get_default_judge_config_endpoint():
    """Return the hardcoded default judge configuration (never reads disk)."""
    return _redact_api_keys(judge_config_to_dict(get_default_judge_config()))


@router.post("/api/judge-config")
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

@router.get("/api/opponent-config")
async def get_opponent_config():
    """Return the current opponent configuration (loaded from disk)."""
    cfg = await anyio.to_thread.run_sync(load_opponent_config)
    return opponent_config_to_dict(cfg)


@router.get("/api/opponent-config/default")
async def get_default_opponent_config_endpoint():
    """Return the hardcoded default opponent configuration (no disk I/O)."""
    return opponent_config_to_dict(get_default_opponent_config())


@router.post("/api/opponent-config")
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

@router.get("/api/tts-config")
async def get_tts_config_endpoint():
    cfg = await anyio.to_thread.run_sync(load_tts_config)
    return _redact_api_keys(media_config_to_dict(cfg))

@router.get("/api/tts-config/default")
async def get_default_tts_config_endpoint():
    return _redact_api_keys(media_config_to_dict(get_default_tts_config()))

@router.post("/api/tts-config")
async def save_tts_config_endpoint(req: TTSConfigRequest):
    # Voice validation is intentionally lenient: the TTS provider falls back to
    # its default voice for unrecognised values, so we never block a save over it.
    # Model defaults to "tts-1" if the field arrives empty.
    cfg = TTSConfig(
        enabled=req.enabled,
        api_key=req.api_key,
        base_url=req.base_url,
        voice=req.voice,
        model=req.model.strip() or "tts-1",
    )
    await anyio.to_thread.run_sync(lambda: save_tts_config(cfg))
    return _redact_api_keys(media_config_to_dict(cfg))


@router.get("/api/tts/voices")
async def get_tts_voices():
    """Return available TTS voices for the active provider."""
    provider = os.getenv("TTS_PROVIDER", "openai").lower().strip()
    if provider == "groq":
        return [{"id": n, "name": n.capitalize()}
                for n in ["autumn", "diana", "hannah", "austin", "daniel", "troy"]]
    # OpenAI / fallback
    return [{"id": n, "name": n.capitalize()}
            for n in ["alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "shimmer", "verse"]]


# -----------------------------------------------------------------------------
# STT Configuration endpoints
# -----------------------------------------------------------------------------

@router.get("/api/stt-config")
async def get_stt_config_endpoint():
    cfg = await anyio.to_thread.run_sync(load_stt_config)
    return _redact_api_keys(media_config_to_dict(cfg))

@router.get("/api/stt-config/default")
async def get_default_stt_config_endpoint():
    return _redact_api_keys(media_config_to_dict(get_default_stt_config()))

@router.post("/api/stt-config")
async def save_stt_config_endpoint(req: STTConfigRequest):
    if req.provider not in ("openai", "local", "groq"):
        raise HTTPException(status_code=422, detail="provider must be 'openai', 'local', or 'groq'")
    valid_local_models = {"tiny", "base", "small", "medium", "large-v3"}
    if req.provider == "local" and req.whisper_model not in valid_local_models:
        raise HTTPException(status_code=422, detail=f"whisper_model must be one of {sorted(valid_local_models)}")
    if req.device not in ("cuda", "cpu"):
        raise HTTPException(status_code=422, detail="device must be 'cuda' or 'cpu'")
    valid_compute = {"float16", "int8_float16", "int8"}
    if req.compute_type not in valid_compute:
        raise HTTPException(status_code=422, detail=f"compute_type must be one of {sorted(valid_compute)}")
    model = (req.model or "").strip()
    if req.provider == "groq" and not model:
        model = "whisper-large-v3-turbo"
    elif req.provider == "openai" and not model:
        model = "gpt-4o-mini-audio-preview"
    cfg = STTConfig(
        provider=req.provider,
        api_key=req.api_key,
        base_url=req.base_url,
        model=model or "whisper-large-v3-turbo",
        whisper_model=req.whisper_model,
        device=req.device,
        compute_type=req.compute_type,
    )
    await anyio.to_thread.run_sync(lambda: save_stt_config(cfg))
    return _redact_api_keys(media_config_to_dict(cfg))


# -----------------------------------------------------------------------------
# Model tier runtime configuration endpoints
# -----------------------------------------------------------------------------

@router.get("/api/model-config")
async def get_model_config_endpoint():
    cfg = await anyio.to_thread.run_sync(load_model_config)
    return _redact_api_keys(model_config_to_dict(cfg))

@router.get("/api/model-config/default")
async def get_default_model_config_endpoint():
    return _redact_api_keys(model_config_to_dict(get_default_model_config()))

@router.post("/api/model-config")
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

