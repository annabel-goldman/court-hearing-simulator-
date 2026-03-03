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
    api_key: str = ""
    base_url: str = ""
    voice: str = "onyx"
    model: str = "tts-1"


@dataclass
class STTConfig:
    provider: str = "openai"          # "openai" | "local"
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
    return TTSConfig(
        enabled=True,
        api_key=os.getenv("TTS_API_KEY", os.getenv("OPENAI_API_KEY", "")),
        base_url=os.getenv("TTS_BASE_URL", os.getenv("OPENAI_BASE_URL", "")),
        voice="onyx",
        model="openai/gpt-audio-mini",
    )


def get_default_stt_config() -> STTConfig:
    return STTConfig(
        provider=os.getenv("STT_PROVIDER", "openai"),
        api_key=os.getenv("OPENAI_API_KEY", ""),
        base_url=os.getenv("OPENAI_BASE_URL", ""),
        model="openai/gpt-audio-mini",
        whisper_model=os.getenv("WHISPER_MODEL", "medium"),
        device=os.getenv("WHISPER_DEVICE", "cuda"),
        compute_type=os.getenv("WHISPER_COMPUTE_TYPE", "float16"),
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
        return TTSConfig(**{k: v for k, v in raw.items() if k in valid})
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
        return STTConfig(**{k: v for k, v in raw.items() if k in valid})
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
