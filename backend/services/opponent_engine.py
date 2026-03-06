"""
Opponent Engine for Courtroom Simulation
=========================================

Generates adaptive respondent (opposing counsel) arguments in real-time.
The opponent uses the opposing brief as its knowledge base and adapts
its strategy based on what the advocate says and what judges ask.

Simpler than the judge engine — no scoring, no interruption timing.
The opponent reacts to:
  1. The advocate's latest argument (rebut)
  2. Judge questions (exploit weaknesses the judge probed)
  3. Tracked trajectory (press on weak / uncovered topics)

Uses SMALL tier for speed — opponent responses are advisory, not
quality-critical like judge questions.
"""

import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import time

from model_router import get_task_client, extract_content, task_extra_body
from services.opponent_config import load_config as load_opponent_config

# ---------------------------------------------------------------------------
# Config cache — avoids re-reading opponent_config.json on every LLM call.
# ---------------------------------------------------------------------------
_opp_cfg_cache: dict = {}
_OPP_CFG_TTL = 30  # seconds

def _get_cached_opponent_config():
    now = time.time()
    if now - _opp_cfg_cache.get("ts", 0) > _OPP_CFG_TTL:
        _opp_cfg_cache["cfg"] = load_opponent_config()
        _opp_cfg_cache["ts"] = now
    return _opp_cfg_cache["cfg"]

logger = logging.getLogger("court-simulator.opponent_engine")


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class OpponentResponse:
    """A single opponent rebuttal or strategic argument."""
    response_type: str          # "rebuttal" | "exploitation" | "affirmative"
    argument: str               # 2-4 sentence argument text
    strategy_note: str          # short note explaining the tactic (for the student)
    topic: str                  # legal topic addressed
    strength: float             # 0-10 estimated strength of this argument
    timestamp: float = field(default_factory=time.monotonic)


@dataclass
class OpponentState:
    """Per-session opponent state."""
    opposing_brief: str                 # full opposing brief text
    brief_summary: str                  # judicial summary of both briefs
    arguments_made: List[OpponentResponse] = field(default_factory=list)
    topics_pressed: List[str] = field(default_factory=list)
    judge_questions: List[str] = field(default_factory=list)
    # Tracks which topics the opponent has already rebutted to avoid repetition
    rebutted_topics: set = field(default_factory=set)


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

OPPONENT_SYSTEM_PROMPT = """You are an experienced appellate attorney representing the respondent \
(appellee) in a moot-court hearing. You are opposing the petitioner's argument.

Your role:
- Defend the lower court's decision
- Rebut the petitioner's arguments using facts and law from YOUR brief
- Exploit weaknesses that the judges have identified
- Be strategic: press hardest where the petitioner is weakest

Style:
- Be direct and assertive but professional
- Cite specific facts, precedents, or statutory provisions from your brief
- Keep responses focused: 2-4 sentences maximum
- Adapt your tone based on how the hearing is going

You must respond with valid JSON only — no markdown, no extra text."""


def _build_rebuttal_prompt(
    opposing_brief: str,
    brief_summary: str,
    advocate_utterance: str,
    recent_judge_questions: List[str],
    previous_arguments: List[str],
    trajectory_context: Optional[dict] = None,
) -> str:
    """Build the user prompt for generating an opponent rebuttal."""
    parts: list[str] = []

    parts.append("YOUR BRIEF (respondent/appellee — this is your source of authority):\n")
    parts.append(opposing_brief[:3000])
    parts.append("\n\n")

    if brief_summary:
        parts.append(f"CASE SUMMARY:\n{brief_summary[:600]}\n\n")

    parts.append(f"PETITIONER JUST ARGUED:\n\"{advocate_utterance[:800]}\"\n\n")

    if recent_judge_questions:
        parts.append("RECENT JUDGE QUESTIONS (exploit any weaknesses these reveal):\n")
        for q in recent_judge_questions[-5:]:
            parts.append(f"- {q}\n")
        parts.append("\n")

    if previous_arguments:
        parts.append("YOUR PREVIOUS ARGUMENTS (do not repeat):\n")
        for a in previous_arguments[-5:]:
            parts.append(f"- {a[:100]}\n")
        parts.append("\n")

    # Trajectory context: press on weak/uncovered topics
    if trajectory_context:
        weak = trajectory_context.get("weak_topics", [])
        uncovered = trajectory_context.get("uncovered_topics", [])
        if weak:
            parts.append(f"PETITIONER'S WEAK POINTS (press hard): {', '.join(weak[:5])}\n")
        if uncovered:
            parts.append(f"TOPICS PETITIONER HASN'T ADDRESSED (highlight gaps): {', '.join(uncovered[:5])}\n")
        parts.append("\n")

    parts.append(
        "Generate a sharp rebuttal to the petitioner's argument. "
        "Respond with JSON:\n"
        '{\n'
        '  "response_type": "rebuttal" | "exploitation" | "affirmative",\n'
        '  "argument": "Your 2-4 sentence argument",\n'
        '  "strategy_note": "Brief tactical note for the student (what makes this effective)",\n'
        '  "topic": "The legal topic you are addressing",\n'
        '  "strength": 7.5\n'
        '}\n\n'
        "response_type meanings:\n"
        '- "rebuttal": directly countering what the petitioner just said\n'
        '- "exploitation": leveraging a weakness a judge exposed\n'
        '- "affirmative": proactively arguing a point from your brief the petitioner missed\n'
    )

    return "".join(parts)


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

