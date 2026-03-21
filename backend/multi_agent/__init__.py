"""
Multi-Agent Simulation Module

Provides multi-agent brief analysis and real-time questioning
during oral argument practice.
"""

from .models import Agent
from .service import MultiAgentService, multi_agent_service

__all__ = [
    "Agent",
    "MultiAgentService",
    "multi_agent_service",
]
