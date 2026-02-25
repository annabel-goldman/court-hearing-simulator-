"""
FastAPI router for the projected topic-agenda feature.

Endpoints
---------
POST /api/projected-timeline/generate
    Body: { appellant_brief, appellee_brief, num_predictions?, proceeding_type? }
    Returns: PredictedTopicSets

POST /api/projected-timeline/tracker/init
    Body: { predicted_topic_sets, initial_judge_utterance? }
    Returns: { session_id, state: TrackerStateResponse }

POST /api/projected-timeline/tracker/{session_id}/update
    Body: HearingTurn  { speaker, utterance }
    Returns: TrackerStateResponse

GET  /api/projected-timeline/tracker/{session_id}/state
    Returns: TrackerStateResponse

DELETE /api/projected-timeline/tracker/{session_id}
    Returns: { deleted: true }

GET  /api/projected-timeline/health
    Returns: { status: "ok" }
"""

import logging

from fastapi import APIRouter, HTTPException

from .models import (
    HearingTurn,
    PredictedTopicSets,
    TopicPredictionRequest,
    TrackerInitRequest,
    TrackerStateResponse,
)
from .timeline_generator import generate_topic_sets
from . import tracker as tracker_store

logger = logging.getLogger("court-simulator.projected_timeline")

router = APIRouter(prefix="/api/projected-timeline", tags=["projected-timeline"])


@router.get("/health")
async def health():
    return {"status": "ok", "service": "projected-timeline"}


@router.post("/generate", response_model=PredictedTopicSets)
async def generate_projected_timeline(request: TopicPredictionRequest):
    """
    Generate N distinct predicted judge topic agendas from two legal briefs.

    Each prediction represents a different judicial lens — a plausible way a
    judge could prioritise and structure their questions during the hearing.
    Together the N predictions cover the space of likely hearing trajectories.

    Request body
    ------------
    - appellant_brief  : str  — full text of the appellant's brief
    - appellee_brief   : str  — full text of the appellee's brief
    - num_predictions  : int  — number of distinct agendas (1–10, default 5)
    - proceeding_type  : str  — e.g. "appellate argument" (default)

    Returns
    -------
    PredictedTopicSets with case_summary, key_legal_issues, and a list of
    TopicPrediction objects — each containing a lens name, rationale, and
    an ordered list of JudgeTopic items.
    """
    request.num_predictions = max(1, min(request.num_predictions, 10))

    if not request.appellant_brief.strip():
        raise HTTPException(status_code=422, detail="appellant_brief must not be empty.")
    if not request.appellee_brief.strip():
        raise HTTPException(status_code=422, detail="appellee_brief must not be empty.")

    try:
        result = await generate_topic_sets(request)
        logger.info(
            "Generated %d topic agendas for %s",
            result.total_predictions,
            request.proceeding_type,
        )
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except ValueError as exc:
        logger.error("Topic agenda parse error: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc))
    except Exception as exc:
        logger.exception("Unexpected error generating topic agendas")
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# Tracker endpoints
# ---------------------------------------------------------------------------

@router.post("/tracker/init")
async def init_tracker(request: TrackerInitRequest):
    """
    Initialise a trajectory tracker session from a completed /generate response.

    Embeds all predicted topic texts once, then optionally processes an opening
    judge statement to prime the confidence scores.

    Returns { session_id, state }.
    """
    tracker = tracker_store.create_session(request.predicted_topic_sets)

    if request.initial_judge_utterance and request.initial_judge_utterance.strip():
        tracker.update(HearingTurn(speaker="judge", utterance=request.initial_judge_utterance))

    return {"session_id": tracker.session_id, "state": tracker.state()}


@router.post("/tracker/{session_id}/update", response_model=TrackerStateResponse)
async def update_tracker(session_id: str, turn: HearingTurn):
    """
    Submit one spoken turn (judge, appellant, or appellee) to the tracker.

    - Judge turns update per-agenda confidence scores via cosine similarity.
    - Human turns mark the closest matching topic as addressed and return
      the matched topic title for UI highlighting.

    Returns TrackerStateResponse with ranked agendas, coverage, and a flag
    indicating whether AR regeneration is recommended.
    """
    tracker = tracker_store.get_session(session_id)
    if tracker is None:
        raise HTTPException(status_code=404, detail=f"Tracker session '{session_id}' not found.")
    return tracker.update(turn)


@router.get("/tracker/{session_id}/state", response_model=TrackerStateResponse)
async def get_tracker_state(session_id: str):
    """Return the current tracker state without advancing the turn counter."""
    tracker = tracker_store.get_session(session_id)
    if tracker is None:
        raise HTTPException(status_code=404, detail=f"Tracker session '{session_id}' not found.")
    return tracker.state()


@router.delete("/tracker/{session_id}")
async def delete_tracker(session_id: str):
    """Clean up a tracker session (call when the hearing ends)."""
    deleted = tracker_store.delete_session(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Tracker session '{session_id}' not found.")
    return {"deleted": True, "session_id": session_id}
