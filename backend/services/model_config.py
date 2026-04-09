"""
Per-tier model runtime configuration — persisted to backend/data/model_config.json.

Wraps model_router's apply_runtime_override / clear_runtime_override so the UI
can configure each tier independently (LARGE / SMALL / TINY) and the settings
survive a page reload (but not a server restart, since env vars take effect at
startup and the config is re-applied via the POST endpoint).

All public functions are synchronous.  REST endpoints must wrap I/O-bound calls
in anyio.to_thread.run_sync.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path

logger = logging.getLogger("court-simulator.model_config")

_CONFIG_PATH = Path(__file__).parent.parent / "data" / "model_config.json"


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------

@dataclass
class TierConfig:
    enabled: bool = False
    base_url: str = ""
    api_key: str = ""
    model: str = ""


@dataclass
class ModelRuntimeConfig:
    large: TierConfig = field(default_factory=TierConfig)
    small: TierConfig = field(default_factory=TierConfig)
    tiny:  TierConfig = field(default_factory=TierConfig)


# ---------------------------------------------------------------------------
# Defaults (from env vars — for initial display in the UI)
# ---------------------------------------------------------------------------

def get_default_model_config() -> ModelRuntimeConfig:
    api_key   = os.getenv("OPENAI_API_KEY", os.getenv("OPEN_ROUTER_API_KEY", ""))
    large_url = os.getenv("MODEL_LARGE_URL", os.getenv("OPENAI_BASE_URL", os.getenv("OPEN_ROUTER_BASE_URL", "")))
    small_url = os.getenv("MODEL_SMALL_URL", large_url)
    tiny_url  = os.getenv("MODEL_TINY_URL",  small_url)
    return ModelRuntimeConfig(
        large=TierConfig(enabled=False, base_url=large_url, api_key=api_key,
                         model=os.getenv("MODEL_LARGE", "")),
        small=TierConfig(enabled=False, base_url=small_url, api_key=api_key,
                         model=os.getenv("MODEL_SMALL", "")),
        tiny= TierConfig(enabled=False, base_url=tiny_url,  api_key=api_key,
                         model=os.getenv("MODEL_TINY",  "")),
    )


# ---------------------------------------------------------------------------
# Load / save
# ---------------------------------------------------------------------------

def load_model_config() -> ModelRuntimeConfig:
    try:
        if not _CONFIG_PATH.exists():
            return get_default_model_config()
        with _CONFIG_PATH.open("r", encoding="utf-8") as fh:
            raw = json.load(fh)
        return _deserialize(raw)
    except Exception as exc:
        logger.warning("Failed to load model_config.json, using defaults: %s", exc)
        return get_default_model_config()


def save_model_config(cfg: ModelRuntimeConfig) -> None:
    _CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = _CONFIG_PATH.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(asdict(cfg), fh, indent=2)
    tmp.replace(_CONFIG_PATH)
    logger.info("model_config.json saved to %s", _CONFIG_PATH)


def config_to_dict(cfg: ModelRuntimeConfig) -> dict:
    return asdict(cfg)


# ---------------------------------------------------------------------------
# Serialisation
# ---------------------------------------------------------------------------

def _deserialize(raw: dict) -> ModelRuntimeConfig:
    def _tier(d: dict) -> TierConfig:
        if not isinstance(d, dict):
            return TierConfig()
        return TierConfig(
            enabled=bool(d.get("enabled", False)),
            base_url=str(d.get("base_url", "")),
            api_key=str(d.get("api_key", "")),
            model=str(d.get("model", "")),
        )
    return ModelRuntimeConfig(
        large=_tier(raw.get("large", {})),
        small=_tier(raw.get("small", {})),
        tiny= _tier(raw.get("tiny",  {})),
    )
