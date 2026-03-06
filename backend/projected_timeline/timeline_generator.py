"""
Topic-agenda generator — SCOPE-inspired judicial forecast.

Generates N distinct predicted lists of topics the judge will raise during
a court hearing, each approached through a different judicial lens.

Two-phase approach:
  Phase 1 — Issue extraction  (≈ SCOPE reward model R̃)
             Read both briefs → case summary + shared key legal issues.

  Phase 2 — Agenda generation  (≈ SCOPE transition model T̃, one rollout per lens)
             For each of the N predefined judicial lenses, ask the model:
             "If this judge prioritises X, what topics would they cover and in
             what order?"  Each lens produces an independent predicted agenda.

The N predictions together form a space of plausible hearing trajectories —
analogous to SCOPE's MCTS exploring multiple conversation paths in semantic
space without running expensive full simulations.
"""

import asyncio
import json
import logging
import re

from .models import (
    TopicPredictionRequest,
    PredictedTopicSets,
    TopicPrediction,
    JudgeTopic,
)

logger = logging.getLogger("court-simulator.projected_timeline")

# ---------------------------------------------------------------------------
# Model routing — uses TINY tier for lightweight structured extraction
# ---------------------------------------------------------------------------

from model_router import get_task_client, task_extra_body, extract_content


def _get_model() -> str:
    """Return the model name for timeline tasks (TINY tier)."""
    _, model = get_task_client("issue_extraction")
    return model


def _get_client():
    client, _ = get_task_client("issue_extraction")
    if client is None:
        raise RuntimeError("Model router returned no client — check OPENAI_API_KEY.")
    return client


# ---------------------------------------------------------------------------
# Predefined judicial lenses
# Each lens defines a distinct angle through which a judge might approach
# the case.  The generator cycles through these up to num_predictions times.
# ---------------------------------------------------------------------------

JUDICIAL_LENSES = [
    {
        "lens": "Statutory Text & Plain Meaning",
        "guidance": (
            "Focus exclusively on what the relevant statutes and regulations "
            "say on their face. Prioritise textual ambiguities, definitions, "
            "and whether the plain meaning favours one side."
        ),
    },
    {
        "lens": "Precedent & Stare Decisis",
        "guidance": (
            "Focus on controlling case law and circuit precedent. Which prior "
            "decisions bind this court? Are there circuit splits? Does either "
            "party's argument require overruling or distinguishing key cases?"
        ),
    },
    {
        "lens": "Agency Deference & Administrative Law",
        "guidance": (
            "Focus on the role of agency interpretation, Chevron / Loper Bright "
            "deference, and whether the agency acted within its delegated authority. "
            "Probe the adequacy of the agency's reasoning and record."
        ),
    },
    {
        "lens": "Weakest Links in Each Party's Argument",
        "guidance": (
            "Identify the single most vulnerable point in the petitioner's argument "
            "and the single most vulnerable point in the respondent's argument. "
            "Build the agenda around stress-testing those weak spots."
        ),
    },
    {
        "lens": "Policy Consequences & Practical Impact",
        "guidance": (
            "Focus on what a ruling for each side would mean in practice — "
            "regulatory, environmental, commercial, and institutional consequences. "
            "Ask how the holding will be applied in future cases."
        ),
    },
    {
        "lens": "Procedural & Remedial Questions",
        "guidance": (
            "Focus on threshold issues: standing, ripeness, mootness, standard of "
            "review, and what the appropriate remedy would be if the court rules "
            "for either party. Is summary judgment even the right vehicle here?"
        ),
    },
    {
        "lens": "Constitutional Boundaries",
        "guidance": (
            "Focus on whether the statutes or agency actions at issue raise "
            "constitutional concerns — separation of powers, non-delegation, "
            "due process, or federalism — even if not the central issue on appeal."
        ),
    },
    {
        "lens": "Factual Record & Evidentiary Gaps",
        "guidance": (
            "Focus on what the factual record does and does not establish. "
            "Probe whether disputed facts should have precluded summary judgment "
            "and which party bears the burden of proof on contested factual points."
        ),
    },
    {
        "lens": "Equitable Considerations",
        "guidance": (
            "Focus on fairness, reliance interests, and equitable doctrines such "
            "as laches, estoppel, and unclean hands. How do equitable factors "
            "weigh when the law itself is ambiguous?"
        ),
    },
    {
        "lens": "Narrowest Grounds for Decision",
        "guidance": (
            "Focus on identifying the smallest possible holding that resolves "
            "the case — the grounds that avoid broad pronouncements and preserve "
            "the most flexibility for future panels."
        ),
    },
]

