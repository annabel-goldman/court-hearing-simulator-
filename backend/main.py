"""Court Hearing Simulator Backend - Facial Analysis API."""

import base64
from contextlib import asynccontextmanager
from typing import Annotated

import cv2
import numpy as np
from fastapi import Depends, FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from facial_analysis import FaceMeshProcessor, FrameAnalysis, ProcessorConfig

# Global processor instance (managed by lifespan)
_processor: FaceMeshProcessor | None = None


def get_processor() -> FaceMeshProcessor:
    """Dependency to get the face mesh processor."""
    if _processor is None:
        raise RuntimeError("Processor not initialized")
    return _processor


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle."""
    global _processor
    _processor = FaceMeshProcessor(ProcessorConfig(max_faces=1, refine_landmarks=True))
    _processor.start()
    yield
    _processor.stop()
    _processor = None


app = FastAPI(
    title="Court Hearing Simulator - Facial Analysis",
    description="Real-time facial mesh detection for emotion analysis and VLM feedback",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root() -> dict:
    """Root endpoint with API info."""
    return {
        "name": "Court Hearing Simulator - Facial Analysis API",
        "version": "0.1.0",
        "endpoints": {
            "health": "/health",
            "config": "/config",
            "analyze": "/analyze (POST)",
            "websocket": "/ws/video",
            "docs": "/docs",
        },
    }


@app.get("/health")
async def health_check() -> dict:
    """Health check endpoint."""
    return {"status": "healthy", "processor_active": _processor is not None}


@app.get("/config")
async def get_config(
    processor: Annotated[FaceMeshProcessor, Depends(get_processor)],
) -> ProcessorConfig:
    """Get current processor configuration."""
    return processor.config


@app.post("/analyze")
async def analyze_frame(
    image_base64: str,
    processor: Annotated[FaceMeshProcessor, Depends(get_processor)],
) -> FrameAnalysis:
    """Analyze a single frame from base64-encoded image.

    Args:
        image_base64: Base64-encoded JPEG/PNG image.

    Returns:
        FrameAnalysis with detected faces and landmarks.
    """
    # Decode base64 image
    image_data = base64.b64decode(image_base64)
    nparr = np.frombuffer(image_data, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if frame is None:
        return FrameAnalysis(frame_id=-1, timestamp_ms=0, faces=[])

    return processor.process_frame(frame)


@app.websocket("/ws/video")
async def video_websocket(
    websocket: WebSocket,
    processor: Annotated[FaceMeshProcessor, Depends(get_processor)],
):
    """WebSocket endpoint for real-time video analysis.

    Protocol:
    - Client sends base64-encoded frames as text messages
    - Server responds with JSON FrameAnalysis for each frame

    For visualization, client can request annotated frames by sending:
    {"frame": "<base64>", "visualize": true}
    Server will respond with:
    {"analysis": <FrameAnalysis>, "annotated_frame": "<base64>"}
    """
    await websocket.accept()

    try:
        while True:
            data = await websocket.receive_text()

            # Handle simple base64 frame
            if not data.startswith("{"):
                image_data = base64.b64decode(data)
                nparr = np.frombuffer(image_data, np.uint8)
                frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

                if frame is not None:
                    analysis = processor.process_frame(frame)
                    await websocket.send_json(analysis.model_dump())
                continue

            # Handle JSON message with options
            import json

            message = json.loads(data)
            frame_data = message.get("frame", "")
            visualize = message.get("visualize", False)

            image_data = base64.b64decode(frame_data)
            nparr = np.frombuffer(image_data, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

            if frame is None:
                continue

            if visualize:
                analysis, annotated = processor.process_frame_with_visualization(frame)
                _, buffer = cv2.imencode(".jpg", annotated)
                annotated_b64 = base64.b64encode(buffer).decode("utf-8")
                await websocket.send_json(
                    {"analysis": analysis.model_dump(), "annotated_frame": annotated_b64}
                )
            else:
                analysis = processor.process_frame(frame)
                await websocket.send_json(analysis.model_dump())

    except WebSocketDisconnect:
        pass


def main():
    """Run the server."""
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)


if __name__ == "__main__":
    main()
