"""Facial analysis module for real-time holistic body tracking.

This module provides MediaPipe-based holistic tracking including
face (468 landmarks), pose (33 landmarks), and hands (21 landmarks each).

Example:
    from facial_analysis import HolisticProcessor, ProcessorConfig

    config = ProcessorConfig(model_complexity=1)
    with HolisticProcessor(config) as processor:
        analysis = processor.process_frame(frame)
        if analysis.holistic.face.detected:
            print(f"Face: {len(analysis.holistic.face.landmarks)} landmarks")
        if analysis.holistic.pose.detected:
            print(f"Pose: {len(analysis.holistic.pose.landmarks)} landmarks")
"""

from .face_mesh import FaceMeshProcessor, HolisticProcessor, PokerDashboard
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

__all__ = [
    "Blendshape",
    "FaceMeshProcessor",
    "FaceResult",
    "FrameAnalysis",
    "HandResult",
    "HolisticProcessor",
    "HolisticResult",
    "Landmark",
    "PokerDashboard",
    "PoseResult",
    "ProcessorConfig",
]
