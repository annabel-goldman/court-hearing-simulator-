"""
Real-time trajectory classifier and human-in-loop feedback tracker.

Architecture
------------
1. At init, embed every topic title+description across all N pre-generated
   agendas using sentence-transformers (all-MiniLM-L6-v2 by default).
   This runs once and is cheap (~milliseconds for 50-70 topics).

2. On each judge turn:
   - Embed the utterance.
   - Compute cosine similarity against every topic vector.
   - Update per-agenda confidence scores using an EMA (exponential moving
     average) so recent turns carry more weight than older ones.
   - The agenda whose topics are collectively most similar to the observed
     judge turns is the "best match".

3. On each human (appellant / appellee) turn:
   - Embed the utterance.
   - Find the closest topic vector across all agendas in the best-matching
     agenda.
   - Mark that topic as addressed (human-in-loop coverage tracking).
   - Return the matched topic title so the UI can highlight it.

4. AR regeneration trigger:
   - If max_confidence < LOW_CONFIDENCE_THRESHOLD, set regeneration_needed=True.
   - The caller (router) then invokes generate_topic_sets() with updated context
     (transcript so far) to produce fresh agendas.  This is the "AR" step —
     lazy regeneration only when the classifier is lost, not on every turn.

Embedding backend
-----------------
Primary  : sentence-transformers (all-MiniLM-L6-v2) — loaded lazily once.
Fallback : TF-IDF keyword overlap — used if sentence-transformers is not
           installed (keeps the tracker functional in minimal deployments).

Session storage
---------------
Each tracker session is keyed by a UUID and stored in an in-process dict.
For production, swap _SESSIONS for Redis or a DB-backed store.
"""

from __future__ import annotations

import json
import logging
import math
import re
import uuid
from typing import Dict, List, Optional, Tuple

from .models import (
    AgendaConfidence,
    HearingTurn,
    PredictedTopicSets,
    TopicCoverageItem,
    TopicPrediction,
    TrackerStateResponse,
)

logger = logging.getLogger("court-simulator.projected_timeline.tracker")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

LOW_CONFIDENCE_THRESHOLD = 0.25   # below this → suggest AR regeneration
EMA_ALPHA               = 0.4    # weight of the latest turn vs. running average
                                  # higher = more reactive, lower = more stable
QUALITY_WEAK_THRESHOLD   = 0.4   # below this → topic is "weak" (needs follow-up)

# ---------------------------------------------------------------------------
# LLM quality-assessment backend — uses SMALL tier via model_router
# ---------------------------------------------------------------------------

from model_router import get_task_client


_QUALITY_SYSTEM = (
    "You are a senior appellate judge evaluating the quality of an advocate's "
    "response to a specific legal topic.  Return ONLY a JSON object."
)

_QUALITY_USER = """\
TOPIC BEING ASSESSED: {topic_title}
TOPIC DESCRIPTION   : {topic_description}
ADVOCATE'S UTTERANCE:
{utterance}

Rate how convincingly the advocate addressed this topic on a scale of 0.0 to 1.0:
  0.0 – not addressed at all / completely off-topic
  0.2 – mentioned tangentially but no substantive argument
  0.4 – basic mention with some relevance but weak reasoning
  0.6 – reasonable argument but missing key supporting authority or logic
  0.8 – strong argument with clear reasoning and some citations
  1.0 – compelling, complete argument with authority and strong logical structure

Return JSON: {{"quality": <float>, "rationale": "<one sentence>"}}"""


async def _assess_quality_llm(
    utterance: str,
    topic_title: str,
    topic_description: str,
) -> float:
    """Call the LLM to assess how well the advocate addressed the topic.

    Returns a float 0.0–1.0.  Falls back to a heuristic if the LLM is
    unavailable or the call fails.
    """
    client, model = get_task_client("quality_assessment")
    if client is None:
        return _assess_quality_heuristic(utterance, topic_title)

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _QUALITY_SYSTEM},
                {
                    "role": "user",
                    "content": _QUALITY_USER.format(
                        topic_title=topic_title,
                        topic_description=topic_description,
                        utterance=utterance[-1500:],
                    ),
                },
            ],
            temperature=0.1,
            max_tokens=120,
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        )
        raw = response.choices[0].message.content.strip()
        # Strip <think>…</think> and markdown fences
        raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL)
        raw = re.sub(r"```(?:json)?\s*", "", raw)
        raw = re.sub(r"```\s*$", "", raw, flags=re.MULTILINE)

        match = re.search(r'\{[^{}]*"quality"\s*:\s*([\d.]+)[^{}]*\}', raw)
        if match:
            val = float(match.group(1))
            quality = max(0.0, min(1.0, val))
            logger.debug("LLM quality for '%s': %.2f", topic_title, quality)
            return quality

        # Try full json parse
        data = json.loads(raw)
        val = float(data.get("quality", 0.5))
        return max(0.0, min(1.0, val))

    except Exception as e:
        logger.warning("LLM quality assessment failed (%s); falling back to heuristic.", e)
        return _assess_quality_heuristic(utterance, topic_title)


