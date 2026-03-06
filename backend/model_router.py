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

Reachability is checked once at startup via `probe_all_tiers()` and then
refreshed in the background every 30 s via `_background_reachability_refresh()`.
This avoids any blocking I/O on LLM hot-path calls.

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
import time
import logging
from enum import Enum
from dataclasses import dataclass
from typing import Optional

import anyio
import httpx
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
# Reachability cache  (populated at startup, refreshed in background)
# ---------------------------------------------------------------------------

# url → (is_reachable, monotonic_timestamp)
_reachability_cache: dict[str, tuple[bool, float]] = {}
_REACHABILITY_TTL = 60.0   # seconds before a cache entry is considered stale


def _is_url_reachable(base_url: str) -> bool:
    """Pure cache lookup — no network I/O.

    Returns True (optimistic) if the URL has never been probed yet so that
    the first LLM call goes through while the startup probe is in flight.
    Call `probe_all_tiers()` at startup to populate the cache.
    """
    entry = _reachability_cache.get(base_url)
    if entry is None:
        return True   # optimistic: assume reachable until proven otherwise
    reachable, _ = entry
    return reachable


async def _probe_url(base_url: str) -> bool:
    """Async HTTP probe of a single base URL.  Non-blocking."""
    check_url = base_url.rstrip("/").removesuffix("/v1") + "/v1/models"
    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            r = await client.get(
                check_url,
                headers={"Authorization": "Bearer local"},
            )
            return r.status_code < 500
    except Exception:
        return False


async def probe_all_tiers() -> None:
    """Probe all configured tier URLs and populate the reachability cache.

    Call this once from the FastAPI lifespan before the server starts
    accepting requests.  Skips duplicate URLs so a single-GPU setup
    (all tiers pointing at the same server) only issues one request.
    """
    seen: set[str] = set()
    for tier in ModelTier:
        ep = _resolve_tier(tier)
        if ep.base_url in seen:
            continue
        seen.add(ep.base_url)
        reachable = await _probe_url(ep.base_url)
        _reachability_cache[ep.base_url] = (reachable, time.monotonic())
        status = "OK" if reachable else "UNREACHABLE"
        logger.info("Startup probe %-6s %s → %s", tier.value.upper(), ep.base_url, status)


async def _background_reachability_refresh() -> None:
    """Background task: re-probe URLs whose cache entries have gone stale.

    Runs forever; intended to be launched via anyio task group in the
    FastAPI lifespan so it shuts down cleanly when the server exits.
    """
    while True:
        await anyio.sleep(30)
        now = time.monotonic()
        seen: set[str] = set()
        for tier in ModelTier:
            ep = _resolve_tier(tier)
            if ep.base_url in seen:
                continue
            seen.add(ep.base_url)
            entry = _reachability_cache.get(ep.base_url)
            if entry is None or (now - entry[1]) > _REACHABILITY_TTL:
                reachable = await _probe_url(ep.base_url)
                prev = _reachability_cache.get(ep.base_url, (None, 0))[0]
                _reachability_cache[ep.base_url] = (reachable, now)
                if prev is not None and prev != reachable:
                    state = "back online" if reachable else "went offline"
                    logger.warning(
                        "Tier %s (%s) %s", tier.value.upper(), ep.base_url, state
                    )


# ---------------------------------------------------------------------------
# Effective endpoint resolution (applies reachability fallback)
# ---------------------------------------------------------------------------

def _resolve_effective_endpoint(tier: ModelTier) -> ModelEndpoint:
    """Like _resolve_tier, but applies runtime overrides and the reachability fallback.

    Priority order:
      1. Runtime override (_runtime_overrides) — set by the external LLM config feature
      2. Env-var resolution with reachability fallback to LARGE

    Both the client URL and the model name come from the same resolved endpoint
    so they always match — even after fallback.
    """
    # 1. Runtime override takes absolute priority
    if tier in _runtime_overrides:
        return _runtime_overrides[tier]

    # 2. Normal env-var resolution + reachability fallback
    endpoint = _resolve_tier(tier)
    if tier != ModelTier.LARGE and not _is_url_reachable(endpoint.base_url):
        large_ep = _resolve_tier(ModelTier.LARGE)
        logger.info(
            "Falling back %s (%s) → LARGE (%s)",
            tier.value, endpoint.base_url, large_ep.base_url,
        )
        endpoint = large_ep
    return endpoint


# ---------------------------------------------------------------------------
# Runtime overrides — set by the Judge Config external LLM feature
# ---------------------------------------------------------------------------

# Maps a ModelTier to a custom ModelEndpoint supplied at runtime (e.g. via
# POST /api/judge-config with external_llm.enabled=true).  These take
# priority over env-var resolution AND reachability fallback, so the user's
# chosen endpoint is always used when an override is active.
_runtime_overrides: dict[ModelTier, ModelEndpoint] = {}


def apply_runtime_override(
    tier: ModelTier, base_url: str, model: str, api_key: str
) -> None:
    """Install a runtime endpoint override for the given tier.

    Pre-creates the AsyncOpenAI client so the first subsequent LLM call
    is not delayed by client construction.  Marks the URL as reachable
    optimistically — the background refresh will detect real failures
    within 30 s.

    Thread-safe in CPython (dict assignment is atomic under the GIL).
    """
    endpoint = ModelEndpoint(model=model, base_url=base_url, api_key=api_key)
    _runtime_overrides[tier] = endpoint
    # Pre-create client (lazy import handled inside _get_or_create_client)
    _get_or_create_client(endpoint)
    # Mark reachable so the fallback logic doesn't immediately route elsewhere
    _reachability_cache[base_url] = (True, time.monotonic())
    logger.info(
        "Runtime override applied for %s → model=%s url=%s",
        tier.value.upper(), model, base_url,
    )


