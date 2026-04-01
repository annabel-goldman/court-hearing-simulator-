"""
Judge Engine for Courtroom Simulation
Scores advocate arguments using configurable reward dimensions.
"""

import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

logger = logging.getLogger("court-simulator.judge_engine")

_judge_cfg_cache: dict = {}
_JUDGE_CFG_TTL = 30  # seconds

def _get_cached_judge_config():
    from services.judge_config import load_config
    now = time.time()
    if now - _judge_cfg_cache.get("ts", 0) > _JUDGE_CFG_TTL:
        _judge_cfg_cache["cfg"] = load_config()
        _judge_cfg_cache["ts"] = now
    return _judge_cfg_cache["cfg"]


@dataclass
class ArgumentScore:
    """Score for a single argument turn."""
    speaker: str                 # "appellant" | "respondent"
    utterance_preview: str       # first 120 chars of the utterance
    clarity: float               # 0-10
    legal_reasoning: float       # 0-10
    responsiveness: float        # 0-10
    persuasiveness: float        # 0-10
    overall: float               # 0-10 — weighted composite
    feedback: str                # one-sentence coaching note
    timestamp: float = field(default_factory=time.monotonic)

from model_router import get_task_client, extract_content, task_extra_body


class _SessionContext:
    """Minimal per-session state for accumulating argument scores."""

    def __init__(self):
        self.argument_scores: Dict[str, List[ArgumentScore]] = {
            "appellant": [],
            "respondent": [],
        }


class JudgeEngine:
    """Scores advocate arguments using LLM-based evaluation."""

    def __init__(self):
        self.contexts: Dict[str, _SessionContext] = {}

    def _get_or_create_context(self, session_id: str) -> _SessionContext:
        if session_id not in self.contexts:
            self.contexts[session_id] = _SessionContext()
        return self.contexts[session_id]

    async def score_argument(
        self,
        session_id: str,
        speaker: str,
        utterance: str,
        brief_summary: Optional[str] = None,
        topic: Optional[str] = None,
        judge_question_answered: Optional[str] = None,
    ) -> Optional[ArgumentScore]:
        """
        Score a single argument turn by the appellant or respondent.

        Returns an ArgumentScore, or None on LLM/parse failure.
        """
        if not utterance or len(utterance.split()) < 5:
            return None

        context = self._get_or_create_context(session_id)

        cfg = _get_cached_judge_config()
        dims = cfg.reward_dimensions

        dim_lines = "\n".join(
            f"  {d.name:<22} — {d.description}" for d in dims
        )
        formula = " + ".join(f"{d.name}×{d.weight}" for d in dims)
        example_fields = ", ".join(f'"{d.name}": 7.0' for d in dims)
        system_msg = cfg.scoring_prompt_template.strip() or "You are an expert moot court evaluator. Reply with JSON only."

        parts: list[str] = []
        if brief_summary:
            parts.append(f"BRIEF SUMMARY (case context):\n{brief_summary[:400]}\n\n")
        if topic:
            parts.append(f"TOPIC BEING ARGUED: {topic}\n\n")
        if judge_question_answered:
            parts.append(f"JUDGE'S QUESTION THIS TURN IS RESPONDING TO:\n{judge_question_answered}\n\n")

        parts.append(
            f"SPEAKER: {speaker.upper()}\n"
            f"ARGUMENT:\n{utterance[:1200]}\n\n"
            f"Score each dimension 0-10 (decimals allowed):\n"
            f"{dim_lines}\n\n"
            f"overall = weighted average: {formula}\n\n"
            "Also provide a one-sentence 'feedback' coaching note for the advocate.\n\n"
            "Respond with valid JSON only — no markdown:\n"
            f"{{{example_fields}, \"overall\": 7.0, \"feedback\": \"...\"}}"
        )

        prompt = "".join(parts)

        try:
            client, model = get_task_client("argument_scoring")
            if not client:
                return None

            response = await client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_msg},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.3,
                max_tokens=250,
                extra_body=task_extra_body("argument_scoring"),
            )

            content = extract_content(response)

            if content.startswith("```"):
                lines = content.split("\n")
                content = "\n".join(lines[1:-1]) if len(lines) > 2 else content

            json_match = re.search(r'\{[^{}]*\}', content, re.DOTALL)
            if json_match:
                content = json_match.group(0)

            raw = json.loads(content)

            score = ArgumentScore(
                speaker=speaker,
                utterance_preview=utterance[:120],
                clarity=float(raw.get("clarity", 5.0)),
                legal_reasoning=float(raw.get("legal_reasoning", 5.0)),
                responsiveness=float(raw.get("responsiveness", 5.0)),
                persuasiveness=float(raw.get("persuasiveness", 5.0)),
                overall=float(raw.get("overall", 5.0)),
                feedback=str(raw.get("feedback", "")),
            )

            key = "appellant" if speaker == "appellant" else "respondent"
            context.argument_scores.setdefault(key, []).append(score)
            return score

        except Exception as e:
            logger.error("[JudgeEngine] score_argument error: %s", e)
            return None
