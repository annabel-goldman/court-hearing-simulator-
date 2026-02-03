"""MediaPipe Tasks-based processor for full body tracking."""

from __future__ import annotations

import math
import time
import urllib.request
from pathlib import Path
from typing import TYPE_CHECKING

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
from mediapipe.tasks.python.vision.face_landmarker import FaceLandmarksConnections

from .schemas import (
    Blendshape,
    FaceResult,
    FrameAnalysis,
    HandResult,
    HolisticResult,
    Landmark,
    PoseResult,
    ProcessorConfig,
)

if TYPE_CHECKING:
    from numpy.typing import NDArray


# Model URLs and paths
MODEL_DIR = Path(__file__).parent / "models"
MODELS = {
    "face": {
        "url": "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        "path": MODEL_DIR / "face_landmarker.task",
    },
    "pose": {
        "url": "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
        "path": MODEL_DIR / "pose_landmarker_lite.task",
    },
    "hand": {
        "url": "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        "path": MODEL_DIR / "hand_landmarker.task",
    },
}


def _ensure_model(name: str) -> Path:
    """Download model if not present."""
    model_info = MODELS[name]
    if model_info["path"].exists():
        return model_info["path"]

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {name} model to {model_info['path']}...")
    urllib.request.urlretrieve(model_info["url"], model_info["path"])
    print(f"{name} model downloaded successfully.")
    return model_info["path"]


def _landmark_distance(lm1: Landmark, lm2: Landmark) -> float:
    """Calculate 2D distance between two landmarks."""
    return math.sqrt((lm1.x - lm2.x) ** 2 + (lm1.y - lm2.y) ** 2)


