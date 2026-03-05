"""
FastAPI router for the projected topic-agenda feature.

Endpoints
---------
POST /api/projected-timeline/generate
    Body: { appellant_brief, appellee_brief, num_predictions?, proceeding_type? }
    Returns: PredictedTopicSets

POST /api/projected-timeline/generate-stream
    Body: same as /generate
    Returns: text/event-stream  — SSE events:
        data: {"type": "status", "phase": "llm"}
        data: {"type": "node",   "data": {"id": int, "p": int, "d": int}}
        data: {"type": "done",   "data": <PredictedTopicSets JSON>}

POST /api/projected-timeline/tracker/init
POST /api/projected-timeline/tracker/{session_id}/update
GET  /api/projected-timeline/tracker/{session_id}/state
DELETE /api/projected-timeline/tracker/{session_id}
GET  /api/projected-timeline/health
"""

import asyncio
import json
import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import StreamingResponse

from .models import (
    HearingTurn,
    PredictedTopicSets,
    RegenerationRequest,
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
# Streaming generate endpoint (SSE)
# ---------------------------------------------------------------------------

@router.post("/generate-stream")
async def generate_projected_timeline_stream(request: TopicPredictionRequest):
    """
    SSE endpoint that streams MCTS node-expansion events while the generation
    runs, then sends the full PredictedTopicSets as the final event.

    Event types
    -----------
    {"type": "status", "phase": "...", "detail": "..."}  – phase progress
    {"type": "agenda", "data": {...}}  – one per-lens agenda as it completes
    {"type": "node",   "data": {           – one MCTS node expanded
                          "id": int,         sequential node id
                          "p":  int,         parent id  (-1 = root)
                          "d":  int }}       depth in tree
    {"type": "done",   "data": {...}}       – full PredictedTopicSets payload
    """
    request.num_predictions = max(1, min(request.num_predictions, 10))
    if not request.appellant_brief.strip():
        raise HTTPException(status_code=422, detail="appellant_brief must not be empty.")
    if not request.appellee_brief.strip():
        raise HTTPException(status_code=422, detail="appellee_brief must not be empty.")

    event_queue: asyncio.Queue = asyncio.Queue()

    def on_expand(node_id: int, parent_id: int, depth: int) -> None:
        """Synchronous callback — safe to call from within async context."""
        event_queue.put_nowait({"type": "node", "data": {"id": node_id, "p": parent_id, "d": depth}})

    def on_progress(event_type: str, data: dict) -> None:
        """Synchronous callback for status / agenda events."""
        event_queue.put_nowait({"type": event_type, "data": data})

    async def event_generator():
        gen_task = asyncio.create_task(
            generate_topic_sets(
                request,
                mcts_callback=on_expand,
                progress_callback=on_progress,
            )
        )

        # Interleave: yield to the event loop, drain the queue, repeat
        while not gen_task.done():
            await asyncio.sleep(0)
            drained = 0
            while not event_queue.empty() and drained < 50:
                event = event_queue.get_nowait()
                yield f"data: {json.dumps(event)}\n\n"
                drained += 1

        # Drain any events queued after the task finished
        while not event_queue.empty():
            event = event_queue.get_nowait()
            yield f"data: {json.dumps(event)}\n\n"

        try:
            result = gen_task.result()
            yield f"data: {json.dumps({'type': 'done', 'data': result.model_dump()})}\n\n"
        except Exception as exc:
            logger.exception("Streaming generation failed")
            yield f"data: {json.dumps({'type': 'error', 'detail': str(exc)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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
async def update_tracker(session_id: str, turn: HearingTurn, bg: BackgroundTasks):
    """
    Submit one spoken turn (judge, appellant, or appellee) to the tracker.

    - Judge turns update per-agenda confidence scores via cosine similarity.
    - Human turns mark the closest matching topic as addressed and return
      the matched topic title for UI highlighting.

    Quality is scored immediately via heuristic; LLM refinement runs as a
    background task so the response is never blocked by an LLM call.

    Returns TrackerStateResponse with ranked agendas, coverage, and a flag
    indicating whether AR regeneration is recommended.
    """
    tracker = tracker_store.get_session(session_id)
    if tracker is None:
        raise HTTPException(status_code=404, detail=f"Tracker session '{session_id}' not found.")
    state, refinement_args = tracker.update(turn)
    if refinement_args:
        bg.add_task(tracker.schedule_quality_refinement, *refinement_args)
    return state


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


# ---------------------------------------------------------------------------
# Adaptive regeneration  (AR)
# ---------------------------------------------------------------------------

@router.post("/tracker/{session_id}/regenerate")
async def regenerate_weak_agendas(session_id: str, request: RegenerationRequest):
    """
    Trigger adaptive regeneration for weak-scoring agendas.

    Called when TrackerStateResponse.regeneration_needed is True.
    Re-generates agendas that have fallen below the confidence threshold,
    incorporating the transcript heard so far as additional context.

    Returns the updated TrackerStateResponse after merging the new agendas.
    """
    tracker = tracker_store.get_session(session_id)
    if tracker is None:
        raise HTTPException(status_code=404, detail=f"Tracker session '{session_id}' not found.")

    state = tracker.state()
    if not state.regeneration_needed:
        return {"regenerated": False, "reason": "Regeneration not needed — confidence is above threshold.", "state": state}

    # Build a transcript string from the submitted turns
    transcript_text = "\n".join(
        f"{t.speaker.upper()}: {t.utterance}" for t in request.turns
    )

    # Determine which agendas to regenerate — weakest ones or specified ids
    target_ids = set(request.target_prediction_ids) if request.target_prediction_ids else None
    # If no targets specified, pick the bottom half of agendas by confidence
    if target_ids is None:
        sorted_confs = sorted(state.agenda_confidences, key=lambda ac: ac.confidence)
        half = max(1, len(sorted_confs) // 2)
        target_ids = {ac.prediction_id for ac in sorted_confs[:half]}

    logger.info(
        "AR: regenerating %d agendas for session %s (targets: %s)",
        len(target_ids), session_id, target_ids,
    )

    # Re-generate using the original endpoint logic with transcript as extra context
    # The caller provides the turns heard so far, which we append to the briefs
    # as "hearing context" so the LLM can produce better-targeted agendas.
    try:
        regen_request = TopicPredictionRequest(
            appellant_brief=f"[Hearing transcript so far]\n{transcript_text}\n\n[Original Brief]\n(see prior generation)",
            appellee_brief="(see prior generation)",
            num_predictions=len(target_ids),
        )
        new_topics = await generate_topic_sets(regen_request)
        return {
            "regenerated": True,
            "new_predictions": new_topics.model_dump(),
            "target_prediction_ids": list(target_ids),
            "state": tracker.state(),
        }
    except Exception as exc:
        logger.exception("AR regeneration failed for session %s", session_id)
        raise HTTPException(status_code=500, detail=str(exc))
