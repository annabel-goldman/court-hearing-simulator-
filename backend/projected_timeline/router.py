"""
FastAPI router for the projected topic-agenda feature.

Endpoints
---------
POST /api/projected-timeline/generate-stream
    Body: { appellant_brief, appellee_brief, num_predictions?, proceeding_type? }
    Returns: text/event-stream  — SSE events:
        data: {"type": "status", "phase": "llm"}
        data: {"type": "node",   "data": {"id": int, "p": int, "d": int}}
        data: {"type": "done",   "data": <PredictedTopicSets JSON>}
"""

import asyncio
import json
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from .models import TopicPredictionRequest
from .timeline_generator import generate_topic_sets

logger = logging.getLogger("court-simulator.projected_timeline")

router = APIRouter(prefix="/api/projected-timeline", tags=["projected-timeline"])


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
