"""Pydantic schemas for holistic body tracking data."""

from pydantic import BaseModel, Field


class Landmark(BaseModel):
    """A single landmark point."""

    x: float = Field(..., description="Normalized x coordinate (0-1)")
    y: float = Field(..., description="Normalized y coordinate (0-1)")
    z: float = Field(..., description="Depth coordinate")
    visibility: float = Field(default=1.0, description="Visibility score (0-1)")


class Blendshape(BaseModel):
    """A single face blendshape value (calculated geometrically)."""

    name: str = Field(..., description="Blendshape name (e.g., 'mouthOpen')")
    score: float = Field(..., ge=0.0, le=1.0, description="Blendshape score (0-1)")


class FaceResult(BaseModel):
    """Result from face landmark detection."""

    detected: bool = Field(..., description="Whether a face was detected")
    landmarks: list[Landmark] = Field(
        default_factory=list, description="468 facial landmarks if detected"
    )
    blendshapes: list[Blendshape] = Field(
        default_factory=list, description="Calculated blendshapes from geometry"
    )


class PoseResult(BaseModel):
    """Result from pose landmark detection."""

    detected: bool = Field(..., description="Whether pose was detected")
    landmarks: list[Landmark] = Field(
        default_factory=list, description="33 pose landmarks if detected"
    )


class HandResult(BaseModel):
    """Result from hand landmark detection."""

    detected: bool = Field(..., description="Whether hand was detected")
    landmarks: list[Landmark] = Field(
        default_factory=list, description="21 hand landmarks if detected"
    )
    handedness: str = Field(default="unknown", description="Left or Right hand")


class HolisticResult(BaseModel):
    """Complete holistic tracking result."""

    face: FaceResult = Field(default_factory=lambda: FaceResult(detected=False))
    pose: PoseResult = Field(default_factory=lambda: PoseResult(detected=False))
    left_hand: HandResult = Field(default_factory=lambda: HandResult(detected=False))
    right_hand: HandResult = Field(default_factory=lambda: HandResult(detected=False))


class FrameAnalysis(BaseModel):
    """Complete analysis of a single frame.

    Designed to be extensible for future emotion and VLM integration.
    """

    frame_id: int = Field(..., description="Sequential frame identifier")
    timestamp_ms: float = Field(..., description="Frame timestamp in milliseconds")
    holistic: HolisticResult = Field(
        default_factory=HolisticResult, description="Holistic tracking result"
    )


class ProcessorConfig(BaseModel):
    """Configuration for the holistic processor."""

    min_detection_confidence: float = Field(
        default=0.5, ge=0.0, le=1.0, description="Minimum detection confidence threshold"
    )
    min_tracking_confidence: float = Field(
        default=0.5, ge=0.0, le=1.0, description="Minimum tracking confidence threshold"
    )
    model_complexity: int = Field(
        default=1, ge=0, le=2, description="Model complexity (0=lite, 1=full, 2=heavy)"
    )
    refine_face_landmarks: bool = Field(
        default=True, description="Enable face landmark refinement for 468 landmarks"
    )
    enable_segmentation: bool = Field(
        default=False, description="Enable segmentation mask output"
    )
