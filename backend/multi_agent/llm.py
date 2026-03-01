"""
Multi-Agent LLM Service

OpenAI API calls for generating summaries and agent questions.
"""

import json
import logging
import os
import re
from typing import List, Optional, Tuple

logger = logging.getLogger(__name__)

from dotenv import load_dotenv

from .models import Agent
from .prompts import (
    SUMMARY_SYSTEM_PROMPT,
    build_summary_user_prompt,
    build_agent_system_prompt,
    build_agent_user_prompt,
)

# Load environment variables
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".env"))

from model_router import get_task_client


class MultiAgentLLM:
    """
    Handles all LLM interactions for the multi-agent system.
    Uses centralized model_router for per-task model selection.
    """

    def __init__(self, model: str = ""):
        """
        Initialize the LLM service.
        
        Args:
            model: Unused — kept for backward compat. Routing handled by model_router.
        """
        pass

    async def generate_brief_summary(
        self,
        user_brief: str,
        opposing_brief: str,
    ) -> str:
        """
        Generate a summary of both briefs using OpenAI.
        
        Args:
            user_brief: The user's legal brief text
            opposing_brief: The opposing counsel's brief text
        
        Returns:
            Generated summary string
        """
        client, model = get_task_client("brief_summary")
        if not client:
            return "Summary unavailable (API key not set)."

        user_prompt = build_summary_user_prompt(user_brief, opposing_brief)

        try:
            response = await client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.3,
                max_tokens=600
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            print(f"Error summarizing briefs: {e}")
            return f"Error generating summary: {str(e)}"

    async def analyze_agent_question(
        self,
        agent: Agent,
        transcript: str,
        brief_summary: str,
        questions_already_asked: List[str] = [],
        trajectory_context: Optional[dict] = None,
    ) -> Tuple[bool, Optional[str]]:
        """
        Determine if an agent should ask a question based on the current transcript.
        
        Args:
            agent: The agent configuration
            transcript: Current transcript of the oral argument
            brief_summary: Summary of the briefs
            questions_already_asked: List of questions already asked by any agent
        
        Returns:
            Tuple of (should_ask: bool, question: str or None)
        """
        client, model = get_task_client("agent_analysis")
        if not client:
            logger.warning("[MultiAgent LLM] No client for 'agent_analysis' — check API key / model config")
            return False, None

        system_prompt = build_agent_system_prompt(agent)
        user_prompt = build_agent_user_prompt(
            agent=agent,
            transcript=transcript,
            brief_summary=brief_summary,
            questions_already_asked=questions_already_asked,
            trajectory_context=trajectory_context,
        )

        try:
            logger.debug("[MultiAgent LLM] %s prompt transcript snippet (%d chars): …%s",
                         agent.name, len(user_prompt), user_prompt[-200:])
            response = await client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.7,
                max_tokens=200,
                # Disable Qwen3 thinking mode: the full token budget was being spent
                # on <think>...</think> blocks, leaving 0 tokens for the actual
                # ASK:/QUESTION: response.  /no_think in the prompt is a soft hint;
                # enable_thinking=False is the hard disable via llama-server.
                extra_body={"chat_template_kwargs": {"enable_thinking": False}},
            )

            raw = response.choices[0].message.content or ""
            # Strip Qwen3 <think>...</think> blocks that consume token budget
            content = re.sub(r'<think>[\s\S]*?</think>', '', raw).strip()
            # If stripping left nothing, try the raw text (partial think block)
            if not content and raw.strip():
                # Remove an unclosed <think> tag (model ran out of tokens mid-think)
                content = re.sub(r'<think>[\s\S]*', '', raw).strip()
            logger.info("[MultiAgent LLM] %s raw response (%d chars): %s",
                        agent.name, len(content), content[:300])

            # Remove markdown code blocks if present
            if content.startswith("```"):
                lines = content.split("\n")
                content = "\n".join(lines[1:-1]) if len(lines) > 2 else content

            should_ask = False
            question = None

            # Strategy 1: ASK: yes/no + QUESTION: ... format
            ask_match = re.search(r'ASK:\s*(yes|no|true|false)', content, re.IGNORECASE)
            q_match = re.search(r'QUESTION:\s*(.+)', content, re.IGNORECASE)
            if ask_match:
                should_ask = ask_match.group(1).lower() in ('yes', 'true')
                if q_match and should_ask:
                    question = q_match.group(1).strip().strip('"\'')

            # Strategy 2: JSON format {"should_ask": true, "question": "..."}
            if not should_ask:
                json_match = re.search(r'\{[^{}]*\}', content, re.DOTALL)
                if json_match:
                    try:
                        result = json.loads(json_match.group(0))
                        should_ask = bool(result.get('should_ask', False))
                        if should_ask:
                            question = result.get('question')
                    except json.JSONDecodeError:
                        pass

            # Strategy 3: Response contains a question mark — LLM wrote a question directly
            if not should_ask and '?' in content:
                for line in reversed(content.strip().split('\n')):
                    line = line.strip().strip('"\'')
                    if '?' in line and len(line) > 15:
                        should_ask = True
                        # Clean common prefixes
                        question = re.sub(
                            r'^(QUESTION:|Q:|Sure[,.]|Yes[,.]|I would ask:|My question:)\s*',
                            '', line, flags=re.IGNORECASE,
                        ).strip()
                        break

            # Strategy 4: First line says yes/true, grab question from subsequent lines
            if not should_ask:
                first_line = content.split('\n')[0].lower()
                if any(w in first_line for w in ('yes', 'true', 'interrupt', 'i should')):
                    should_ask = True
                    for line in content.split('\n')[1:]:
                        line = line.strip().strip('"\'')
                        if len(line) > 15:
                            question = line
                            break

            # Fallback question if model said yes but didn't provide one
            if should_ask and not question:
                question = "Counsel, could you elaborate on that last point for the court?"

            return should_ask, question if should_ask else None

        except Exception as e:
            logger.error("Error in agent analysis for %s: %s", agent.name, e)
            return False, None


# Global instance for easy import
multi_agent_llm = MultiAgentLLM()