class HolisticProcessor:
    """Processes video frames using MediaPipe Tasks for body tracking.

    Uses separate landmarkers for face, pose, and hands combined into
    a holistic result.

    Example:
        processor = HolisticProcessor()
        processor.start()
        result = processor.process_frame(frame)
        processor.stop()

    Or using context manager:
        with HolisticProcessor() as processor:
            result = processor.process_frame(frame)
    """

    # Pose landmark connections for drawing
    POSE_CONNECTIONS = [
        (0, 1), (1, 2), (2, 3), (3, 7),  # Left eye
        (0, 4), (4, 5), (5, 6), (6, 8),  # Right eye
        (9, 10),  # Mouth
        (11, 12),  # Shoulders
        (11, 13), (13, 15),  # Left arm
        (12, 14), (14, 16),  # Right arm
        (11, 23), (12, 24),  # Torso
        (23, 24),  # Hips
        (23, 25), (25, 27), (27, 29), (29, 31),  # Left leg
        (24, 26), (26, 28), (28, 30), (30, 32),  # Right leg
    ]

    HAND_CONNECTIONS = [
        (0, 1), (1, 2), (2, 3), (3, 4),  # Thumb
        (0, 5), (5, 6), (6, 7), (7, 8),  # Index
        (0, 9), (9, 10), (10, 11), (11, 12),  # Middle
        (0, 13), (13, 14), (14, 15), (15, 16),  # Ring
        (0, 17), (17, 18), (18, 19), (19, 20),  # Pinky
        (5, 9), (9, 13), (13, 17),  # Palm
    ]

    def __init__(self, config: ProcessorConfig | None = None) -> None:
        """Initialize the holistic processor."""
        self.config = config or ProcessorConfig()
        self._face_landmarker: vision.FaceLandmarker | None = None
        self._pose_landmarker: vision.PoseLandmarker | None = None
        self._hand_landmarker: vision.HandLandmarker | None = None
        self._frame_counter = 0
        self._start_time: float | None = None

    def start(self) -> None:
        """Initialize MediaPipe resources."""
        if self._face_landmarker is not None:
            return

        # Initialize Face Landmarker
        face_model = _ensure_model("face")
        face_options = vision.FaceLandmarkerOptions(
            base_options=python.BaseOptions(model_asset_path=str(face_model)),
            running_mode=vision.RunningMode.IMAGE,
            num_faces=1,
            min_face_detection_confidence=self.config.min_detection_confidence,
            min_tracking_confidence=self.config.min_tracking_confidence,
            output_face_blendshapes=True,
            output_facial_transformation_matrixes=False,
        )
        self._face_landmarker = vision.FaceLandmarker.create_from_options(face_options)

        # Initialize Pose Landmarker
        pose_model = _ensure_model("pose")
        pose_options = vision.PoseLandmarkerOptions(
            base_options=python.BaseOptions(model_asset_path=str(pose_model)),
            running_mode=vision.RunningMode.IMAGE,
            num_poses=1,
            min_pose_detection_confidence=self.config.min_detection_confidence,
            min_tracking_confidence=self.config.min_tracking_confidence,
        )
        self._pose_landmarker = vision.PoseLandmarker.create_from_options(pose_options)

        # Initialize Hand Landmarker
        hand_model = _ensure_model("hand")
        hand_options = vision.HandLandmarkerOptions(
            base_options=python.BaseOptions(model_asset_path=str(hand_model)),
            running_mode=vision.RunningMode.IMAGE,
            num_hands=2,
            min_hand_detection_confidence=self.config.min_detection_confidence,
            min_tracking_confidence=self.config.min_tracking_confidence,
        )
        self._hand_landmarker = vision.HandLandmarker.create_from_options(hand_options)

        print("Holistic processor initialized (Face + Pose + Hands)")
        self._start_time = time.perf_counter()
        self._frame_counter = 0

    def stop(self) -> None:
        """Release MediaPipe resources."""
        if self._face_landmarker is not None:
            self._face_landmarker.close()
            self._face_landmarker = None
        if self._pose_landmarker is not None:
            self._pose_landmarker.close()
            self._pose_landmarker = None
        if self._hand_landmarker is not None:
            self._hand_landmarker.close()
            self._hand_landmarker = None
        self._start_time = None

    def __enter__(self) -> HolisticProcessor:
        """Context manager entry."""
        self.start()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        """Context manager exit."""
        self.stop()

    def _extract_face_result(self, results) -> FaceResult:
        """Extract face landmarks and blendshapes from results."""
        if not results.face_landmarks:
            return FaceResult(detected=False)

        landmarks = [
            Landmark(x=lm.x, y=lm.y, z=lm.z, visibility=1.0)
            for lm in results.face_landmarks[0]
        ]

        blendshapes = []
        if results.face_blendshapes:
            for bs in results.face_blendshapes[0]:
                blendshapes.append(Blendshape(name=bs.category_name, score=bs.score))

        return FaceResult(detected=True, landmarks=landmarks, blendshapes=blendshapes)

    def _extract_pose_result(self, results) -> PoseResult:
        """Extract pose landmarks from results."""
        if not results.pose_landmarks:
            return PoseResult(detected=False)

        landmarks = [
            Landmark(
                x=lm.x,
                y=lm.y,
                z=lm.z,
                visibility=getattr(lm, "visibility", 1.0),
            )
            for lm in results.pose_landmarks[0]
        ]

        return PoseResult(detected=True, landmarks=landmarks)

    def _extract_hand_results(self, results) -> tuple[HandResult, HandResult]:
        """Extract hand landmarks from results."""
        left_hand = HandResult(detected=False, handedness="Left")
        right_hand = HandResult(detected=False, handedness="Right")

        if not results.hand_landmarks:
            return left_hand, right_hand

        for i, hand_landmarks in enumerate(results.hand_landmarks):
            landmarks = [
                Landmark(x=lm.x, y=lm.y, z=lm.z, visibility=1.0)
                for lm in hand_landmarks
            ]

            # Determine handedness
            handedness = "Left"
            if results.handedness and i < len(results.handedness):
                handedness = results.handedness[i][0].category_name

            hand_result = HandResult(detected=True, landmarks=landmarks, handedness=handedness)

            if handedness == "Left":
                left_hand = hand_result
            else:
                right_hand = hand_result

        return left_hand, right_hand

    def process_frame(self, frame: NDArray[np.uint8]) -> FrameAnalysis:
        """Process a single video frame for holistic landmarks."""
        if self._face_landmarker is None:
            raise RuntimeError("Processor not started. Call start() first.")

        timestamp_ms = (
            (time.perf_counter() - self._start_time) * 1000 if self._start_time else 0.0
        )

        # Convert BGR to RGB for MediaPipe
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)

        # Run all detectors
        face_results = self._face_landmarker.detect(mp_image)
        pose_results = self._pose_landmarker.detect(mp_image)
        hand_results = self._hand_landmarker.detect(mp_image)

        # Extract results
        face = self._extract_face_result(face_results)
        pose = self._extract_pose_result(pose_results)
        left_hand, right_hand = self._extract_hand_results(hand_results)

        holistic_result = HolisticResult(
            face=face,
            pose=pose,
            left_hand=left_hand,
            right_hand=right_hand,
        )

        frame_id = self._frame_counter
        self._frame_counter += 1

        return FrameAnalysis(
            frame_id=frame_id,
            timestamp_ms=timestamp_ms,
            holistic=holistic_result,
        )

    def _draw_landmarks(
        self,
        image: NDArray[np.uint8],
        landmarks: list[Landmark],
        connections: list[tuple[int, int]],
        point_color: tuple[int, int, int],
        line_color: tuple[int, int, int],
        point_radius: int = 2,
        line_thickness: int = 1,
    ) -> None:
        """Draw landmarks and connections on image."""
        h, w = image.shape[:2]

        # Draw connections
        for start_idx, end_idx in connections:
            if start_idx < len(landmarks) and end_idx < len(landmarks):
                start = landmarks[start_idx]
                end = landmarks[end_idx]
                pt1 = (int(start.x * w), int(start.y * h))
                pt2 = (int(end.x * w), int(end.y * h))
                cv2.line(image, pt1, pt2, line_color, line_thickness, cv2.LINE_AA)

        # Draw points
        for lm in landmarks:
            pt = (int(lm.x * w), int(lm.y * h))
            cv2.circle(image, pt, point_radius, point_color, -1, cv2.LINE_AA)

    def _draw_face_mesh(self, image: NDArray[np.uint8], landmarks: list[Landmark]) -> None:
        """Draw full face mesh tesselation using MediaPipe's built-in connections."""
        h, w = image.shape[:2]

        # Draw tesselation (the mesh triangles covering the face)
        for connection in FaceLandmarksConnections.FACE_LANDMARKS_TESSELATION:
            start_idx = connection.start
            end_idx = connection.end
            if start_idx < len(landmarks) and end_idx < len(landmarks):
                start = landmarks[start_idx]
                end = landmarks[end_idx]
                pt1 = (int(start.x * w), int(start.y * h))
                pt2 = (int(end.x * w), int(end.y * h))
                cv2.line(image, pt1, pt2, (80, 110, 10), 1, cv2.LINE_AA)

        # Draw contours (eyes, lips, face oval) on top in brighter color
        for connection in FaceLandmarksConnections.FACE_LANDMARKS_CONTOURS:
            start_idx = connection.start
            end_idx = connection.end
            if start_idx < len(landmarks) and end_idx < len(landmarks):
                start = landmarks[start_idx]
                end = landmarks[end_idx]
                pt1 = (int(start.x * w), int(start.y * h))
                pt2 = (int(end.x * w), int(end.y * h))
                cv2.line(image, pt1, pt2, (80, 255, 121), 1, cv2.LINE_AA)

    def process_frame_with_visualization(
        self,
        frame: NDArray[np.uint8],
        draw_face: bool = True,
        draw_pose: bool = True,
        draw_hands: bool = True,
    ) -> tuple[FrameAnalysis, NDArray[np.uint8]]:
        """Process frame and return visualization overlay."""
        analysis = self.process_frame(frame)
        annotated = frame.copy()
        holistic = analysis.holistic

        # Draw face mesh
        if draw_face and holistic.face.detected:
            self._draw_face_mesh(annotated, holistic.face.landmarks)

        # Draw pose
        if draw_pose and holistic.pose.detected:
            self._draw_landmarks(
                annotated,
                holistic.pose.landmarks,
                self.POSE_CONNECTIONS,
                point_color=(0, 255, 0),
                line_color=(0, 200, 0),
                point_radius=4,
                line_thickness=2,
            )

        # Draw hands
        if draw_hands:
            if holistic.left_hand.detected:
                self._draw_landmarks(
                    annotated,
                    holistic.left_hand.landmarks,
                    self.HAND_CONNECTIONS,
                    point_color=(255, 0, 0),
                    line_color=(200, 0, 0),
                    point_radius=3,
                    line_thickness=2,
                )
            if holistic.right_hand.detected:
                self._draw_landmarks(
                    annotated,
                    holistic.right_hand.landmarks,
                    self.HAND_CONNECTIONS,
                    point_color=(0, 0, 255),
                    line_color=(0, 0, 200),
                    point_radius=3,
                    line_thickness=2,
                )

        return analysis, annotated


