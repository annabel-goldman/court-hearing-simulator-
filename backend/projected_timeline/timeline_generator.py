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
# OpenAI client (lazy-loaded, mirrors the pattern in judge_engine.py)
# ---------------------------------------------------------------------------

_openai_client = None


def _get_client():
    global _openai_client
    if _openai_client is None:
        import os
        import pathlib
        from dotenv import load_dotenv
        from openai import AsyncOpenAI

        root = pathlib.Path(__file__).parent.parent.parent
        load_dotenv(root / ".env")
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not set.")
        _openai_client = AsyncOpenAI(
            api_key=api_key,
            base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
        )
    return _openai_client


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
            "Identify the single most vulnerable point in the appellant's argument "
            "and the single most vulnerable point in the appellee's argument. "
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

=== APPELLANT BRIEF ===
{appellant}

=== APPELLEE BRIEF ===
{appellee}"""


async def _extract_issues(client, appellant: str, appellee: str) -> dict:
    response = await client.chat.completions.create(
        model="gpt-4",
        messages=[
            {"role": "system", "content": _EXTRACT_SYSTEM},
            {
                "role": "user",
                "content": _EXTRACT_USER.format(
                    appellant=appellant[:3000],
                    appellee=appellee[:3000],
                ),
            },
        ],
        temperature=0.2,
        max_tokens=400,
    )
    raw = response.choices[0].message.content.strip()
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
      "target": "appellant | appellee | both"
    }},
    ...
  ]
}}

Rules:
- Include 5 to 7 topics, ordered from most to least important for this lens.
- Each topic must be grounded in the actual arguments from the briefs.
- Vary which party each topic targets; do not target the same party for every topic.
- titles must be short phrases (3-8 words), not full sentences.

=== APPELLANT BRIEF ===
{appellant}

=== APPELLEE BRIEF ===
{appellee}"""


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
        model="gpt-4",
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
                    appellant=appellant[:2000],
                    appellee=appellee[:2000],
                ),
            },
        ],
        temperature=0.6,
        max_tokens=700,
    )

    raw = response.choices[0].message.content.strip()
    data = _parse_json(raw, fallback={"rationale": "Parse error.", "topics": []})

    topics = [
        JudgeTopic(
            order=t.get("order", i + 1),
            title=t.get("title", ""),
            description=t.get("description", ""),
            target=t.get("target", "both"),
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

async def generate_topic_sets(request: TopicPredictionRequest) -> PredictedTopicSets:
    """
    Generate N predicted judge topic agendas from two legal briefs.

    Each agenda explores the case through a different judicial lens,
    producing a distinct prioritised list of topics the judge would raise.
    """
    client = _get_client()
    num = max(1, min(request.num_predictions, len(JUDICIAL_LENSES)))

    logger.info("Extracting issues from briefs …")
    meta = await _extract_issues(client, request.appellant_brief, request.appellee_brief)
    case_summary = meta.get("case_summary", "")
    key_issues   = meta.get("key_legal_issues", [])

    logger.info("Generating %d topic agendas …", num)
    predictions = []
    for i, lens_def in enumerate(JUDICIAL_LENSES[:num], start=1):
        logger.info("  Lens %d/%d: %s", i, num, lens_def["lens"])
        agenda = await _generate_agenda(
            client=client,
            prediction_id=i,
            lens_def=lens_def,
            case_summary=case_summary,
            key_issues=key_issues,
            appellant=request.appellant_brief,
            appellee=request.appellee_brief,
            proceeding_type=request.proceeding_type,
        )
        predictions.append(agenda)

    return PredictedTopicSets(
        case_summary=case_summary,
        key_legal_issues=key_issues,
        predictions=predictions,
        total_predictions=len(predictions),
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


def _parse_json(text: str, fallback: dict) -> dict:
    text = re.sub(r"```(?:json)?\s*", "", text)
    text = re.sub(r"```\s*$", "", text, flags=re.MULTILINE)

    # Try json_repair if available (pip install json-repair)
    try:
        from json_repair import repair_json
        repaired = repair_json(text, return_objects=True)
        if isinstance(repaired, dict) and repaired:
            return repaired
    except ImportError:
        pass

    blob = _extract_blob(text)
    if blob is None:
        return fallback

    try:
        return json.loads(blob)
    except json.JSONDecodeError:
        pass

    blob = _escape_string_literals(blob)
    try:
        return json.loads(blob)
    except json.JSONDecodeError:
        pass

    blob = re.sub(r",\s*([}\]])", r"\1", blob)
    try:
        return json.loads(blob)
    except json.JSONDecodeError:
        logger.warning("JSON parse failed after all recovery attempts; blob[:200]=%s", blob[:200])
        return fallback