# ---------------------------------------------------------------------------
# Phase 1 — Issue extraction
# ---------------------------------------------------------------------------

_EXTRACT_SYSTEM = (
    "You are a senior federal appellate court analyst. "
    "Respond ONLY with valid JSON — no prose, no markdown fences."
)

_EXTRACT_USER = """\
Read these two legal briefs and return a single JSON object:

{{
  "case_summary": "<two neutral sentences describing the core dispute>",
  "key_legal_issues": ["<issue 1>", "<issue 2>", "<issue 3>", "<issue 4>", "<issue 5>"]
}}

=== PETITIONER BRIEF ===
{appellant}

=== RESPONDENT BRIEF ===
{appellee}"""


async def _extract_issues(client, appellant: str, appellee: str) -> dict:
    response = await client.chat.completions.create(
        model=_get_model(),
        messages=[
            {"role": "system", "content": _EXTRACT_SYSTEM},
            {
                "role": "user",
                "content": _EXTRACT_USER.format(
                    appellant=appellant[:12000],
                    appellee=appellee[:12000],
                ),
            },
        ],
        temperature=0.2,
        max_tokens=2048,
        extra_body=task_extra_body("issue_extraction"),
    )
    raw = extract_content(response)
    return _parse_json(raw, fallback={
        "case_summary": "Case summary unavailable.",
        "key_legal_issues": [],
    })


# ---------------------------------------------------------------------------
# Phase 2 — Per-lens agenda generation
# ---------------------------------------------------------------------------

_AGENDA_SYSTEM = (
    "You are a federal appellate judge preparing your question agenda for oral argument. "
    "Respond ONLY with valid JSON — no prose, no markdown fences."
)

_AGENDA_USER = """\
PROCEEDING TYPE : {proceeding_type}
CASE SUMMARY    : {case_summary}
KEY LEGAL ISSUES: {key_issues}

JUDICIAL LENS   : {lens}
LENS GUIDANCE   : {guidance}

Generate a predicted judge topic agenda for this lens.
Return a single JSON object:

{{
  "rationale": "<one sentence: why a judge using this lens would approach the case this way>",
  "topics": [
    {{
      "order": 1,
      "title": "<short topic label>",
      "description": "<1-2 sentences: what the judge would probe on this topic>",
      "target": "petitioner | respondent | both"
    }},
    ...
  ]
}}

Rules:
- Include 5 to 7 topics, ordered from most to least important for this lens.
- Each topic must be grounded in the actual arguments from the briefs.
- Vary which party each topic targets; do not target the same party for every topic.
- titles must be short phrases (3-8 words), not full sentences.

=== PETITIONER BRIEF ===
{appellant}

=== RESPONDENT BRIEF ===
{appellee}"""


def _normalise_target(raw: str) -> str:
    """Map model output to a valid Literal['petitioner', 'respondent', 'both']."""
    s = raw.lower()
    has_pet = "petitioner" in s or "appellant" in s
    has_res = "respondent" in s or "appellee" in s
    if has_pet and not has_res:
        return "petitioner"
    if has_res and not has_pet:
        return "respondent"
    return "both"


