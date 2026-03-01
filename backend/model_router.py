"""
Multi-Model Router
==================

Routes LLM calls to the appropriate model tier based on task complexity.

Three tiers:
  LARGE  — High-quality argument generation, judge intros, counter-arguments.
            Default: Qwen3.5-35B-A3B on port 8001.

  SMALL  — Fast agent analysis (should_ask decisions), quality assessment,
            brief summaries.
            Default: Qwen3-4B on port 8002.

  TINY   — Lightweight structured extraction: issue extraction, agenda
            generation, predictive timeline tasks.
            Default: gemma-3-1b-it on port 8003.

All three tiers expose an OpenAI-compatible /v1 endpoint via llama-server.
When only one server is running (single-GPU setup), all tiers fall back
to the LARGE model — the system degrades gracefully.

Environment variables:
  MODEL_LARGE       model alias for the large server    (default: LOCAL_MODEL)
  MODEL_LARGE_URL   base URL                            (default: OPENAI_BASE_URL)

  MODEL_SMALL       model alias for the small server    (default: MODEL_LARGE)
  MODEL_SMALL_URL   base URL                            (default: MODEL_LARGE_URL)

  MODEL_TINY        model alias for the tiny server     (default: MODEL_SMALL)
  MODEL_TINY_URL    base URL                            (default: MODEL_SMALL_URL)
"""

from __future__ import annotations

import os
import logging
from enum import Enum
from dataclasses import dataclass
from typing import Optional

from dotenv import load_dotenv

# Load .env from the project root
_env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
load_dotenv(_env_path)

logger = logging.getLogger("court-simulator.model_router")


class ModelTier(str, Enum):
    """Which model tier to route a request to."""
    LARGE = "large"
    SMALL = "small"
    TINY  = "tiny"


@dataclass(frozen=True)
class ModelEndpoint:
    """Resolved model name + base URL for a tier."""
    model: str
    base_url: str
    api_key: str


# ---------------------------------------------------------------------------
# Resolution logic
# ---------------------------------------------------------------------------

def _resolve_tier(tier: ModelTier) -> ModelEndpoint:
    """Resolve environment variables for the given tier, cascading to larger
    tiers when a tier's config is not explicitly set."""

    api_key = os.getenv("OPENAI_API_KEY", "local")

    # Large tier — the "source of truth" fallback
    large_model = os.getenv("MODEL_LARGE") or os.getenv("LOCAL_MODEL", "gpt-4")
    large_url   = os.getenv("MODEL_LARGE_URL") or os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")

    if tier == ModelTier.LARGE:
        return ModelEndpoint(model=large_model, base_url=large_url, api_key=api_key)

    # Small tier — falls back to large
    small_model = os.getenv("MODEL_SMALL") or large_model
    small_url   = os.getenv("MODEL_SMALL_URL") or large_url

    if tier == ModelTier.SMALL:
        return ModelEndpoint(model=small_model, base_url=small_url, api_key=api_key)

    # Tiny tier — falls back to small, then large
    tiny_model = os.getenv("MODEL_TINY") or small_model
    tiny_url   = os.getenv("MODEL_TINY_URL") or small_url

    return ModelEndpoint(model=tiny_model, base_url=tiny_url, api_key=api_key)


# ---------------------------------------------------------------------------
# Cached AsyncOpenAI clients (one per unique base_url)
# ---------------------------------------------------------------------------

_clients: dict[str, object] = {}

# Track which base_urls have been confirmed unreachable so we don't
# retry health-checks on every request.
_unreachable_urls: set[str] = set()


def _is_url_reachable(base_url: str) -> bool:
    """Quick connectivity check — hit the /models endpoint with a short timeout."""
    if base_url in _unreachable_urls:
        return False
    import urllib.request, urllib.error
    # /models is a lightweight endpoint every OpenAI-compatible server exposes
    check_url = base_url.rstrip("/").removesuffix("/v1") + "/v1/models"
    try:
        req = urllib.request.Request(check_url, method="GET")
        req.add_header("Authorization", "Bearer local")
        urllib.request.urlopen(req, timeout=1.5)
        return True
    except Exception:
        logger.warning("Server at %s is unreachable — will fall back to LARGE tier", base_url)
        _unreachable_urls.add(base_url)
        return False


def get_client(tier: ModelTier):
    """Return a cached AsyncOpenAI client for the given tier.

    Returns None if the API key is not set (same behaviour as the
    existing get_openai_client() functions).

    If the tier's server is unreachable, transparently falls back to LARGE.
    """
    endpoint = _resolve_tier(tier)
    if not endpoint.api_key:
        return None

    # If the configured URL is unreachable and this isn't already LARGE, fall back
    if tier != ModelTier.LARGE and not _is_url_reachable(endpoint.base_url):
        large_ep = _resolve_tier(ModelTier.LARGE)
        logger.info("Falling back from %s (%s) → LARGE (%s)", tier.value, endpoint.base_url, large_ep.base_url)
        endpoint = large_ep

    if endpoint.base_url not in _clients:
        from openai import AsyncOpenAI
        _clients[endpoint.base_url] = AsyncOpenAI(
            api_key=endpoint.api_key,
            base_url=endpoint.base_url,
        )
        logger.info(
            "Created AsyncOpenAI client for tier=%s model=%s url=%s",
            tier.value, endpoint.model, endpoint.base_url,
        )
    return _clients[endpoint.base_url]


def get_model(tier: ModelTier) -> str:
    """Return the model name/alias for the given tier.

    Falls back to LARGE model name if the tier's server is unreachable.
    """
    endpoint = _resolve_tier(tier)
    if tier != ModelTier.LARGE and not _is_url_reachable(endpoint.base_url):
        return _resolve_tier(ModelTier.LARGE).model
    return endpoint.model


def get_client_and_model(tier: ModelTier):
    """Convenience: return (client, model_name) for a tier."""
    endpoint = _resolve_tier(tier)
    client = get_client(tier)
    return client, endpoint.model


# ---------------------------------------------------------------------------
# Task → Tier mapping
# ---------------------------------------------------------------------------

# Explicit mapping of high-level task names to tiers.  Call sites use
# get_task_client("counter_argument") instead of hard-coding a tier.

TASK_TIER_MAP: dict[str, ModelTier] = {
    # LARGE — quality-critical generation
    "counter_argument":     ModelTier.LARGE,
    "judge_intro":          ModelTier.LARGE,
    "judge_interrupt":      ModelTier.LARGE,
    "synthesize_question":  ModelTier.LARGE,

    # SMALL — fast analysis / classification
    "agent_analysis":       ModelTier.SMALL,
    "quality_assessment":   ModelTier.SMALL,
    "brief_summary":        ModelTier.SMALL,
    "seed_questions":       ModelTier.SMALL,

    # TINY — structured extraction / timeline
    "issue_extraction":     ModelTier.TINY,
    "agenda_generation":    ModelTier.TINY,
}


def get_task_client(task: str):
    """Return (client, model_name) for a named task."""
    tier = TASK_TIER_MAP.get(task, ModelTier.LARGE)
    return get_client_and_model(tier)


# ---------------------------------------------------------------------------
# Logging helper — print the resolved config at startup
# ---------------------------------------------------------------------------

def log_config():
    """Log the resolved model configuration for each tier."""
    for tier in ModelTier:
        ep = _resolve_tier(tier)
        logger.info(
            "  %-6s → model=%s  url=%s",
            tier.value.upper(), ep.model, ep.base_url,
        )
