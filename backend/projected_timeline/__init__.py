"""
Projected Timeline — SCOPE-inspired judicial topic-agenda forecasting.

Reads appellant + appellee briefs and generates N distinct predicted judge
topic agendas, each approached through a different judicial lens.  A real-time
TrajectoryTracker then classifies which agenda best matches the live hearing
and surfaces human-in-loop feedback when the appellate counsel makes a point.
"""

from .router import router
from .models import PredictedTopicSets, TopicPrediction

__all__ = ["router", "PredictedTopicSets", "TopicPrediction"]
