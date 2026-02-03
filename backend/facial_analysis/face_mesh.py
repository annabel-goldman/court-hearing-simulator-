"""MediaPipe Face Landmarker processor for facial landmark detection."""

from __future__ import annotations

import time
import urllib.request
from pathlib import Path
from typing import TYPE_CHECKING

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

from .schemas import FaceMeshResult, FrameAnalysis, Landmark, ProcessorConfig

if TYPE_CHECKING:
    from numpy.typing import NDArray

# Model download URL and local path
MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
MODEL_DIR = Path(__file__).parent / "models"
MODEL_PATH = MODEL_DIR / "face_landmarker.task"


def _ensure_model() -> Path:
    """Download the face landmarker model if not present."""
    if MODEL_PATH.exists():
        return MODEL_PATH

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Downloading face landmarker model to {MODEL_PATH}...")
    urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    print("Model downloaded successfully.")
    return MODEL_PATH


def _draw_connections(
    image: NDArray[np.uint8],
    landmarks: list[Landmark],
    connections: frozenset,
    color: tuple[int, int, int],
    thickness: int = 1,
) -> None:
    """Draw landmark connections on image."""
    h, w = image.shape[:2]
    for connection in connections:
        start_idx, end_idx = connection.start, connection.end
        if start_idx < len(landmarks) and end_idx < len(landmarks):
            start = landmarks[start_idx]
            end = landmarks[end_idx]
            pt1 = (int(start.x * w), int(start.y * h))
            pt2 = (int(end.x * w), int(end.y * h))
            cv2.line(image, pt1, pt2, color, thickness, cv2.LINE_AA)


