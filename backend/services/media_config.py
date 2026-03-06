"""
TTS and STT runtime configuration — persisted to backend/data/{tts,stt}_config.json.

All public functions are synchronous.  REST endpoints must wrap I/O-bound
ones (load_*_config, save_*_config) in anyio.to_thread.run_sync.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import asdict, dataclass
from pathlib import Path

logger = logging.getLogger("court-simulator.media_config")

_TTS_PATH = Path(__file__).parent.parent / "data" / "tts_config.json"
_STT_PATH = Path(__file__).parent.parent / "data" / "stt_config.json"


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------

@dataclass
class TTSConfig:
    enabled: bool = True
    provider: str = "openai"   # "openai" | "groq"
    api_key: str = ""
    base_url: str = ""
    voice: str = "onyx"
    model: str = "tts-1"


@dataclass
class STTConfig:
    provider: str = "openai"          # "openai" | "groq" | "local"
    api_key: str = ""
    base_url: str = ""
    model: str = "gpt-4o-mini-audio-preview"  # used when provider="openai"
    whisper_model: str = "medium"     # tiny / base / small / medium / large-v3 (local only)
    device: str = "cuda"              # cuda / cpu (local only)
    compute_type: str = "float16"     # float16 / int8_float16 / int8 (local only)


# ---------------------------------------------------------------------------
# Defaults (populated from env vars so the UI shows sensible starting values)
# ---------------------------------------------------------------------------

def get_default_tts_config() -> TTSConfig:
    tts_provider = os.getenv("TTS_PROVIDER", "openai").lower().strip()
    if tts_provider == "groq":
        return TTSConfig(
            enabled=True,
            provider="groq",
            api_key=os.getenv("GROQ_API_KEY", os.getenv("TTS_API_KEY", "")),
            base_url=os.getenv("GROQ_BASE_URL", os.getenv("TTS_BASE_URL", "https://api.groq.com/openai/v1")),
            voice=os.getenv("TTS_VOICE", "austin"),
            model=os.getenv("TTS_MODEL", "canopylabs/orpheus-v1-english"),
        )
    return TTSConfig(
        enabled=True,
        provider="openai",
        api_key=os.getenv("TTS_API_KEY", os.getenv("OPENAI_API_KEY", "")),
        base_url=os.getenv("TTS_BASE_URL", os.getenv("OPENAI_BASE_URL", "")),
        voice="onyx",
        model="openai/gpt-audio-mini",
    )


def get_default_stt_config() -> STTConfig:
    return STTConfig(
        provider=os.getenv("STT_PROVIDER", "openai"),
        api_key=os.getenv("GROQ_API_KEY", os.getenv("STT_API_KEY", os.getenv("OPENAI_API_KEY", ""))),
        base_url=os.getenv("GROQ_BASE_URL", os.getenv("STT_BASE_URL", os.getenv("OPENAI_BASE_URL", ""))),
        model="whisper-large-v3-turbo",
        whisper_model="medium",
        device="cuda",
        compute_type="float16",
    )


# ---------------------------------------------------------------------------
# Load / save
# ---------------------------------------------------------------------------

def load_tts_config() -> TTSConfig:
    try:
        if not _TTS_PATH.exists():
            return get_default_tts_config()
        with _TTS_PATH.open("r", encoding="utf-8") as fh:
            raw = json.load(fh)
        valid = TTSConfig.__dataclass_fields__
        cfg = TTSConfig(**{k: v for k, v in raw.items() if k in valid})
        # Env var always wins for provider selection
        env_provider = os.getenv("TTS_PROVIDER", "").lower().strip()
        if env_provider:
            cfg.provider = env_provider
        # Normalise fields that may be absent in older config files
        if not (cfg.model or "").strip():
            cfg.model = "tts-1"
        if not (cfg.voice or "").strip():
            cfg.voice = "onyx"
        return cfg
    except Exception as exc:
        logger.warning("Failed to load tts_config.json, using defaults: %s", exc)
        return get_default_tts_config()


def save_tts_config(cfg: TTSConfig) -> None:
    _TTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = _TTS_PATH.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(asdict(cfg), fh, indent=2)
    tmp.replace(_TTS_PATH)
    logger.info("tts_config.json saved to %s", _TTS_PATH)


def load_stt_config() -> STTConfig:
    try:
        if not _STT_PATH.exists():
            return get_default_stt_config()
        with _STT_PATH.open("r", encoding="utf-8") as fh:
            raw = json.load(fh)
        valid = STTConfig.__dataclass_fields__
        cfg = STTConfig(**{k: v for k, v in raw.items() if k in valid})
        # Env var always wins for provider selection
        env_provider = os.getenv("STT_PROVIDER", "").lower().strip()
        if env_provider:
            cfg.provider = env_provider
        # Groq: ensure base_url and model are correct (Groq uses /audio/transcriptions, not chat)
        if cfg.provider == "groq":
            if not (cfg.base_url or "").strip():
                cfg.base_url = os.getenv("GROQ_BASE_URL", os.getenv("STT_BASE_URL", "https://api.groq.com/openai/v1"))
            if not (cfg.api_key or "").strip():
                cfg.api_key = os.getenv("GROQ_API_KEY", os.getenv("STT_API_KEY", ""))
            # Groq uses whisper models, not chat-audio
            if "audio-preview" in (cfg.model or "").lower() or "gpt-audio" in (cfg.model or "").lower():
                cfg.model = "whisper-large-v3-turbo"
        return cfg
    except Exception as exc:
        logger.warning("Failed to load stt_config.json, using defaults: %s", exc)
        return get_default_stt_config()


def save_stt_config(cfg: STTConfig) -> None:
    _STT_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = _STT_PATH.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(asdict(cfg), fh, indent=2)
    tmp.replace(_STT_PATH)
    logger.info("stt_config.json saved to %s", _STT_PATH)


def config_to_dict(cfg) -> dict:
    return asdict(cfg)
