"""
Multi-Agent Simulation Module

This module provides a separate system for multi-agent brief analysis and
real-time questioning during oral argument practice.

File Structure:
    models.py   - Agent dataclass and data structures
    prompts.py  - LLM prompt templates (edit these to customize behavior)
    storage.py  - File I/O for loading/saving agent configurations
    llm.py      - OpenAI API calls for summaries and questions
    service.py  - Main orchestration service

Usage:
    from multi_agent import multi_agent_service, Agent
    
    # Get all agents
    agents = multi_agent_service.get_all_agents()
    
    # Generate a summary
    summary = await multi_agent_service.generate_brief_summary(user_brief, opposing_brief)
    
    # Check if an agent should ask a question
    should_ask, question = await multi_agent_service.analyze_agent_question(
        agent, transcript, summary, questions_asked
    )
"""

from .models import Agent
from .service import MultiAgentService, multi_agent_service
from .storage import AgentStorage, agent_storage
from .llm import MultiAgentLLM, multi_agent_llm
from .similarity import get_embedding, is_semantic_duplicate

__all__ = [
    "Agent",
    "MultiAgentService",
    "multi_agent_service",
    "AgentStorage",
    "agent_storage",
    "MultiAgentLLM",
    "multi_agent_llm",
    "get_embedding",
    "is_semantic_duplicate",
]