def clear_runtime_override(tier: ModelTier) -> None:
    """Remove the runtime override for a tier, reverting to env-var resolution."""
    _runtime_overrides.pop(tier, None)
    logger.info("Runtime override cleared for %s", tier.value.upper())


# ---------------------------------------------------------------------------
# Cached AsyncOpenAI clients (one per unique base_url)
# ---------------------------------------------------------------------------

_clients: dict[str, object] = {}


def _get_or_create_client(endpoint: ModelEndpoint):
    if not endpoint.api_key:
        return None
    if endpoint.base_url not in _clients:
        from openai import AsyncOpenAI
        _clients[endpoint.base_url] = AsyncOpenAI(
            api_key=endpoint.api_key,
            base_url=endpoint.base_url,
        )
        logger.info(
            "Created AsyncOpenAI client model=%s url=%s",
            endpoint.model, endpoint.base_url,
        )
    return _clients[endpoint.base_url]


def get_client(tier: ModelTier):
    """Return a cached AsyncOpenAI client for the given tier.

    Transparently falls back to LARGE if the tier's server is unreachable.
    Returns None if no API key is configured.
    """
    return _get_or_create_client(_resolve_effective_endpoint(tier))


def get_model(tier: ModelTier) -> str:
    """Return the model name/alias for the given tier (after fallback)."""
    return _resolve_effective_endpoint(tier).model


def get_client_and_model(tier: ModelTier):
    """Convenience: return (client, model_name) for a tier.

    Both values come from the same resolved endpoint, so the model name
    always matches the server the client points to — even after fallback.
    """
    endpoint = _resolve_effective_endpoint(tier)
    return _get_or_create_client(endpoint), endpoint.model


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
    "argument_scoring":     ModelTier.SMALL,
    "opponent_response":    ModelTier.SMALL,

    # TINY — structured extraction / timeline / selection
    "issue_extraction":     ModelTier.TINY,
    "agenda_generation":    ModelTier.TINY,
    "question_selection":   ModelTier.TINY,
}


def get_task_client(task: str):
    """Return (client, model_name) for a named task."""
    tier = TASK_TIER_MAP.get(task, ModelTier.LARGE)
    return get_client_and_model(tier)


# ---------------------------------------------------------------------------
# Helpers for thinking-model compatibility
# ---------------------------------------------------------------------------

def is_local_endpoint(tier: ModelTier) -> bool:
    """Return True if the resolved endpoint for *tier* is a local llama-server.

    Used to decide whether to pass ``chat_template_kwargs`` in extra_body —
    that parameter is llama-server-specific and ignored (or misinterpreted)
    by remote APIs such as OpenRouter.
    """
    base_url = _resolve_effective_endpoint(tier).base_url
    return any(h in base_url for h in ("localhost", "127.0.0.1", "0.0.0.0"))


# Tasks where thinking tokens are allowed (e.g. topic/agenda creation).
# For these, we return {} so the model can reason. All other tasks disable thinking.
TASKS_WITH_THINKING_ENABLED: frozenset[str] = frozenset({
    "issue_extraction",
})


def local_extra_body(tier: ModelTier, *, allow_thinking: bool = False) -> dict:
    """Return the extra_body dict for thinking-mode control.

    When allow_thinking is True: returns ``{}`` (model may use thinking).
    Otherwise: ``{"chat_template_kwargs": {"enable_thinking": False}}``.
    """
    if allow_thinking:
        return {}
    return {"chat_template_kwargs": {"enable_thinking": False}}


def task_extra_body(task: str) -> dict:
    """Return the extra_body dict for a named task.

    Tasks in ``TASKS_WITH_THINKING_ENABLED`` (e.g. topic creation) get thinking
    allowed. All others get thinking disabled.
    """
    return local_extra_body(
        TASK_TIER_MAP.get(task, ModelTier.LARGE),
        allow_thinking=(task in TASKS_WITH_THINKING_ENABLED),
    )


def extract_content(response) -> str:
    """Extract the text reply from a chat completion response.

    Handles both standard (``message.content``) and thinking-model responses
    where ``content`` may be ``None`` or empty and the actual output lives in
    a vendor-specific field such as ``reasoning_content`` or ``reasoning``
    (common on OpenRouter and some local servers).

    Strips both complete ``<think>…</think>`` blocks **and** unclosed
    ``<think>`` prefixes (model exhausted its token budget mid-reasoning).

    Returns an empty string if nothing useful is found.
    """
    import re as _re

    def _strip_think(text: str) -> str:
        """Remove closed and unclosed <think> blocks from *text*."""
        text = _re.sub(r"<think>.*?</think>", "", text, flags=_re.DOTALL).strip()
        # Handle unclosed <think> (model ran out of tokens mid-reasoning)
        if "<think>" in text:
            text = _re.sub(r"<think>[\s\S]*", "", text).strip()
        return text

    if not response.choices:
        return ""
    msg = response.choices[0].message
    content = (msg.content or "").strip()
    if content:
        content = _strip_think(content)
        if content:
            return content

    # Fallback: check non-standard reasoning/thinking fields that thinking
    # models (DeepSeek-R1, Qwen3-thinking, GLM-4.5) may populate instead.
    extras: dict = getattr(msg, "model_extra", None) or {}
    for key in ("reasoning_content", "reasoning", "thinking"):
        val = extras.get(key) or getattr(msg, key, None)
        if val and isinstance(val, str) and val.strip():
            cleaned = _strip_think(val)
            if cleaned:
                return cleaned

    return ""


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