def _assess_quality_heuristic(utterance: str, topic_title: str) -> float:
    """Fast heuristic fallback when LLM is unavailable.

    Considers: utterance length, whether the topic title or close keywords
    appear, sentence count, and presence of legal signal words.
    """
    if not utterance.strip():
        return 0.0

    words = utterance.split()
    word_count = len(words)
    text_lower = utterance.lower()
    title_lower = topic_title.lower()

    # Base score from length (short = weak, medium = decent, long = good)
    if word_count < 10:
        base = 0.15
    elif word_count < 30:
        base = 0.3
    elif word_count < 80:
        base = 0.5
    else:
        base = 0.65

    # Bonus if topic keywords appear in the utterance
    title_words = set(title_lower.split()) - {"the", "of", "and", "in", "a", "to", "for"}
    overlap = sum(1 for tw in title_words if tw in text_lower)
    keyword_bonus = min(0.15, 0.05 * overlap)

    # Bonus for legal reasoning signals
    legal_signals = [
        "because", "therefore", "court held", "precedent", "under the statute",
        "the record shows", "standard of review", "this court", "we submit",
        "the evidence", "constitutional", "legislative history",
    ]
    signal_count = sum(1 for s in legal_signals if s in text_lower)
    signal_bonus = min(0.2, 0.05 * signal_count)

    return min(1.0, base + keyword_bonus + signal_bonus)

# ---------------------------------------------------------------------------
# Embedding backend (lazy-loaded)
# ---------------------------------------------------------------------------

_embed_model = None
_USE_SBERT   = None   # tri-state: None = not yet checked, True/False = resolved


def _resolve_embed_backend() -> bool:
    """Return True if sentence-transformers is available, False → fallback."""
    global _USE_SBERT
    if _USE_SBERT is not None:
        return _USE_SBERT
    try:
        import sentence_transformers  # noqa: F401
        _USE_SBERT = True
    except ImportError:
        logger.warning(
            "sentence-transformers not installed; falling back to keyword overlap. "
            "Install with: pip install sentence-transformers"
        )
        _USE_SBERT = False
    return _USE_SBERT


def _get_embed_model():
    global _embed_model
    if _embed_model is None and _resolve_embed_backend():
        from sentence_transformers import SentenceTransformer
        # local_files_only avoids HuggingFace Hub network calls on every load
        try:
            _embed_model = SentenceTransformer("all-MiniLM-L6-v2", local_files_only=True)
            logger.info("Loaded sentence-transformers embedding model (all-MiniLM-L6-v2) [local cache]")
        except Exception:
            # First run — model not cached yet, download it
            _embed_model = SentenceTransformer("all-MiniLM-L6-v2")
            logger.info("Downloaded & loaded sentence-transformers embedding model (all-MiniLM-L6-v2)")
    return _embed_model


def _embed(texts: List[str]) -> List[List[float]]:
    """Return a list of float vectors for each text."""
    if _resolve_embed_backend():
        model = _get_embed_model()
        vecs = model.encode(texts, normalize_embeddings=True)
        return [v.tolist() for v in vecs]
    # Fallback: simple normalised character-trigram bag
    return [_trigram_vector(t) for t in texts]


def _trigram_vector(text: str) -> List[float]:
    """Normalised trigram frequency vector (fallback when sbert unavailable)."""
    text = text.lower()
    trigrams: Dict[str, int] = {}
    for i in range(len(text) - 2):
        g = text[i : i + 3]
        trigrams[g] = trigrams.get(g, 0) + 1
    norm = math.sqrt(sum(v * v for v in trigrams.values())) or 1.0
    # Return as a stable list keyed by sorted trigram — sparse but consistent
    return {g: c / norm for g, c in trigrams.items()}  # type: ignore[return-value]


def _cosine(a, b) -> float:
    """Cosine similarity between two vectors (list[float] or dict)."""
    if isinstance(a, dict):
        # Sparse fallback vectors
        dot = sum(a.get(k, 0.0) * v for k, v in b.items())
        na  = math.sqrt(sum(v * v for v in a.values())) or 1.0
        nb  = math.sqrt(sum(v * v for v in b.values())) or 1.0
        return dot / (na * nb)
    # Dense sbert vectors
    dot = sum(x * y for x, y in zip(a, b))
    # Vectors are pre-normalised by sbert so dot == cosine directly
    return float(dot)


