"""
Data models for the projected topic-agenda feature and real-time tracker.

The core idea: given two legal briefs, generate N different predicted lists
of topics the judge will raise during the hearing.  Each prediction represents
a different possible judicial focus — a distinct trajectory the argument could
follow depending on which legal angle the panel prioritises.

The TrajectoryTracker then classifies which agenda best matches the live hearing
in real-time and incorporates human (appellate counsel) turn feedback.
"""

from typing import Dict, List, Literal, Optional
from pydantic import BaseModel


class TopicPredictionRequest(BaseModel):
    """Request body for generating predicted judge topic agendas."""
    appellant_brief:  str
    appellee_brief:   str
    num_predictions:  int = 5    # How many distinct agendas to generate (1–10)
    proceeding_type:  str = "appellate argument"


class JudgeTopic(BaseModel):
    """A single topic/question the judge is predicted to raise."""
    order:       int    # Position within this agenda (1-indexed)
    title:       str    # Short label, e.g. "Scope of NWP 12 Exemption"
    description: str    # What the judge would probe — 1-2 sentences
    target:      Literal["appellant", "appellee", "both"]  # Who bears the burden


class TopicPrediction(BaseModel):
    """
    One predicted judge agenda — a prioritised list of topics the judge
    would cover if they approached the case through a particular lens.
    """
    prediction_id: int
    lens:          str           # The judicial angle, e.g. "Statutory Text"
    rationale:     str           # Why this lens is plausible given the briefs
    topics:        List[JudgeTopic]


class PredictedTopicSets(BaseModel):
    """
    Full output: case summary + N distinct predicted judge agendas.
    Each agenda is an independent forecast of how a judge might structure
    their questioning depending on which issues they prioritise.
    """
    case_summary:      str
    key_legal_issues:  List[str]         # Issues common to all predictions
    predictions:       List[TopicPrediction]
    total_predictions: int


# ---------------------------------------------------------------------------
# Trajectory tracker models  (real-time classifier + human-in-loop feedback)
# ---------------------------------------------------------------------------

class TrackerInitRequest(BaseModel):
    """Bootstrap the tracker from a completed PredictedTopicSets response."""
    predicted_topic_sets: PredictedTopicSets
    # Optional: pre-seed the tracker with the opening judge statement
    initial_judge_utterance: Optional[str] = None


class HearingTurn(BaseModel):
    """A single spoken turn submitted to the tracker."""
    speaker:   Literal["judge", "appellant", "appellee"]
    utterance: str


class TopicCoverageItem(BaseModel):
    """Coverage status for one topic within an agenda."""
    order:       int
    title:       str
    addressed:   bool
    address_turn: Optional[int] = None   # turn index when it was first addressed


class AgendaConfidence(BaseModel):
    """Per-agenda confidence score + topic coverage at the current turn."""
    prediction_id:   int
    lens:            str
    confidence:      float                   # 0.0 – 1.0, higher = better match
    topics_coverage: List[TopicCoverageItem]
    uncovered_titles: List[str]              # topics not yet addressed


class TrackerStateResponse(BaseModel):
    """
    Returned after every tracker update.

    - best_prediction_id  : which agenda currently best matches the hearing
    - agenda_confidences  : ranked list (best first)
    - regeneration_needed : True when max confidence < threshold → AR trigger
    - turn_count          : total turns processed so far
    - last_human_point    : the most recent appellant/appellee utterance, echoed
                            back with the matched topic title (if any)
    """
    best_prediction_id:  int
    agenda_confidences:  List[AgendaConfidence]   # sorted desc by confidence
    regeneration_needed: bool
    turn_count:          int
    last_human_matched_topic: Optional[str] = None   # title of matched topic, if any


class RegenerationRequest(BaseModel):
    """
    Trigger an AR (adaptive regeneration) pass for the weakest-scoring agendas.

    Only sent when TrackerStateResponse.regeneration_needed is True.
    """
    tracker_session_id: str
    # Transcribed turns so far — used as context for the regeneration prompt
    turns: List[HearingTurn]
    # Which agendas to regenerate (by prediction_id); empty = regenerate all
    target_prediction_ids: List[int] = []
