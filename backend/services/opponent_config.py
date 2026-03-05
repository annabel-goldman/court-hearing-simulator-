"""
Opponent configuration — persisted to backend/data/opponent_config.json.

Covers the opponent (opposing counsel) engine's editable parameters:
  1. system_prompt     — base system prompt controlling the opponent's persona
  2. aggressiveness    — float 0-1 controlling temperature and verbal intensity
  3. enabled_types     — which response types are allowed ("rebuttal","exploitation","affirmative")

All public functions are synchronous.  REST endpoints must wrap load_config/
save_config in anyio.to_thread.run_sync.
"""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import List

logger = logging.getLogger("court-simulator.opponent_config")

_CONFIG_PATH = Path(__file__).parent.parent / "data" / "opponent_config.json"

# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


@dataclass
class OpponentConfig:
    system_prompt: str
    aggressiveness: float = 0.7  # 0.0–1.0
    enabled_types: List[str] = field(
        default_factory=lambda: ["rebuttal", "exploitation", "affirmative"]
    )
    voice_id: str = ""  # TTS voice ID; "" = provider default


# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

_DEFAULT_SYSTEM_PROMPT = (
    "You are an experienced appellate attorney representing the respondent "
    "(appellee) in a moot-court hearing. You are opposing the petitioner's argument.\n"
    "\n"
    "Your role:\n"
    "- Defend the lower court's decision\n"
    "- Rebut the petitioner's arguments using facts and law from YOUR brief\n"
    "- Exploit weaknesses that the judges have identified\n"
    "- Be strategic: press hardest where the petitioner is weakest\n"
    "\n"
    "Style:\n"
    "- Be direct and assertive but professional\n"
    "- Cite specific facts, precedents, or statutory provisions from your brief\n"
    "- Keep responses focused: 2-4 sentences maximum\n"
    "- Adapt your tone based on how the hearing is going\n"
    "\n"
    "You must respond with valid JSON only — no markdown, no extra text."
)


def get_default_config() -> OpponentConfig:
    """Return the hardcoded default config (no I/O)."""
    return OpponentConfig(
        system_prompt=_DEFAULT_SYSTEM_PROMPT,
        aggressiveness=0.7,
        enabled_types=["rebuttal", "exploitation", "affirmative"],
    )


# ---------------------------------------------------------------------------
# File I/O
# ---------------------------------------------------------------------------


def load_config() -> OpponentConfig:
    """Load config from disk, falling back to defaults on any error."""
    try:
        if _CONFIG_PATH.exists():
            raw = json.loads(_CONFIG_PATH.read_text("utf-8"))
            return OpponentConfig(
                system_prompt=raw.get("system_prompt", _DEFAULT_SYSTEM_PROMPT),
                aggressiveness=float(raw.get("aggressiveness", 0.7)),
                enabled_types=list(raw.get("enabled_types", ["rebuttal", "exploitation", "affirmative"])),
                voice_id=raw.get("voice_id", ""),
            )
    except Exception as e:
        logger.warning("[OpponentConfig] load error, using defaults: %s", e)
    return get_default_config()


def save_config(config: OpponentConfig) -> None:
    """Atomic write-then-rename so readers never see a partial file."""
    _CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = _CONFIG_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(asdict(config), indent=2), encoding="utf-8")
    tmp.replace(_CONFIG_PATH)
    logger.info("[OpponentConfig] saved to %s", _CONFIG_PATH)


def config_to_dict(config: OpponentConfig) -> dict:
    """Convert config to a plain dict for JSON serialization."""
    return asdict(config)