# ---------------------------------------------------------------------------
# Per-session tracker state
# ---------------------------------------------------------------------------

class _AgendaState:
    """Mutable state for one predicted agenda within a session."""

    def __init__(self, prediction: TopicPrediction, topic_vectors: List):
        self.prediction    = prediction
        self.topic_vectors = topic_vectors          # one vector per topic
        self.confidence    = 0.5                    # start neutral
        self.coverage: Dict[int, bool]  = {         # order → addressed?
            t.order: False for t in prediction.topics
        }
        self.coverage_turn: Dict[int, Optional[int]] = {
            t.order: None for t in prediction.topics
        }
        self.quality: Dict[int, float] = {           # order → quality score (0.0–1.0)
            t.order: 0.0 for t in prediction.topics
        }

    def update_confidence(self, utterance_vec, *, alpha: float = EMA_ALPHA):
        """EMA update: shift confidence toward max topic similarity for this turn."""
        if not self.topic_vectors:
            return
        sims = [_cosine(utterance_vec, tv) for tv in self.topic_vectors]
        turn_score = max(sims)
        self.confidence = (1 - alpha) * self.confidence + alpha * turn_score

    def best_topic_match(self, utterance_vec) -> Tuple[int, str, float]:
        """Return (order, title, similarity) of the closest topic to utterance."""
        best_sim, best_order, best_title = -1.0, -1, ""
        for topic, tv in zip(self.prediction.topics, self.topic_vectors):
            s = _cosine(utterance_vec, tv)
            if s > best_sim:
                best_sim, best_order, best_title = s, topic.order, topic.title
        return best_order, best_title, best_sim

    def mark_addressed(self, order: int, turn_index: int, quality: float = 0.5):
        if order in self.coverage:
            if not self.coverage[order]:
                self.coverage[order]      = True
                self.coverage_turn[order] = turn_index
            # Quality can only go up — revisiting a topic with a stronger
            # argument improves the score, but never resets it.
            self.quality[order] = max(self.quality.get(order, 0.0), quality)

    def to_agenda_confidence(self) -> AgendaConfidence:
        coverage_items = [
            TopicCoverageItem(
                order=t.order,
                title=t.title,
                addressed=self.coverage[t.order],
                address_turn=self.coverage_turn[t.order],
                quality=round(self.quality.get(t.order, 0.0), 3),
            )
            for t in self.prediction.topics
        ]
        uncovered = [t.title for t in self.prediction.topics if not self.coverage[t.order]]
        weak = [
            t.title for t in self.prediction.topics
            if self.coverage[t.order] and self.quality.get(t.order, 0.0) < 0.4
        ]
        return AgendaConfidence(
            prediction_id=self.prediction.prediction_id,
            lens=self.prediction.lens,
            confidence=round(self.confidence, 4),
            topics_coverage=coverage_items,
            uncovered_titles=uncovered,
            weak_titles=weak,
        )


