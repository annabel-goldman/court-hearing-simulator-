"""
Multi-Agent LLM Service

OpenAI API calls for generating summaries and agent questions.
"""

import json
import os
import re
from typing import List, Optional, Tuple

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

# Reuse the OpenAI client from judge_engine
from services.judge_engine import get_openai_client


class MultiAgentLLM:
    """
    Handles all LLM interactions for the multi-agent system.
    """

    def __init__(self, model: str = "gpt-4"):
        """
        Initialize the LLM service.
        
        Args:
            model: OpenAI model to use for completions
        """
        self.model = model

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
        client = get_openai_client()
        if not client:
            return "Summary unavailable (API key not set)."

        user_prompt = build_summary_user_prompt(user_brief, opposing_brief)

        try:
            response = await client.chat.completions.create(
                model=self.model,
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
    ) -> Tuple[bool, Optional[str], int]:
        """
        Determine if an agent should ask a question based on the current transcript.
        
        Args:
            agent: The agent configuration
            transcript: Current transcript of the oral argument
            brief_summary: Summary of the briefs
            questions_already_asked: List of questions already asked by any agent

        Returns:
            Tuple of (should_ask: bool, question: str or None, relevance: int 1-3)
        """
        client = get_openai_client()
        if not client:
            return False, None, 1

        system_prompt = build_agent_system_prompt(agent)
        user_prompt = build_agent_user_prompt(
            agent=agent,
            transcript=transcript,
            brief_summary=brief_summary,
            questions_already_asked=questions_already_asked,
        )

        try:
            response = await client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.7,
                max_tokens=200
            )

            content = response.choices[0].message.content.strip()
            
            # Remove markdown code blocks if present
            if content.startswith("```"):
                lines = content.split("\n")
                content = "\n".join(lines[1:-1]) if len(lines) > 2 else content
            
            # Extract JSON
            json_match = re.search(r'\{[^{}]*\}', content, re.DOTALL)
            if json_match:
                result = json.loads(json_match.group(0))
                should_ask = result.get("should_ask", False)
                question = result.get("question")
                try:
                    relevance = max(1, min(10, int(result.get("relevance", 1))))
                except (TypeError, ValueError):
                    relevance = 1
                return should_ask, (question if should_ask else None), relevance

            return False, None, 1

        except Exception as e:
            print(f"Error in agent analysis for {agent.name}: {e}")
            return False, None, 1


# Global instance for easy import
multi_agent_llm = MultiAgentLLM()
