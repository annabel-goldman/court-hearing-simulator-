"""REST route for post-session LLM performance notes generation."""

import json
import logging
import re
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from model_router import get_task_client, extract_content, task_extra_body

logger = logging.getLogger("court-simulator.performance")
router = APIRouter(tags=["performance"])


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class QuestionRecord(BaseModel):
    id: str
    question: str
    timestamp: str
    sourceType: str
    agentId: Optional[str] = None
    agentName: str
    agentColor: Optional[str] = None


class TranscriptSegment(BaseModel):
    text: str
    timestamp: str


class PerformanceNotesRequest(BaseModel):
    sessionId: str
    startedAt: str
    endedAt: str
    durationSeconds: float
    proceedingType: str
    userRole: str
    useMultiAgentJudge: bool
    questions: List[QuestionRecord]
    transcriptSegments: List[TranscriptSegment]


class DimensionResult(BaseModel):
    score: int
    note: str


class PerformanceNotesResponse(BaseModel):
    dimensions: dict[str, DimensionResult]
    overall_note: str


# ---------------------------------------------------------------------------
# Timestamp enrichment
# ---------------------------------------------------------------------------

def _parse_ts(ts: str) -> float:
    """Parse an ISO-8601 timestamp string to a Unix float."""
    ts = ts.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(ts).timestamp()
    except ValueError:
        # Fallback: strip timezone info and try again as naive UTC
        ts_naive = re.sub(r"[+-]\d{2}:\d{2}$", "", ts)
        return datetime.fromisoformat(ts_naive).replace(tzinfo=timezone.utc).timestamp()


def _build_exchange_context(
    questions: List[QuestionRecord],
    segments: List[TranscriptSegment],
) -> str:
    """
    Pair each question with the transcript segments that follow it (up to the
    next question). Returns a formatted string for the LLM prompt.

    Truncates to the most recent 12 questions to stay within context budget.
    """
    if not questions:
        return "[no bench questions asked]"

    seg_times = [(_parse_ts(s.timestamp), s.text) for s in segments]
    q_times = [(_parse_ts(q.timestamp), q) for q in questions]

    # Guard: cap at 12 most recent to avoid blowing the context window
    if len(q_times) > 12:
        q_times = q_times[-12:]

    lines: list[str] = []
    for i, (qt, q) in enumerate(q_times):
        next_qt = q_times[i + 1][0] if i + 1 < len(q_times) else float("inf")

        response_segs = [
            (st, txt) for st, txt in seg_times
            if st > qt and st < next_qt
        ]

        if response_segs:
            first_t = response_segs[0][0]
            last_t = response_segs[-1][0]
            latency = round(first_t - qt, 1)
            duration = round(last_t - first_t, 1)
            words = sum(len(t.split()) for _, t in response_segs)
            preview = " ".join(t for _, t in response_segs)[:300]
        else:
            latency = duration = words = 0
            preview = "[no transcript captured for this exchange]"

        source_tag = q.agentName if q.sourceType == "multi_agent" else "Judge Engine"
        lines.append(
            f"Q{i + 1} [{source_tag}]: {q.question}\n"
            f"  → responded in {latency}s, {words} words, over {duration}s\n"
            f'  → "{preview}"'
        )

    return "\n\n".join(lines)


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

_DIMENSIONS = (
    "directness",
    "legal_anchoring",
    "responsiveness_under_pressure",
    "argument_development",
    "bench_engagement",
)

_SCHEMA_EXAMPLE = (
    '{"dimensions": {'
    '"directness": {"score": 7, "note": "..."},'
    '"legal_anchoring": {"score": 5, "note": "..."},'
    '"responsiveness_under_pressure": {"score": 8, "note": "..."},'
    '"argument_development": {"score": 6, "note": "..."},'
    '"bench_engagement": {"score": 7, "note": "..."}'
    '}, "overall_note": "..."}'
)


@router.post("/api/performance-notes", response_model=PerformanceNotesResponse)
async def generate_performance_notes(req: PerformanceNotesRequest):
    """Generate LLM-based multi-dimensional performance notes for a completed session."""
    client, model = get_task_client("performance_notes")
    if not client:
        raise HTTPException(
            status_code=503,
            detail="LLM not configured — cannot generate performance notes.",
        )

    exchange_context = _build_exchange_context(req.questions, req.transcriptSegments)
    total_words = sum(len(s.text.split()) for s in req.transcriptSegments)
    unique_askers = len({q.agentName for q in req.questions})
    duration_min = round(req.durationSeconds / 60, 1)

    system_msg = (
        "You are a moot court performance coach evaluating an attorney's oral argument session. "
        "You will be given a session transcript paired with bench questions and timing data. "
        "Score the attorney on five dimensions (1–10 each) and give a one-sentence coaching note per dimension. "
        "End with a two-to-three sentence overall_note. "
        "Return valid JSON only — no markdown, no commentary, no wrapping text."
    )

    user_msg = (
        f"SESSION SUMMARY:\n"
        f"  Duration: {duration_min} minutes\n"
        f"  Total bench questions: {len(req.questions)}\n"
        f"  Unique questioners: {unique_askers}\n"
        f"  Approximate total words spoken by attorney: {total_words}\n"
        f"  Multi-agent judge mode: {req.useMultiAgentJudge}\n\n"
        f"QUESTION-BY-QUESTION EXCHANGES (with timing and word counts):\n"
        f"{exchange_context}\n\n"
        f"SCORING DIMENSIONS:\n"
        f"  directness                    — did answers reach the point quickly, without hedging?\n"
        f"  legal_anchoring               — were cases, statutes, or constitutional text cited?\n"
        f"  responsiveness_under_pressure — response latency and fluency under bench pressure\n"
        f"  argument_development          — did answers build the theory of error, or repeat?\n"
        f"  bench_engagement              — did the argument invite substantive judicial scrutiny?\n\n"
        f"Return JSON in exactly this shape (no other text):\n{_SCHEMA_EXAMPLE}"
    )

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.4,
            max_tokens=600,
            extra_body=task_extra_body("performance_notes"),
        )
    except Exception as e:
        logger.error("[performance_notes] LLM call failed: %s", e)
        raise HTTPException(status_code=502, detail=f"LLM call failed: {e}")

    content = extract_content(response)

    # Strip markdown code fences if the model wrapped output in them
    if content.startswith("```"):
        lines = content.split("\n")
        content = "\n".join(lines[1:-1]) if len(lines) > 2 else content

    json_match = re.search(r"\{[\s\S]*\}", content)
    if not json_match:
        logger.error("[performance_notes] No JSON in response: %s", content[:200])
        raise HTTPException(status_code=502, detail="LLM returned non-JSON output")

    try:
        raw = json.loads(json_match.group(0))
    except json.JSONDecodeError as e:
        logger.error("[performance_notes] JSON parse error: %s — raw: %s", e, content[:200])
        raise HTTPException(status_code=502, detail="LLM returned malformed JSON")

    dims_raw = raw.get("dimensions", {})
    dimensions: dict[str, DimensionResult] = {}
    for key in _DIMENSIONS:
        d = dims_raw.get(key, {})
        dimensions[key] = DimensionResult(
            score=max(1, min(10, int(d.get("score", 5)))),
            note=str(d.get("note", "No feedback available.")),
        )

    return PerformanceNotesResponse(
        dimensions=dimensions,
        overall_note=str(raw.get("overall_note", "Session complete.")),
    )