class FaceMeshProcessor:
    """Processes video frames to extract facial mesh landmarks.

    Uses MediaPipe Face Landmarker for real-time facial landmark detection.
    Designed as a pipeline component that can feed into emotion recognition
    and VLM models.

    Example:
        processor = FaceMeshProcessor()
        processor.start()
        result = processor.process_frame(frame)
        processor.stop()

    Or using context manager:
        with FaceMeshProcessor() as processor:
            result = processor.process_frame(frame)
    """

    def __init__(self, config: ProcessorConfig | None = None) -> None:
        """Initialize the face mesh processor.

        Args:
            config: Processor configuration. Uses defaults if not provided.
        """
        self.config = config or ProcessorConfig()
        self._landmarker: vision.FaceLandmarker | None = None
        self._frame_counter = 0
        self._start_time: float | None = None

    def start(self) -> None:
        """Initialize MediaPipe resources."""
        if self._landmarker is not None:
            return

        model_path = _ensure_model()

        # Try GPU first if requested, fall back to CPU
        delegates_to_try = []
        if self.config.use_gpu:
            delegates_to_try.append(("GPU", python.BaseOptions.Delegate.GPU))
        delegates_to_try.append(("CPU", None))

        for name, delegate in delegates_to_try:
            try:
                base_options = python.BaseOptions(
                    model_asset_path=str(model_path),
                    delegate=delegate,
                )
                options = vision.FaceLandmarkerOptions(
                    base_options=base_options,
                    running_mode=vision.RunningMode.IMAGE,
                    num_faces=self.config.max_faces,
                    min_face_detection_confidence=self.config.min_detection_confidence,
                    min_tracking_confidence=self.config.min_tracking_confidence,
                    output_face_blendshapes=False,
                    output_facial_transformation_matrixes=False,
                )
                self._landmarker = vision.FaceLandmarker.create_from_options(options)
                print(f"FaceLandmarker initialized with {name}")
                break
            except Exception as e:
                if name == "GPU":
                    print(f"GPU not available ({e}), falling back to CPU")
                else:
                    raise

        self._start_time = time.perf_counter()
        self._frame_counter = 0

    def stop(self) -> None:
        """Release MediaPipe resources."""
        if self._landmarker is not None:
            self._landmarker.close()
            self._landmarker = None
        self._start_time = None

    def __enter__(self) -> FaceMeshProcessor:
        """Context manager entry."""
        self.start()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        """Context manager exit."""
        self.stop()

    def process_frame(self, frame: NDArray[np.uint8]) -> FrameAnalysis:
        """Process a single video frame for facial landmarks.

        Args:
            frame: BGR image array from OpenCV.

        Returns:
            FrameAnalysis containing detected faces and landmarks.

        Raises:
            RuntimeError: If processor not started.
        """
        if self._landmarker is None:
            raise RuntimeError("Processor not started. Call start() first or use context manager.")

        # Calculate timestamp
        timestamp_ms = (
            (time.perf_counter() - self._start_time) * 1000 if self._start_time else 0.0
        )

        # Convert BGR to RGB for MediaPipe
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        # Create MediaPipe Image
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)

        # Process frame
        results = self._landmarker.detect(mp_image)

        # Build response
        faces: list[FaceMeshResult] = []

        if results.face_landmarks:
            for face_idx, face_landmarks in enumerate(results.face_landmarks):
                landmarks = [
                    Landmark(x=lm.x, y=lm.y, z=lm.z) for lm in face_landmarks
                ]
                faces.append(
                    FaceMeshResult(detected=True, landmarks=landmarks, face_index=face_idx)
                )

        frame_id = self._frame_counter
        self._frame_counter += 1

        return FrameAnalysis(
            frame_id=frame_id,
            timestamp_ms=timestamp_ms,
            faces=faces,
        )

    def process_frame_with_visualization(
        self, frame: NDArray[np.uint8], draw_tesselation: bool = True, draw_contours: bool = True
    ) -> tuple[FrameAnalysis, NDArray[np.uint8]]:
        """Process frame and return visualization overlay.

        Args:
            frame: BGR image array from OpenCV.
            draw_tesselation: Draw face mesh tesselation.
            draw_contours: Draw face contours (eyes, lips, face oval).

        Returns:
            Tuple of (FrameAnalysis, annotated frame).
        """
        analysis = self.process_frame(frame)
        annotated = frame.copy()

        if analysis.faces:
            connections = vision.FaceLandmarksConnections

            for face_result in analysis.faces:
                if draw_tesselation:
                    _draw_connections(
                        annotated,
                        face_result.landmarks,
                        connections.FACE_LANDMARKS_TESSELATION,
                        color=(80, 110, 10),
                        thickness=1,
                    )

                if draw_contours:
                    _draw_connections(
                        annotated,
                        face_result.landmarks,
                        connections.FACE_LANDMARKS_CONTOURS,
                        color=(80, 255, 121),
                        thickness=1,
                    )

        return analysis, annotated

    def get_key_landmarks(self, face_result: FaceMeshResult) -> dict[str, Landmark]:
        """Extract key facial landmarks for emotion analysis.

        Returns landmarks useful for emotion recognition models:
        - Eyes, eyebrows, nose, mouth corners, etc.

        Args:
            face_result: Face mesh result with all landmarks.

        Returns:
            Dictionary mapping landmark names to their coordinates.
        """
        if not face_result.landmarks:
            return {}

        # Key MediaPipe Face Landmarker indices (478 landmarks)
        key_indices = {
            "nose_tip": 1,
            "left_eye_inner": 133,
            "left_eye_outer": 33,
            "right_eye_inner": 362,
            "right_eye_outer": 263,
            "left_eyebrow_inner": 107,
            "left_eyebrow_outer": 70,
            "right_eyebrow_inner": 336,
            "right_eyebrow_outer": 300,
            "mouth_left": 61,
            "mouth_right": 291,
            "mouth_top": 13,
            "mouth_bottom": 14,
            "chin": 152,
            "forehead": 10,
        }

        return {
            name: face_result.landmarks[idx]
            for name, idx in key_indices.items()
            if idx < len(face_result.landmarks)
        }
