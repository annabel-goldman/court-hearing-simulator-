"""
Multi-Agent Prompts

All prompt templates used for LLM calls.
Edit these to customize agent behavior.
"""

from typing import List
from .models import Agent


# =============================================================================
# BRIEF SUMMARY PROMPTS
# =============================================================================

SUMMARY_SYSTEM_PROMPT = """You are an expert legal summarizer preparing materials for appellate judges."""

def build_summary_user_prompt(user_brief: str, opposing_brief: str, max_brief_chars: int = 5000) -> str:
    """
    Build the user prompt for generating a brief summary.
    
    Args:
        user_brief: The user's legal brief text
        opposing_brief: The opposing counsel's brief text
        max_brief_chars: Maximum characters to include from each brief
    
    Returns:
        Formatted prompt string
    """
    return f"""You are a senior law clerk preparing a summary for multiple appellate judges.
Provide a concise summary (max 400 words) that captures:

1. The core legal dispute and procedural posture
2. The user's primary arguments and key authorities
3. The opposing counsel's primary arguments and key authorities
4. Critical factual issues in dispute
5. The central legal questions to be resolved

USER'S BRIEF:
{user_brief[:max_brief_chars]}

OPPOSING COUNSEL'S BRIEF:
{opposing_brief[:max_brief_chars]}

Format as a professional judicial summary that will help multiple judges formulate questions."""


# =============================================================================
# AGENT QUESTION PROMPTS
# =============================================================================

def build_agent_system_prompt(agent: Agent) -> str:
    """
    Build the system prompt for an agent to analyze transcript and decide on questions.
    
    Args:
        agent: The agent configuration
    
    Returns:
        Formatted system prompt string
    """
    example_questions_formatted = '\n'.join(f'- {q}' for q in agent.example_questions)
    triggers_formatted = ', '.join(agent.triggers)
    
    return f"""You are {agent.name}.

PERSONALITY: {agent.description}

YOUR TRIGGERS (topics that MUST appear explicitly in the transcript to prompt a question):
{triggers_formatted}

EXAMPLE QUESTIONS YOU MIGHT ASK:
{example_questions_formatted}

ADDITIONAL INSTRUCTIONS:
{agent.extra_prompt}

You are listening to an advocate's oral argument. Your default is to stay silent.
Only interrupt when the transcript DIRECTLY and EXPLICITLY addresses one of your trigger topics —
not by inference, not tangentially, not because the general case might relate.

RULES:
- If you are unsure whether to ask, do NOT ask. Silence is correct when in doubt.
- Only set should_ask=true when the transcript contains specific content you cannot let pass.
- Do NOT repeat questions that have already been asked.
- If you decide to ask, make your question sharp, specific, and directly tied to what was said."""


def build_agent_user_prompt(
    agent: Agent,
    transcript: str,
    brief_summary: str,
    questions_already_asked: List[str],
    max_transcript_chars: int = 2000,
    max_summary_chars: int = 1000,
) -> str:
    """
    Build the user prompt for an agent to analyze and potentially ask a question.
    
    Args:
        agent: The agent configuration
        transcript: The current transcript of the oral argument
        brief_summary: Summary of the briefs
        questions_already_asked: List of questions already asked by any agent
        max_transcript_chars: Maximum characters of transcript to include
        max_summary_chars: Maximum characters of summary to include
    
    Returns:
        Formatted user prompt string
    """
    # Build questions context
    questions_context = ""
    if questions_already_asked:
        recent_questions = questions_already_asked[-10:]
        questions_context = "\n\nQUESTIONS ALREADY ASKED (do not repeat):\n" + "\n".join(f"- {q}" for q in recent_questions)
    
    # Truncate transcript to recent portion
    truncated_transcript = transcript[-max_transcript_chars:] if len(transcript) > max_transcript_chars else transcript
    
    # Truncate summary
    truncated_summary = brief_summary[:max_summary_chars] if brief_summary else "No brief summary available."
    
    return f"""BRIEF SUMMARY:
{truncated_summary}

RECENT TRANSCRIPT:
{truncated_transcript}
{questions_context}

Based on the recent transcript, should you ({agent.name}) ask a question now?

Respond in JSON format:
{{"should_ask": true/false, "question": "Your question here or null", "relevance": 1-10}}

Where relevance measures how directly this transcript touches your specific triggers:
1-3 = barely mentioned or only general background
4-5 = tangential or implicit connection
6-7 = clearly relevant but not urgent
8-9 = directly addresses one of your core triggers
10 = this is the single most important issue in your domain and it demands an answer now

IMPORTANT: Most transcript segments should score 1-5. A score of 7 or above means the
advocate literally said something that falls squarely in your trigger area. Score honestly —
do not inflate. Only set should_ask=true when relevance is 7 or higher."""


# =============================================================================
# RESPONSE FORMAT
# =============================================================================

AGENT_RESPONSE_FORMAT = """{{"should_ask": true/false, "question": "Your question here or null", "relevance": 1-10}}"""