class OpponentEngine:
    """
    Generates adaptive opponent responses for the orchestrated-agents simulation.

    One instance is shared globally; per-session state is stored in `self.sessions`.
    """

    def __init__(self):
        self.sessions: Dict[str, OpponentState] = {}

    def init_session(
        self,
        session_id: str,
        opposing_brief: str,
        brief_summary: str = "",
    ) -> None:
        """Initialise or reset opponent state for a session."""
        self.sessions[session_id] = OpponentState(
            opposing_brief=opposing_brief,
            brief_summary=brief_summary,
        )
        logger.info(
            "[OpponentEngine] Session %s initialised (brief=%d chars, summary=%d chars)",
            session_id, len(opposing_brief), len(brief_summary),
        )

    def has_session(self, session_id: str) -> bool:
        return session_id in self.sessions

    def record_judge_question(self, session_id: str, question: str) -> None:
        """Record a judge question so the opponent can exploit it."""
        state = self.sessions.get(session_id)
        if state:
            state.judge_questions.append(question)

    def evict_session(self, session_id: str) -> None:
        """Remove session state (called on disconnect / TTL eviction)."""
        self.sessions.pop(session_id, None)

    async def generate_response(
        self,
        session_id: str,
        advocate_utterance: str,
        trajectory_context: Optional[dict] = None,
    ) -> Optional[OpponentResponse]:
        """
        Generate an opponent response to the advocate's latest argument.

        Parameters
        ----------
        session_id : str
        advocate_utterance : str — the flushed sentence(s) from the advocate
        trajectory_context : optional dict from _build_trajectory_context

        Returns an OpponentResponse, or None on failure / if brief is missing.
        """
        state = self.sessions.get(session_id)
        if not state or not state.opposing_brief:
            logger.info("[OpponentEngine] No session or brief for %s — skipping (pass opposing_brief in config)", session_id)
            return None

        # Don't respond to very short utterances
        word_count = len(advocate_utterance.split())
        if word_count < 8:
            logger.debug("[OpponentEngine] Utterance too short (%d words) for %s — skipping", word_count, session_id)
            return None

        client, model = get_task_client("opponent_response")
        if not client:
            logger.warning("[OpponentEngine] No LLM client for 'opponent_response'")
            return None

        # Load config (30 s TTL cache — picks up UI saves without per-call disk I/O)
        config = _get_cached_opponent_config()

        # Skip if the response type that would be generated is disabled
        # (we don't know yet, but we'll filter after generation)

        previous_args = [r.argument for r in state.arguments_made]
        prompt = _build_rebuttal_prompt(
            opposing_brief=state.opposing_brief,
            brief_summary=state.brief_summary,
            advocate_utterance=advocate_utterance,
            recent_judge_questions=state.judge_questions,
            previous_arguments=previous_args,
            trajectory_context=trajectory_context,
        )

        # Map aggressiveness (0-1) to temperature (0.3-1.0)
        temperature = 0.3 + config.aggressiveness * 0.7

        try:
            response = await client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": config.system_prompt},
                    {"role": "user", "content": prompt},
                ],
                temperature=temperature,
                max_tokens=300,
                extra_body=task_extra_body("opponent_response"),
            )

            content = extract_content(response)

            # Strip markdown code fences
            if content.startswith("```"):
                lines = content.split("\n")
                content = "\n".join(lines[1:-1]) if len(lines) > 2 else content

            # Extract JSON object
            json_match = re.search(r'\{[^{}]*\}', content, re.DOTALL)
            if json_match:
                content = json_match.group(0)

            data = json.loads(content)

            result = OpponentResponse(
                response_type=str(data.get("response_type", "rebuttal")),
                argument=str(data.get("argument", "")),
                strategy_note=str(data.get("strategy_note", "")),
                topic=str(data.get("topic", "")),
                strength=float(data.get("strength", 5.0)),
            )

            # Filter out disabled response types
            if result.response_type not in config.enabled_types:
                logger.info(
                    "[OpponentEngine] Discarded %s (disabled in config)",
                    result.response_type,
                )
                return None

            # Record for history
            state.arguments_made.append(result)
            if result.topic and result.topic not in state.rebutted_topics:
                state.rebutted_topics.add(result.topic)
                state.topics_pressed.append(result.topic)

            logger.info(
                "[OpponentEngine] Generated %s on '%s' (strength=%.1f): %s…",
                result.response_type, result.topic, result.strength,
                result.argument[:80],
            )
            return result

        except json.JSONDecodeError as e:
            logger.warning("[OpponentEngine] JSON parse error: %s — raw: %s", e, content[:200])
            return None
        except Exception as e:
            logger.error("[OpponentEngine] LLM call failed: %s", e)
            return None

    def get_session_summary(self, session_id: str) -> Dict:
        """Return a summary of opponent activity for the session."""
        state = self.sessions.get(session_id)
        if not state:
            return {"arguments": [], "topics_pressed": []}

        return {
            "arguments": [
                {
                    "response_type": r.response_type,
                    "argument": r.argument,
                    "strategy_note": r.strategy_note,
                    "topic": r.topic,
                    "strength": round(r.strength, 1),
                }
                for r in state.arguments_made
            ],
            "topics_pressed": state.topics_pressed,
        }
