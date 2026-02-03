"""WebSocket client for streaming video to the facial analysis backend."""

from __future__ import annotations

import asyncio
import base64
import json
from collections.abc import AsyncGenerator, Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

import cv2
import numpy as np
import websockets
from websockets.asyncio.client import ClientConnection

if TYPE_CHECKING:
    from numpy.typing import NDArray

from facial_analysis import FrameAnalysis


@dataclass
class ClientConfig:
    """Configuration for the analysis client."""

    server_url: str = "ws://localhost:8000/ws/video"
    jpeg_quality: int = 80
    request_visualization: bool = False
    reconnect_attempts: int = 3
    reconnect_delay: float = 1.0


@dataclass
class AnalysisResult:
    """Result from a single frame analysis."""

    analysis: FrameAnalysis
    annotated_frame: NDArray[np.uint8] | None = None
    latency_ms: float = 0.0


class FaceAnalysisClient:
    """Async WebSocket client for real-time facial analysis.

    Streams frames to the backend and receives analysis results.

    Example:
        async with FaceAnalysisClient() as client:
            result = await client.analyze_frame(frame)
            print(f"Faces: {len(result.analysis.faces)}")
    """

    def __init__(self, config: ClientConfig | None = None) -> None:
        self.config = config or ClientConfig()
        self._ws: ClientConnection | None = None
        self._connected = False

    async def connect(self) -> None:
        """Connect to the analysis server."""
        if self._connected:
            return

        for attempt in range(self.config.reconnect_attempts):
            try:
                self._ws = await websockets.connect(self.config.server_url)
                self._connected = True
                return
            except Exception as e:
                if attempt < self.config.reconnect_attempts - 1:
                    await asyncio.sleep(self.config.reconnect_delay)
                else:
                    raise ConnectionError(f"Failed to connect after {self.config.reconnect_attempts} attempts: {e}")

    async def disconnect(self) -> None:
        """Disconnect from the server."""
        if self._ws is not None:
            await self._ws.close()
            self._ws = None
        self._connected = False

    async def __aenter__(self) -> FaceAnalysisClient:
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        await self.disconnect()

    def _encode_frame(self, frame: NDArray[np.uint8]) -> str:
        """Encode frame to base64 JPEG."""
        encode_params = [cv2.IMWRITE_JPEG_QUALITY, self.config.jpeg_quality]
        _, buffer = cv2.imencode(".jpg", frame, encode_params)
        return base64.b64encode(buffer).decode("utf-8")

    async def analyze_frame(
        self, frame: NDArray[np.uint8], request_visualization: bool | None = None
    ) -> AnalysisResult:
        """Send a frame for analysis and return the result.

        Args:
            frame: BGR image from OpenCV.
            request_visualization: Override config to request annotated frame.

        Returns:
            AnalysisResult with face landmarks and optional visualization.
        """
        if not self._connected or self._ws is None:
            raise RuntimeError("Not connected. Call connect() first.")

        import time
        start = time.perf_counter()

        visualize = request_visualization if request_visualization is not None else self.config.request_visualization
        frame_b64 = self._encode_frame(frame)

        if visualize:
            message = json.dumps({"frame": frame_b64, "visualize": True})
            await self._ws.send(message)
        else:
            await self._ws.send(frame_b64)

        response = await self._ws.recv()
        latency_ms = (time.perf_counter() - start) * 1000

        data = json.loads(response)

        # Parse response
        if "analysis" in data:
            analysis = FrameAnalysis(**data["analysis"])
            annotated = None
            if "annotated_frame" in data:
                img_data = base64.b64decode(data["annotated_frame"])
                nparr = np.frombuffer(img_data, np.uint8)
                annotated = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        else:
            analysis = FrameAnalysis(**data)
            annotated = None

        return AnalysisResult(
            analysis=analysis,
            annotated_frame=annotated,
            latency_ms=latency_ms,
        )

    async def stream_frames(
        self,
        frame_generator: AsyncGenerator[NDArray[np.uint8], None],
        callback: Callable[[AnalysisResult], Any] | None = None,
    ) -> AsyncGenerator[AnalysisResult, None]:
        """Stream frames continuously and yield results.

        Args:
            frame_generator: Async generator yielding frames.
            callback: Optional callback for each result.

        Yields:
            AnalysisResult for each processed frame.
        """
        async for frame in frame_generator:
            result = await self.analyze_frame(frame)
            if callback:
                callback(result)
            yield result


@dataclass
class PipelineStats:
    """Statistics for the live pipeline."""

    frames_processed: int = 0
    total_latency_ms: float = 0.0
    faces_detected: int = 0
    start_time: float = field(default_factory=lambda: __import__("time").time())

    @property
    def avg_latency_ms(self) -> float:
        return self.total_latency_ms / max(1, self.frames_processed)

    @property
    def fps(self) -> float:
        import time
        elapsed = time.time() - self.start_time
        return self.frames_processed / max(0.001, elapsed)

    def update(self, result: AnalysisResult) -> None:
        self.frames_processed += 1
        self.total_latency_ms += result.latency_ms
        self.faces_detected += len(result.analysis.faces)
