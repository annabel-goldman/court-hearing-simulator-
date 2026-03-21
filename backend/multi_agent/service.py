"""
Multi-Agent Service

Main orchestration service that combines storage and LLM functionality.
This is the primary interface for the multi-agent system.
"""

from typing import Dict, List, Optional, Tuple

from .models import Agent
from .storage import agent_storage, AgentStorage
from .llm import multi_agent_llm, MultiAgentLLM


class MultiAgentService:
    """
    Main service for the multi-agent system.
    
    Provides a unified interface for:
    - Loading and saving agent configurations
    - Generating brief summaries
    - Analyzing transcripts for agent questions
    """

    def __init__(
        self,
        storage: Optional[AgentStorage] = None,
        llm: Optional[MultiAgentLLM] = None,
    ):
        """
        Initialize the service with storage and LLM components.
        
        Args:
            storage: Agent storage handler (defaults to global instance)
            llm: LLM service handler (defaults to global instance)
        """
        self.storage = storage or agent_storage
        self.llm = llm or multi_agent_llm

    # =========================================================================
    # Agent Management (delegated to storage)
    # =========================================================================

    def get_all_agents(self) -> List[Agent]:
        """Load all agents: defaults (with custom overrides) + new custom agents."""
        return self.storage.get_all_agents()

    def get_original_agent(self, agent_id: str) -> Optional[Agent]:
        """Get the original default version of an agent (for reset)."""
        return self.storage.get_original_agent(agent_id)

    def save_agent_version(self, agent_data: Dict) -> Agent:
        """Save a new version of an agent (Write button)."""
        return self.storage.save_agent_version(agent_data)

    def create_new_agent(self, agent_data: Dict) -> Agent:
        """Create a completely new agent."""
        return self.storage.create_new_agent(agent_data)

    def delete_agent(self, agent_id: str) -> bool:
        """Delete a custom agent. Returns False for default agents."""
        return self.storage.delete_agent(agent_id)

    # =========================================================================
    # LLM Operations (delegated to llm)
    # =========================================================================

    async def analyze_agent_question(
        self,
        agent: Agent,
        transcript: str,
        brief_summary: str,
        questions_already_asked: List[str] = [],
        trajectory_context: Optional[dict] = None,
    ) -> Tuple[bool, Optional[str]]:
        """Determine if an agent should ask a question based on the current transcript."""
        return await self.llm.analyze_agent_question(
            agent=agent,
            transcript=transcript,
            brief_summary=brief_summary,
            questions_already_asked=questions_already_asked,
            trajectory_context=trajectory_context,
        )


# Global instance for easy import
multi_agent_service = MultiAgentService()
