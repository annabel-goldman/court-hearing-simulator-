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

import json
import logging
from collections import deque

import anyio
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

    # Thread-safe buffer: callbacks are synchronous and may fire from thread pool,
    # so we use a deque (thread-safe append/popleft under CPython).
    event_buffer: deque[dict] = deque()

    def on_expand(node_id: int, parent_id: int, depth: int) -> None:
        """Synchronous callback — safe to call from within async or threaded context."""
        event_buffer.append({"type": "node", "data": {"id": node_id, "p": parent_id, "d": depth}})

    def on_progress(event_type: str, data: dict) -> None:
        """Synchronous callback for status / agenda events."""
        event_buffer.append({"type": event_type, "data": data})

    async def event_generator():
        gen_done = False
        result_holder: list = []

        async def _run_generation():
            nonlocal gen_done
            try:
                result = await generate_topic_sets(
                    request,
                    mcts_callback=on_expand,
                    progress_callback=on_progress,
                )
                result_holder.append(result)
            except Exception as exc:
                result_holder.append(exc)
            finally:
                gen_done = True

        async with anyio.create_task_group() as tg:
            tg.start_soon(_run_generation)

            # Poll: drain events while generation runs
            while not gen_done:
                await anyio.sleep(0.05)
                while event_buffer:
                    event = event_buffer.popleft()
                    yield f"data: {json.dumps(event)}\n\n"

            # Drain remaining events after generation completes
            while event_buffer:
                event = event_buffer.popleft()
                yield f"data: {json.dumps(event)}\n\n"

            # Emit final result
            if result_holder and isinstance(result_holder[0], Exception):
                logger.exception("Streaming generation failed", exc_info=result_holder[0])
                yield f"data: {json.dumps({'type': 'error', 'detail': str(result_holder[0])})}\n\n"
            elif result_holder:
                yield f"data: {json.dumps({'type': 'done', 'data': result_holder[0].model_dump()})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
