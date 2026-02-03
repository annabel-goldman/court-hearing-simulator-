"""Pydantic schemas for facial analysis data."""

from pydantic import BaseModel, Field


class Landmark(BaseModel):
    """A single facial landmark point."""

    x: float = Field(..., description="Normalized x coordinate (0-1)")
    y: float = Field(..., description="Normalized y coordinate (0-1)")
    z: float = Field(..., description="Depth coordinate")


class FaceMeshResult(BaseModel):
    """Result from face mesh detection."""

    detected: bool = Field(..., description="Whether a face was detected")
    landmarks: list[Landmark] = Field(
        default_factory=list, description="478 facial landmarks if detected"
    )
    face_index: int = Field(default=0, description="Index of the face in multi-face detection")


class FrameAnalysis(BaseModel):
    """Complete analysis of a single frame.

    Designed to be extensible for future emotion and VLM integration.
    """

    frame_id: int = Field(..., description="Sequential frame identifier")
    timestamp_ms: float = Field(..., description="Frame timestamp in milliseconds")
    faces: list[FaceMeshResult] = Field(
        default_factory=list, description="Face mesh results for all detected faces"
    )
    # Future fields for extensibility:
    # emotion: Optional[EmotionResult] = None
    # vlm_feedback: Optional[VLMFeedback] = None


class ProcessorConfig(BaseModel):
    """Configuration for the face mesh processor."""

    max_faces: int = Field(default=1, ge=1, le=4, description="Maximum number of faces to detect")
    min_detection_confidence: float = Field(
        default=0.5, ge=0.0, le=1.0, description="Minimum detection confidence threshold"
    )
    min_tracking_confidence: float = Field(
        default=0.5, ge=0.0, le=1.0, description="Minimum tracking confidence threshold"
    )
    refine_landmarks: bool = Field(
        default=True, description="Enable iris and lip refinement for 478 landmarks"
    )
    use_gpu: bool = Field(default=True, description="Use GPU acceleration if available")
