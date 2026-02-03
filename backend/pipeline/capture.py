"""Webcam capture module for live video input."""

from __future__ import annotations

import threading
import time
from collections.abc import Generator
from dataclasses import dataclass
from typing import TYPE_CHECKING

import cv2
import numpy as np

if TYPE_CHECKING:
    from numpy.typing import NDArray


@dataclass
class CaptureConfig:
    """Configuration for webcam capture."""

    device_id: int = 0
    width: int = 640
    height: int = 480
    fps: int = 30
    buffer_size: int = 1


class WebcamCapture:
    """Captures frames from a webcam.

    Supports both synchronous iteration and threaded background capture
    for minimal latency.

    Example:
        # Simple iteration
        with WebcamCapture() as cam:
            for frame in cam:
                process(frame)

        # Or grab latest frame
        with WebcamCapture() as cam:
            cam.start_background()
            while True:
                frame = cam.get_latest_frame()
                if frame is not None:
                    process(frame)
    """

    def __init__(self, config: CaptureConfig | None = None) -> None:
        self.config = config or CaptureConfig()
        self._cap: cv2.VideoCapture | None = None
        self._running = False
        self._thread: threading.Thread | None = None
        self._latest_frame: NDArray[np.uint8] | None = None
        self._frame_lock = threading.Lock()
        self._frame_count = 0

    def open(self) -> bool:
        """Open the webcam device."""
        if self._cap is not None:
            return True

        self._cap = cv2.VideoCapture(self.config.device_id)
        if not self._cap.isOpened():
            self._cap = None
            return False

        # Configure camera
        self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.config.width)
        self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.config.height)
        self._cap.set(cv2.CAP_PROP_FPS, self.config.fps)
        self._cap.set(cv2.CAP_PROP_BUFFERSIZE, self.config.buffer_size)

        return True

    def close(self) -> None:
        """Release the webcam."""
        self.stop_background()
        if self._cap is not None:
            self._cap.release()
            self._cap = None

    def __enter__(self) -> WebcamCapture:
        if not self.open():
            raise RuntimeError(f"Failed to open webcam device {self.config.device_id}")
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()

    def read_frame(self) -> NDArray[np.uint8] | None:
        """Read a single frame from the webcam."""
        if self._cap is None:
            return None

        ret, frame = self._cap.read()
        if not ret:
            return None

        self._frame_count += 1
        return frame

    def __iter__(self) -> Generator[NDArray[np.uint8], None, None]:
        """Iterate over frames from the webcam."""
        while True:
            frame = self.read_frame()
            if frame is None:
                break
            yield frame

    def start_background(self) -> None:
        """Start background thread for continuous capture."""
        if self._running:
            return

        self._running = True
        self._thread = threading.Thread(target=self._capture_loop, daemon=True)
        self._thread.start()

    def stop_background(self) -> None:
        """Stop background capture thread."""
        self._running = False
        if self._thread is not None:
            self._thread.join(timeout=1.0)
            self._thread = None

    def _capture_loop(self) -> None:
        """Background capture loop."""
        while self._running:
            frame = self.read_frame()
            if frame is not None:
                with self._frame_lock:
                    self._latest_frame = frame
            else:
                time.sleep(0.001)

    def get_latest_frame(self) -> NDArray[np.uint8] | None:
        """Get the most recent frame (for background capture mode)."""
        with self._frame_lock:
            return self._latest_frame.copy() if self._latest_frame is not None else None

    @property
    def frame_count(self) -> int:
        """Number of frames captured."""
        return self._frame_count

    @property
    def actual_fps(self) -> float:
        """Get the actual FPS from the camera."""
        if self._cap is None:
            return 0.0
        return self._cap.get(cv2.CAP_PROP_FPS)

    @property
    def resolution(self) -> tuple[int, int]:
        """Get actual resolution (width, height)."""
        if self._cap is None:
            return (0, 0)
        return (
            int(self._cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
            int(self._cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
        )
