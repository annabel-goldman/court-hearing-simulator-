"""Facial analysis module for real-time face mesh detection.

This module provides MediaPipe-based facial landmark detection
designed to feed into emotion recognition and VLM models.

Example:
    from facial_analysis import FaceMeshProcessor, ProcessorConfig

    config = ProcessorConfig(max_faces=2)
    with FaceMeshProcessor(config) as processor:
        analysis = processor.process_frame(frame)
        for face in analysis.faces:
            print(f"Face {face.face_index}: {len(face.landmarks)} landmarks")
"""

from .face_mesh import FaceMeshProcessor
from .schemas import (
    FaceMeshResult,
    FrameAnalysis,
    Landmark,
    ProcessorConfig,
)

__all__ = [
    "FaceMeshProcessor",
    "FaceMeshResult",
    "FrameAnalysis",
    "Landmark",
    "ProcessorConfig",
]