async def _generate_agenda(
    client,
    prediction_id: int,
    lens_def: dict,
    case_summary: str,
    key_issues: list,
    appellant: str,
    appellee: str,
    proceeding_type: str,
) -> TopicPrediction:
    response = await client.chat.completions.create(
        model=_get_model(),
        messages=[
            {"role": "system", "content": _AGENDA_SYSTEM},
            {
                "role": "user",
                "content": _AGENDA_USER.format(
                    proceeding_type=proceeding_type,
                    case_summary=case_summary,
                    key_issues=", ".join(key_issues),
                    lens=lens_def["lens"],
                    guidance=lens_def["guidance"],
                    appellant=appellant[:8000],
                    appellee=appellee[:8000],
                ),
            },
        ],
        temperature=0.2,
        max_tokens=4096,
        extra_body=task_extra_body("agenda_generation"),
    )

    raw = extract_content(response)
    logger.info("Lens %s — raw response start: %r", lens_def["lens"], raw[:300])
    data = _parse_json(raw, fallback={"rationale": "Parse error.", "topics": []})
    if data.get("rationale") == "Parse error.":
        json_idx = raw.find("{")
        logger.warning(
            "Lens %s parse failed — response length=%d, first '{' at %d, last 200 chars: %r",
            lens_def["lens"], len(raw), json_idx, raw[-200:] if len(raw) > 200 else raw,
        )

    topics = [
        JudgeTopic(
            order=t.get("order", i + 1),
            title=t.get("title", ""),
            description=t.get("description", ""),
            target=_normalise_target(t.get("target", "both")),
        )
        for i, t in enumerate(data.get("topics", []))
    ]

    return TopicPrediction(
        prediction_id=prediction_id,
        lens=lens_def["lens"],
        rationale=data.get("rationale", ""),
        topics=topics,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

SPARSE_MCTS_INITIAL_DEPTH = 5

async def generate_topic_sets(
    request: TopicPredictionRequest,
    use_mcts: bool = True,
    mcts_callback=None,
    progress_callback=None,
) -> PredictedTopicSets:
    """
    Generate N predicted judge topic agendas from two legal briefs.

    Phase 1: LLM extracts key issues from both briefs.
    Phase 2 (MCTS mode, default): LLM produces per-lens candidate topic pools,
             then MCTS ranks them into coherent ordered sequences — one path
             per prediction.  This gives each prediction a thematically ordered
             trajectory rather than a flat, unranked list.
    Phase 2 (fallback): original per-lens LLM ordering used when MCTS is
             disabled or produces no results.

    progress_callback — optional callable(event_type: str, data: dict).
        Fired with:
          ("status",  {"phase": ..., "detail": ...})
          ("agenda",  {"prediction_id": ..., "lens": ..., ...})  — one per lens
    """
    def _emit(event_type: str, data: dict) -> None:
        if progress_callback is not None:
            progress_callback(event_type, data)

    client = _get_client()
    num = max(1, min(request.num_predictions, len(JUDICIAL_LENSES)))

    _emit("status", {"phase": "extracting", "detail": "Extracting issues from briefs…"})
    logger.info("Extracting issues from briefs …")
    meta = await _extract_issues(client, request.appellant_brief, request.appellee_brief)
    case_summary = meta.get("case_summary", "")
    key_issues   = meta.get("key_legal_issues", [])

    _emit("status", {"phase": "agendas", "detail": f"Generating {num} topic agendas…"})
    logger.info("Generating %d per-lens candidate pools in parallel …", num)
    selected_lenses = JUDICIAL_LENSES[:num]

    # Use as_completed so we can stream each agenda to the UI as it finishes
    # rather than waiting for all to complete.
    tasks: dict[asyncio.Task, tuple[int, dict]] = {}
    for i, lens_def in enumerate(selected_lenses, start=1):
        task = asyncio.create_task(
            _generate_agenda(
                client=client,
                prediction_id=i,
                lens_def=lens_def,
                case_summary=case_summary,
                key_issues=key_issues,
                appellant=request.appellant_brief,
                appellee=request.appellee_brief,
                proceeding_type=request.proceeding_type,
            )
        )
        tasks[task] = (i, lens_def)

    per_lens: list[tuple[dict, TopicPrediction]] = [None] * num  # type: ignore[list-item]
    for coro in asyncio.as_completed(tasks.keys()):
        agenda = await coro
        # Figure out which task just completed
        finished_task = None
        for t in tasks:
            if t.done() and not getattr(t, "_streamed", False):
                try:
                    if t.result() is agenda:
                        finished_task = t
                        break
                except Exception:
                    pass
        if finished_task is None:
            # Fallback: find any unstreamed finished task
            for t in tasks:
                if t.done() and not getattr(t, "_streamed", False):
                    finished_task = t
                    break
        if finished_task is not None:
            setattr(finished_task, "_streamed", True)
            pred_id, lens_def = tasks[finished_task]
            per_lens[pred_id - 1] = (lens_def, agenda)
            _emit("agenda", {
                "prediction_id": pred_id,
                "lens": lens_def["lens"],
                "rationale": agenda.rationale,
                "topics": [t.model_dump() for t in agenda.topics],
            })
        else:
            logger.warning("Could not match agenda to task")

    # Safety: fill any None slots (shouldn't happen)
    per_lens = [(ld, ag) for ld, ag in per_lens if ld is not None]  # type: ignore[misc]

    if not use_mcts:
        predictions = [ag for _, ag in per_lens]
        return PredictedTopicSets(
            case_summary=case_summary,
            key_legal_issues=key_issues,
            predictions=predictions,
            total_predictions=len(predictions),
        )

    # ── MCTS Phase 2 (Sparse) ─────────────────────────────────────────────
    # Flatten all lens topics into a single candidate pool, then let MCTS
    # discover top-K coherent orderings.  Uses sparse MCTS: the initial tree
    # is depth-limited to SPARSE_MCTS_INITIAL_DEPTH topics per path.  The
    # full pool is preserved in the response so the live projection can
    # expand deeper as the student progresses.
    _emit("status", {"phase": "mcts", "detail": "Running sparse MCTS search on topic pool…"})
    topic_pool: list[dict] = []
    for lens_def, agenda in per_lens:
        if agenda.rationale == "Parse error.":
            logger.warning("Skipping lens %s — parse error", lens_def["lens"])
            continue
        for topic in agenda.topics:
            topic_pool.append({
                "title":       topic.title,
                "description": topic.description,
                "target":      topic.target,
                "lens":        lens_def["lens"],
                "_rationale":  agenda.rationale,
            })

    logger.info("Topic pool: %d topics from %d lenses", len(topic_pool), len(per_lens))

    predictions: list[TopicPrediction] = []
    mcts_tree: dict = {}
    if topic_pool:
        try:
            if mcts_callback is not None:
                from .mcts import run_generation_streaming
                mcts_paths, mcts_tree = await run_generation_streaming(
                    topic_pool, on_expand=mcts_callback, top_k=num,
                    root_label=case_summary,
                    max_depth=SPARSE_MCTS_INITIAL_DEPTH,
                )
            else:
                from .mcts import run_generation
                mcts_paths, mcts_tree = run_generation(
                    topic_pool, top_k=num, root_label=case_summary,
                    max_depth=SPARSE_MCTS_INITIAL_DEPTH,
                )
            logger.info("MCTS returned %d paths, %d tree nodes", len(mcts_paths), len(mcts_tree.get("nodes", [])))

            for path_idx, path in enumerate(mcts_paths[:num], start=1):
                # Dominant lens = whichever contributed the most topics to this path
                lens_counts: dict[str, int] = {}
                for t in path:
                    lens_counts[t.get("lens", "")] = lens_counts.get(t.get("lens", ""), 0) + 1
                dominant_lens = max(lens_counts, key=lens_counts.get, default="")

                rationale = next(
                    (ag.rationale for ld, ag in per_lens if ld["lens"] == dominant_lens),
                    "MCTS-generated trajectory",
                )

                topics = [
                    JudgeTopic(
                        order=j + 1,
                        title=t.get("title", ""),
                        description=t.get("description", ""),
                        target=_normalise_target(t.get("target", "both")),
                    )
                    for j, t in enumerate(path)
                ]
                predictions.append(
                    TopicPrediction(
                        prediction_id=path_idx,
                        lens=dominant_lens or f"Trajectory {path_idx}",
                        rationale=rationale,
                        topics=topics,
                    )
                )
        except Exception as exc:
            logger.warning("MCTS failed (%s); falling back to per-lens ordering.", exc)

    # Fall back to per-lens results if MCTS produced nothing
    if not predictions:
        predictions = [ag for _, ag in per_lens]

    # Strip internal keys from the pool before including in the response
    serialisable_pool = [
        {k: v for k, v in t.items() if not k.startswith("_")}
        for t in topic_pool
    ] if topic_pool else None

    final_tree = mcts_tree if mcts_tree else None
    logger.info(
        "generate_topic_sets done: %d predictions, tree_nodes=%s, pool=%d",
        len(predictions),
        len(mcts_tree.get("nodes", [])) if mcts_tree else 0,
        len(topic_pool),
    )

    return PredictedTopicSets(
        case_summary=case_summary,
        key_legal_issues=key_issues,
        predictions=predictions,
        total_predictions=len(predictions),
        mcts_tree=final_tree,
        full_topic_pool=serialisable_pool,
    )


# ---------------------------------------------------------------------------
# JSON parsing helper
# ---------------------------------------------------------------------------

def _escape_string_literals(text: str) -> str:
    """Escape bare control characters inside JSON string values."""
    result  = []
    in_str  = False
    i       = 0
    while i < len(text):
        ch = text[i]
        if ch == "\\" and in_str:
            result.append(ch)
            i += 1
            if i < len(text):
                result.append(text[i])
            i += 1
            continue
        if ch == '"':
            in_str = not in_str
            result.append(ch)
        elif in_str and ch == "\n":
            result.append("\\n")
        elif in_str and ch == "\r":
            result.append("\\r")
        elif in_str and ch == "\t":
            result.append("\\t")
        else:
            result.append(ch)
        i += 1
    return "".join(result)


def _extract_blob(text: str) -> str | None:
    """String-aware extraction of the outermost {...}."""
    start = text.find("{")
    if start == -1:
        return None
    depth    = 0
    in_str   = False
    esc_next = False
    end      = -1
    for i, ch in enumerate(text[start:], start):
        if esc_next:
            esc_next = False
            continue
        if ch == "\\" and in_str:
            esc_next = True
            continue
        if ch == '"':
            in_str = not in_str
            continue
        if in_str:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i
                break
    if end == -1:
        end = text.rfind("}")
    if end == -1:
        return None
    return text[start : end + 1]


def _repair_truncated_json(text: str) -> str | None:
    """Try to close an incomplete JSON object so it can be parsed.

    Handles the common case where a reasoning model runs out of tokens
    mid-JSON — e.g. the response ends with ``..."title": "Foo`` or
    ``..."topics": [{...}, {``.

    Returns the repaired string or None if no ``{`` was found.
    """
    start = text.find("{")
    if start == -1:
        return None
    fragment = text[start:]
    # Close any unclosed string literal
    in_str = False
    esc = False
    for ch in fragment:
        if esc:
            esc = False
            continue
        if ch == "\\" and in_str:
            esc = True
            continue
        if ch == '"':
            in_str = not in_str
    if in_str:
        fragment += '"'
    # Count unclosed braces/brackets and close them
    depth_obj = 0
    depth_arr = 0
    in_s = False
    esc2 = False
    for ch in fragment:
        if esc2:
            esc2 = False
            continue
        if ch == "\\" and in_s:
            esc2 = True
            continue
        if ch == '"':
            in_s = not in_s
            continue
        if in_s:
            continue
        if ch == '{':
            depth_obj += 1
        elif ch == '}':
            depth_obj -= 1
        elif ch == '[':
            depth_arr += 1
        elif ch == ']':
            depth_arr -= 1
    fragment += ']' * max(0, depth_arr) + '}' * max(0, depth_obj)
    return fragment


def _parse_json(text: str, fallback: dict) -> dict:
    # Strip <think>…</think> blocks produced by reasoning models (Qwen3, etc.)
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    text = re.sub(r"```(?:json)?\s*", "", text)
    text = re.sub(r"```\s*$", "", text, flags=re.MULTILINE)

    # Strip reasoning prefix: everything before the first '{' is likely
    # chain-of-thought from a reasoning model, not part of the JSON.
    json_start = text.find("{")
    if json_start > 0:
        text = text[json_start:]

    # Try json_repair if available (pip install json-repair)
    try:
        from json_repair import repair_json
        repaired = repair_json(text, return_objects=True)
        if isinstance(repaired, dict) and repaired:
            return repaired
    except ImportError:
        pass

    blob = _extract_blob(text)
    if blob is not None:
        for attempt_fn in (
            lambda b: b,
            _escape_string_literals,
            lambda b: re.sub(r",\s*([}\]])", r"\1", b),
        ):
            try:
                return json.loads(attempt_fn(blob))
            except (json.JSONDecodeError, TypeError):
                pass

    # Last resort: try to repair truncated JSON (model ran out of tokens)
    repaired_text = _repair_truncated_json(text)
    if repaired_text:
        for attempt_fn in (
            lambda b: b,
            lambda b: re.sub(r",\s*([}\]])", r"\1", b),
        ):
            try:
                return json.loads(attempt_fn(repaired_text))
            except (json.JSONDecodeError, TypeError):
                pass

    logger.warning("JSON parse failed after all recovery attempts; text[:300]=%s", text[:300])
    return fallback