class PokerDashboard:
    """Analyzes holistic tracking to detect poker tells and stress indicators.

    Uses face blendshapes and body language (pose/hands) to identify:
    - Stress indicators (lip pressing, jaw clenching, shoulder tension)
    - Nervousness (fidgeting, hand movements, eye activity)
    - Potential deception cues (asymmetric expressions, self-touching)
    """

    # Thresholds for detection
    STRESS_THRESHOLD = 0.5
    NERVOUSNESS_THRESHOLD = 0.4
    SMILE_THRESHOLD = 0.3
    BROW_THRESHOLD = 0.4

    # Pose landmark indices
    POSE_LEFT_SHOULDER = 11
    POSE_RIGHT_SHOULDER = 12
    POSE_LEFT_WRIST = 15
    POSE_RIGHT_WRIST = 16
    POSE_NOSE = 0

    def __init__(self) -> None:
        """Initialize the poker dashboard."""
        self.tells: dict[str, bool] = {}
        self.confidence_scores: dict[str, float] = {}
        self._prev_hand_positions: dict[str, tuple[float, float]] | None = None

    def analyze(self, holistic: HolisticResult) -> dict:
        """Analyze holistic result and return detected tells."""
        self.tells = {}
        self.confidence_scores = {}

        # Analyze face blendshapes
        if holistic.face.detected and holistic.face.blendshapes:
            self._analyze_face(holistic.face.blendshapes)

        # Analyze body language
        if holistic.pose.detected:
            self._analyze_pose(holistic.pose.landmarks)

        # Analyze hand activity
        self._analyze_hands(holistic)

        # Calculate overall stress
        stress_indicators = list(self.confidence_scores.values())
        overall_stress = sum(stress_indicators) / max(len(stress_indicators), 1)

        return {
            "tells": self.tells,
            "confidence_scores": self.confidence_scores,
            "overall_stress": overall_stress,
            "tell_count": len(self.tells),
            "face_detected": holistic.face.detected,
            "pose_detected": holistic.pose.detected,
            "hands_detected": holistic.left_hand.detected or holistic.right_hand.detected,
        }

    def _analyze_face(self, blendshapes: list[Blendshape]) -> None:
        """Analyze face blendshapes for tells."""
        bs_dict = {bs.name: bs.score for bs in blendshapes}

        # Stress - mouth pressing
        mouth_press = max(
            bs_dict.get("mouthPressLeft", 0), bs_dict.get("mouthPressRight", 0)
        )
        if mouth_press > self.STRESS_THRESHOLD:
            self.tells["stress_mouth_press"] = True
            self.confidence_scores["stress_mouth_press"] = mouth_press

        # Nervousness - eye squinting
        eye_squint = max(
            bs_dict.get("eyeSquintLeft", 0), bs_dict.get("eyeSquintRight", 0)
        )
        if eye_squint > self.NERVOUSNESS_THRESHOLD:
            self.tells["nervous_eye_squint"] = True
            self.confidence_scores["nervous_eye_squint"] = eye_squint

        # Nervousness - furrowed brow
        brow_down = max(
            bs_dict.get("browDownLeft", 0), bs_dict.get("browDownRight", 0)
        )
        if brow_down > self.BROW_THRESHOLD:
            self.tells["nervous_furrowed_brow"] = True
            self.confidence_scores["nervous_furrowed_brow"] = brow_down

        # Surprise - raised brows
        brow_up = max(
            bs_dict.get("browInnerUp", 0),
            bs_dict.get("browOuterUpLeft", 0),
            bs_dict.get("browOuterUpRight", 0),
        )
        if brow_up > self.BROW_THRESHOLD:
            self.tells["surprise_raised_brows"] = True
            self.confidence_scores["surprise_raised_brows"] = brow_up

        # Fake smile - asymmetric
        smile_left = bs_dict.get("mouthSmileLeft", 0)
        smile_right = bs_dict.get("mouthSmileRight", 0)
        smile_asymmetry = abs(smile_left - smile_right)
        if smile_asymmetry > 0.15 and max(smile_left, smile_right) > self.SMILE_THRESHOLD:
            self.tells["asymmetric_smile"] = True
            self.confidence_scores["asymmetric_smile"] = smile_asymmetry

        # Wide eyes (fear/surprise)
        eye_wide = max(bs_dict.get("eyeWideLeft", 0), bs_dict.get("eyeWideRight", 0))
        if eye_wide > self.NERVOUSNESS_THRESHOLD:
            self.tells["wide_eyes"] = True
            self.confidence_scores["wide_eyes"] = eye_wide

        # Excessive blinking
        blink = max(bs_dict.get("eyeBlinkLeft", 0), bs_dict.get("eyeBlinkRight", 0))
        if blink > 0.7:
            self.tells["heavy_blink"] = True
            self.confidence_scores["heavy_blink"] = blink

        # Jaw open (surprise/stress)
        jaw_open = bs_dict.get("jawOpen", 0)
        if jaw_open > 0.5:
            self.tells["jaw_open"] = True
            self.confidence_scores["jaw_open"] = jaw_open

    def _analyze_pose(self, landmarks: list[Landmark]) -> None:
        """Analyze pose for body language tells."""
        if len(landmarks) < 17:
            return

        left_shoulder = landmarks[self.POSE_LEFT_SHOULDER]
        right_shoulder = landmarks[self.POSE_RIGHT_SHOULDER]
        nose = landmarks[self.POSE_NOSE]

        # Shoulder tension (raised shoulders)
        shoulder_avg_y = (left_shoulder.y + right_shoulder.y) / 2
        nose_y = nose.y
        shoulder_raise = max(0, (nose_y - shoulder_avg_y) * 3 - 0.2)
        if shoulder_raise > 0.3:
            self.tells["shoulder_tension"] = True
            self.confidence_scores["shoulder_tension"] = min(1.0, shoulder_raise)

        # Asymmetric posture (leaning)
        shoulder_diff = abs(left_shoulder.y - right_shoulder.y)
        if shoulder_diff > 0.05:
            self.tells["asymmetric_posture"] = True
            self.confidence_scores["asymmetric_posture"] = min(1.0, shoulder_diff * 10)

        # Check if hands near face (self-soothing)
        left_wrist = landmarks[self.POSE_LEFT_WRIST]
        right_wrist = landmarks[self.POSE_RIGHT_WRIST]

        left_to_face = math.sqrt((left_wrist.x - nose.x) ** 2 + (left_wrist.y - nose.y) ** 2)
        right_to_face = math.sqrt((right_wrist.x - nose.x) ** 2 + (right_wrist.y - nose.y) ** 2)

        if left_to_face < 0.15 or right_to_face < 0.15:
            self.tells["hand_to_face"] = True
            self.confidence_scores["hand_to_face"] = max(
                0, 1.0 - min(left_to_face, right_to_face) * 5
            )

    def _analyze_hands(self, holistic: HolisticResult) -> None:
        """Analyze hand movements for fidgeting."""
        current_positions = {}

        if holistic.left_hand.detected and holistic.left_hand.landmarks:
            wrist = holistic.left_hand.landmarks[0]
            current_positions["left"] = (wrist.x, wrist.y)

        if holistic.right_hand.detected and holistic.right_hand.landmarks:
            wrist = holistic.right_hand.landmarks[0]
            current_positions["right"] = (wrist.x, wrist.y)

        # Detect fidgeting (rapid hand movement)
        if self._prev_hand_positions:
            total_movement = 0
            count = 0
            for hand in ["left", "right"]:
                if hand in current_positions and hand in self._prev_hand_positions:
                    prev = self._prev_hand_positions[hand]
                    curr = current_positions[hand]
                    movement = math.sqrt((curr[0] - prev[0]) ** 2 + (curr[1] - prev[1]) ** 2)
                    total_movement += movement
                    count += 1

            if count > 0:
                avg_movement = total_movement / count
                if avg_movement > 0.02:
                    self.tells["hand_fidgeting"] = True
                    self.confidence_scores["hand_fidgeting"] = min(1.0, avg_movement * 20)

        self._prev_hand_positions = current_positions

    def get_status_text(self, analysis: dict) -> list[str]:
        """Generate human-readable status lines for display."""
        lines = []

        # Overall stress indicator
        stress = analysis["overall_stress"]
        if stress > 0.5:
            lines.append(f"STRESS: HIGH ({stress:.0%})")
        elif stress > 0.25:
            lines.append(f"STRESS: MODERATE ({stress:.0%})")
        else:
            lines.append(f"STRESS: LOW ({stress:.0%})")

        # Tracking status
        tracking = []
        if analysis["face_detected"]:
            tracking.append("Face")
        if analysis["pose_detected"]:
            tracking.append("Pose")
        if analysis["hands_detected"]:
            tracking.append("Hands")
        lines.append(f"Tracking: {', '.join(tracking) if tracking else 'None'}")

        # Individual tells
        for tell, active in analysis["tells"].items():
            if active:
                score = analysis["confidence_scores"].get(tell, 0)
                tell_name = tell.replace("_", " ").title()
                lines.append(f"  > {tell_name}: {score:.0%}")

        if not analysis["tells"]:
            lines.append("  No tells detected")

        return lines


# Backwards compatibility alias
FaceMeshProcessor = HolisticProcessor
