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

    def get_default_agents(self) -> List[Agent]:
        """Load all default agent configurations."""
        return self.storage.get_default_agents()

    def get_all_agents(self) -> List[Agent]:
        """Load all agents: defaults (with custom overrides) + new custom agents."""
        return self.storage.get_all_agents()

    def get_agent_by_id(self, agent_id: str) -> Optional[Agent]:
        """Get a specific agent by ID."""
        return self.storage.get_agent_by_id(agent_id)

    def get_original_agent(self, agent_id: str) -> Optional[Agent]:
        """Get the original default version of an agent (for reset)."""
        return self.storage.get_original_agent(agent_id)

    def get_agent_versions(self, agent_id: str) -> List[Dict]:
        """Get version history for an agent (for undo functionality)."""
        return self.storage.get_agent_versions(agent_id)

    def save_agent_version(self, agent_data: Dict) -> Agent:
        """Save a new version of an agent (Write button)."""
        return self.storage.save_agent_version(agent_data)

    def create_new_agent(self, agent_data: Dict) -> Agent:
        """Create a completely new agent."""
        return self.storage.create_new_agent(agent_data)

    def is_custom_agent(self, agent_id: str) -> bool:
        """Check if an agent is a custom agent (not a default)."""
        return self.storage.is_custom_agent(agent_id)

    def delete_agent(self, agent_id: str) -> bool:
        """Delete a custom agent. Returns False for default agents."""
        return self.storage.delete_agent(agent_id)

    def delete_custom_versions(self, agent_id: str) -> int:
        """Delete all custom versions of an agent (reset to default)."""
        return self.storage.delete_custom_versions(agent_id)

    # =========================================================================
    # LLM Operations (delegated to llm)
    # =========================================================================

    async def generate_brief_summary(
        self,
        user_brief: str,
        opposing_brief: str,
    ) -> str:
        """Generate a summary of both briefs using OpenAI."""
        return await self.llm.generate_brief_summary(user_brief, opposing_brief)

    async def analyze_agent_question(
        self,
        agent: Agent,
        transcript: str,
        brief_summary: str,
        questions_already_asked: List[str] = [],
    ) -> Tuple[bool, Optional[str]]:
        """Determine if an agent should ask a question based on the current transcript."""
        return await self.llm.analyze_agent_question(
            agent=agent,
            transcript=transcript,
            brief_summary=brief_summary,
            questions_already_asked=questions_already_asked,
        )


# Global instance for easy import
multi_agent_service = MultiAgentService()
