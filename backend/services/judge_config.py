"""
Judge configuration — persisted to backend/data/judge_config.json.

Covers three editable areas:
  1. judge_prompt         — base system prompt for interrupt / questioning decisions
  2. reward_dimensions    — scoring criteria (name, weight, description)
  3. scoring_prompt_template — additional context injected into score_argument()
  4. external_llm         — optional override of the LARGE/SMALL model tier

All public functions are synchronous.  REST endpoints must wrap the I/O-bound
ones (load_config, save_config) in anyio.to_thread.run_sync.
"""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import List

logger = logging.getLogger("court-simulator.judge_config")

_CONFIG_PATH = Path(__file__).parent.parent / "data" / "judge_config.json"

# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------

@dataclass
class RewardDimension:
    name: str
    weight: float
    description: str


@dataclass
class ExternalLLMConfig:
    enabled: bool = False
    base_url: str = ""
    api_key: str = ""
    model: str = ""
    tier_override: str = "LARGE"   # "LARGE" | "SMALL" | "BOTH"


@dataclass
class JudgeConfig:
    judge_prompt: str
    scoring_prompt_template: str
    reward_dimensions: List[RewardDimension]
    external_llm: ExternalLLMConfig = field(default_factory=ExternalLLMConfig)


# ---------------------------------------------------------------------------
# Default values (extracted from hardcoded strings in judge_engine.py)
# ---------------------------------------------------------------------------

_DEFAULT_JUDGE_PROMPT = (
    "You are a federal appellate court judge presiding over a moot court argument.\n"
    "Your role is to:\n"
    "1. Listen carefully to the advocate's argument\n"
    "2. Identify points that need clarification, have logical gaps, or raise questions\n"
    "3. Interrupt naturally when you have a substantive question\n"
    "4. Ask probing questions that test the advocate's understanding\n"
    "5. Be respectful but challenging\n"
    "\n"
    "Guidelines:\n"
    "- Interrupt when the argument is unclear or you need clarification\n"
    "- Interrupt when you spot a logical weakness or inconsistency\n"
    "- Interrupt when you want to test the advocate's knowledge\n"
    "- Don't interrupt too frequently (allow advocate to develop points)\n"
    "- Questions should be substantive and relevant to the case\n"
    "- Use natural judicial language and tone\n"
    "\n"
    "You are a strict, demanding judge who challenges arguments rigorously "
    "and expects precise legal reasoning."
)

_DEFAULT_SCORING_PROMPT_TEMPLATE = (
    "You are a moot court judge evaluating an advocate's oral argument.\n"
    "Score the following argument turn on the dimensions listed below "
    "(0–10 each), then give an overall weighted score.\n\n"
    "Optional context sections will appear above the SPEAKER line when available:\n"
    "  BRIEF SUMMARY, TOPIC BEING ARGUED, JUDGE'S QUESTION THIS TURN IS RESPONDING TO.\n\n"
    "Respond with valid JSON only — no markdown, no commentary."
)

_DEFAULT_REWARD_DIMENSIONS: List[RewardDimension] = [
    RewardDimension("clarity",         0.20, "how clearly and precisely the point is stated"),
    RewardDimension("legal_reasoning", 0.35, "correct use of precedent, statutes, or legal logic"),
    RewardDimension("responsiveness",  0.25, "directly addresses the judge's question / the disputed issue"),
    RewardDimension("persuasiveness",  0.20, "overall persuasive impact on the bench"),
]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_default_config() -> JudgeConfig:
    """Return the hardcoded default configuration.  Never reads from disk."""
    return JudgeConfig(
        judge_prompt=_DEFAULT_JUDGE_PROMPT,
        scoring_prompt_template=_DEFAULT_SCORING_PROMPT_TEMPLATE,
        reward_dimensions=[
            RewardDimension(d.name, d.weight, d.description)
            for d in _DEFAULT_REWARD_DIMENSIONS
        ],
        external_llm=ExternalLLMConfig(),
    )


def load_config() -> JudgeConfig:
    """
    Load config from disk.  Falls back to get_default_config() on any error
    (missing file, corrupted JSON, schema mismatch) so judge_engine.py is
    never blocked by a bad config.

    Synchronous — wrap in anyio.to_thread.run_sync when called from an async
    REST endpoint.  In judge_engine.py it is called inline because the LLM
    call that follows dominates latency by orders of magnitude.
    """
    try:
        if not _CONFIG_PATH.exists():
            return get_default_config()
        with _CONFIG_PATH.open("r", encoding="utf-8") as fh:
            raw = json.load(fh)
        return _deserialize(raw)
    except Exception as exc:
        logger.warning("Failed to load judge_config.json, using defaults: %s", exc)
        return get_default_config()


def save_config(cfg: JudgeConfig) -> None:
    """
    Atomically persist config to disk (write-to-tmp then rename).
    Creates backend/data/ if it doesn't exist.

    Synchronous — wrap in anyio.to_thread.run_sync from async handlers.
    """
    _CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = _CONFIG_PATH.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(_serialize(cfg), fh, indent=2)
    tmp.replace(_CONFIG_PATH)
    logger.info("judge_config.json saved to %s", _CONFIG_PATH)


# ---------------------------------------------------------------------------
# Serialisation helpers
# ---------------------------------------------------------------------------

def _serialize(cfg: JudgeConfig) -> dict:
    return {
        "judge_prompt": cfg.judge_prompt,
        "scoring_prompt_template": cfg.scoring_prompt_template,
        "reward_dimensions": [asdict(d) for d in cfg.reward_dimensions],
        "external_llm": asdict(cfg.external_llm),
    }


def _deserialize(raw: dict) -> JudgeConfig:
    """
    Reconstruct JudgeConfig from a raw dict.  Missing or invalid keys fall
    back to defaults so new fields added in future versions are forward-compat.
    """
    defaults = get_default_config()

    # Reward dimensions — must be a non-empty list of {name, weight, description}
    raw_dims = raw.get("reward_dimensions")
    if raw_dims and isinstance(raw_dims, list):
        dims = []
        for item in raw_dims:
            try:
                dims.append(RewardDimension(
                    name=str(item["name"]),
                    weight=float(item["weight"]),
                    description=str(item.get("description", "")),
                ))
            except (KeyError, TypeError, ValueError):
                pass
        reward_dimensions = dims if dims else defaults.reward_dimensions
    else:
        reward_dimensions = defaults.reward_dimensions

    # External LLM
    raw_ext = raw.get("external_llm", {}) or {}
    external_llm = ExternalLLMConfig(
        enabled=bool(raw_ext.get("enabled", False)),
        base_url=str(raw_ext.get("base_url", "")),
        api_key=str(raw_ext.get("api_key", "")),
        model=str(raw_ext.get("model", "")),
        tier_override=str(raw_ext.get("tier_override", "LARGE")),
    )

    return JudgeConfig(
        judge_prompt=str(raw.get("judge_prompt", defaults.judge_prompt)),
        scoring_prompt_template=str(
            raw.get("scoring_prompt_template", defaults.scoring_prompt_template)
        ),
        reward_dimensions=reward_dimensions,
        external_llm=external_llm,
    )


def config_to_dict(cfg: JudgeConfig) -> dict:
    """Serialise JudgeConfig to a plain dict for JSON HTTP responses."""
    return _serialize(cfg)