class TrajectoryTracker:
    """
    Tracks which predicted agenda best matches the live hearing.

    Lifecycle
    ---------
    1. Instantiate with a PredictedTopicSets (from /generate).
    2. Call update(turn) for every spoken turn during the hearing.
    3. Read state() to get ranked confidences + coverage + regen flag.
    """

    def __init__(self, predicted: PredictedTopicSets):
        self.session_id  = str(uuid.uuid4())
        self.turn_count  = 0
        self._last_human_matched: Optional[str] = None

        # Embed all topic texts up front (one batch call)
        all_texts: List[str] = []
        for pred in predicted.predictions:
            for t in pred.topics:
                all_texts.append(f"{t.title}. {t.description}")

        logger.info("Embedding %d topic texts for session %s …", len(all_texts), self.session_id)
        all_vecs = _embed(all_texts) if all_texts else []

        # Distribute vectors back to per-agenda state objects
        self._agendas: List[_AgendaState] = []
        idx = 0
        for pred in predicted.predictions:
            n = len(pred.topics)
            topic_vecs = all_vecs[idx : idx + n]
            idx += n
            self._agendas.append(_AgendaState(pred, topic_vecs))

        logger.info(
            "TrajectoryTracker ready: %d agendas, session %s",
            len(self._agendas),
            self.session_id,
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def update(self, turn: HearingTurn) -> "tuple[TrackerStateResponse, tuple]":
        """
        Process one spoken turn and return (state, refinement_args).

        This is now fully synchronous — embedding + heuristic quality only.
        The caller receives `refinement_args` and may schedule
        ``schedule_quality_refinement(*refinement_args)`` as a background
        coroutine to improve the quality score without blocking the hot path.

        refinement_args is (agenda, order, utterance, title, desc) for human
        turns, or an empty tuple for judge turns.
        """
        self.turn_count += 1
        self._last_human_matched = None

        utterance_vec = _embed([turn.utterance])[0]

        refinement_args: tuple = ()
        if turn.speaker == "judge":
            self._process_judge(utterance_vec)
        else:
            agenda, order, title, desc = self._process_human(utterance_vec, turn.utterance)
            if agenda is not None:
                refinement_args = (agenda, order, turn.utterance, title, desc)

        return self.state(), refinement_args

    def state(self) -> TrackerStateResponse:
        """Return the current tracker state without advancing the turn counter."""
        sorted_agendas = sorted(self._agendas, key=lambda a: a.confidence, reverse=True)
        best_id        = sorted_agendas[0].prediction.prediction_id

        max_conf           = sorted_agendas[0].confidence
        regeneration_needed = max_conf < LOW_CONFIDENCE_THRESHOLD

        return TrackerStateResponse(
            best_prediction_id=best_id,
            agenda_confidences=[a.to_agenda_confidence() for a in sorted_agendas],
            regeneration_needed=regeneration_needed,
            turn_count=self.turn_count,
            last_human_matched_topic=self._last_human_matched,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _process_judge(self, utterance_vec):
        """Update confidence for every agenda based on this judge utterance."""
        for agenda in self._agendas:
            agenda.update_confidence(utterance_vec)

    def _process_human(self, utterance_vec, utterance_text: str):
        """
        Mark the closest topic in the best-matching agenda as addressed.

        Quality is scored immediately via the fast heuristic so this method
        is synchronous and never blocks the event loop.  A background LLM
        refinement task (scheduled by the caller via schedule_quality_refinement)
        can later update the quality score once the LLM responds.
        """
        # Find the agenda + topic that best matches this human utterance
        best_agenda: Optional[_AgendaState] = None
        best_order  = -1
        best_title  = ""
        best_desc   = ""
        best_sim    = -1.0

        for agenda in self._agendas:
            order, title, sim = agenda.best_topic_match(utterance_vec)
            if sim > best_sim:
                best_sim, best_agenda, best_order, best_title = sim, agenda, order, title
                best_desc = next(
                    (t.description for t in agenda.prediction.topics if t.order == order),
                    "",
                )

        if best_agenda is not None and best_sim > 0.1:
            # Use heuristic immediately — never blocks; LLM refinement happens in background
            quality = _assess_quality_heuristic(utterance_text, best_title)
            best_agenda.mark_addressed(best_order, self.turn_count, quality=quality)
            self._last_human_matched = best_title
            best_agenda.confidence = min(
                1.0,
                best_agenda.confidence + EMA_ALPHA * 0.3,
            )
            logger.info(
                "Human turn matched topic '%s' in agenda %d (sim=%.3f, heuristic_quality=%.2f)",
                best_title,
                best_agenda.prediction.prediction_id,
                best_sim,
                quality,
            )
            # Return info needed by caller to schedule async LLM refinement
            return best_agenda, best_order, best_title, best_desc
        return None, -1, "", ""

    async def schedule_quality_refinement(
        self,
        agenda: "_AgendaState",
        order: int,
        utterance_text: str,
        topic_title: str,
        topic_description: str,
    ) -> None:
        """Refine a topic's quality score with an LLM call (non-blocking background task).

        Call this after _process_human returns. The heuristic score already
        in the tracker will be overwritten with the (better) LLM score if
        the model rates the argument higher.
        """
        try:
            quality = await _assess_quality_llm(
                utterance=utterance_text,
                topic_title=topic_title,
                topic_description=topic_description,
            )
            agenda.mark_addressed(order, self.turn_count, quality=quality)
            logger.debug("LLM quality refinement for '%s': %.2f", topic_title, quality)
        except Exception as e:
            logger.debug("LLM quality refinement skipped (%s)", e)


# ---------------------------------------------------------------------------
# In-process session store  (swap for Redis/DB in production)
# ---------------------------------------------------------------------------

_SESSIONS: Dict[str, TrajectoryTracker] = {}


def create_session(predicted: PredictedTopicSets) -> TrajectoryTracker:
    tracker = TrajectoryTracker(predicted)
    _SESSIONS[tracker.session_id] = tracker
    return tracker


def get_session(session_id: str) -> Optional[TrajectoryTracker]:
    return _SESSIONS.get(session_id)


def delete_session(session_id: str) -> bool:
    return _SESSIONS.pop(session_id, None) is not None
