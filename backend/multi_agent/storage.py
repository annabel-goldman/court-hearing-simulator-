"""
Multi-Agent Storage

File I/O operations for loading and saving agent configurations.
Handles both default agents and custom user-created agents.
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from .models import Agent


class AgentStorage:
    """
    Handles file-based storage for agent configurations.
    
    Directory structure:
        data/
            defaults/       # Built-in agent definitions
                skeptical_judge.json
                clarifying_judge.json
                ...
            custom/         # User-created/modified agents
                my_agent_v1.json
                my_agent_v2.json
                ...
    """

    def __init__(self, base_path: Optional[Path] = None):
        """
        Initialize storage with paths.
        
        Args:
            base_path: Root path for data directory. Defaults to ./data relative to this file.
        """
        if base_path is None:
            base_path = Path(__file__).parent / "data"
        
        self.base_path = base_path
        self.defaults_path = base_path / "defaults"
        self.custom_path = base_path / "custom"
        
        # Ensure directories exist
        self.defaults_path.mkdir(parents=True, exist_ok=True)
        self.custom_path.mkdir(parents=True, exist_ok=True)

    # =========================================================================
    # Loading Agents
    # =========================================================================

    def get_default_agents(self) -> List[Agent]:
        """Load all default agent configurations."""
        agents = []
        for file_path in self.defaults_path.glob("*.json"):
            try:
                with open(file_path, "r") as f:
                    data = json.load(f)
                    agents.append(Agent.from_dict(data))
            except Exception as e:
                print(f"Error loading agent {file_path}: {e}")
        return agents

    def get_all_agents(self) -> List[Agent]:
        """
        Load all agents: defaults (with custom overrides) + new custom agents.
        
        Returns agents in this priority:
        1. Custom versions of default agents (latest version)
        2. Default agents (if no custom version)
        3. New custom agents (not based on defaults)
        
        Sets is_custom=True for agents that don't have a default version.
        """
        agents = []
        seen_ids = set()
        
        # First, load defaults (or their custom versions if they exist)
        for file_path in self.defaults_path.glob("*.json"):
            try:
                with open(file_path, "r") as f:
                    data = json.load(f)
                    agent_id = data.get("id")
                    # Check if there's a custom version
                    latest = self.get_agent_by_id(agent_id)
                    if latest:
                        latest.is_custom = False  # Has a default, not deletable
                        agents.append(latest)
                        seen_ids.add(agent_id)
                    else:
                        agent = Agent.from_dict(data)
                        agent.is_custom = False  # Is a default, not deletable
                        agents.append(agent)
                        seen_ids.add(agent_id)
            except Exception as e:
                print(f"Error loading agent {file_path}: {e}")
        
        # Then, load any custom agents that don't have a default version
        for file_path in self.custom_path.glob("*.json"):
            try:
                with open(file_path, "r") as f:
                    data = json.load(f)
                    agent_id = data.get("id")
                    # Extract base ID (remove _v1, _v2, etc.)
                    base_id = agent_id.rsplit("_v", 1)[0] if "_v" in str(file_path.name) else agent_id
                    if base_id not in seen_ids:
                        # This is a new custom agent, get the latest version
                        latest = self.get_agent_by_id(base_id)
                        if latest:
                            latest.is_custom = True  # No default, can be deleted
                            agents.append(latest)
                            seen_ids.add(base_id)
            except Exception as e:
                print(f"Error loading custom agent {file_path}: {e}")
        
        return agents

    def get_agent_by_id(self, agent_id: str) -> Optional[Agent]:
        """
        Get a specific agent by ID.
        
        Checks custom versions first (returns latest), then falls back to default.
        """
        # Check custom versions first
        custom_versions = self._get_custom_versions(agent_id)
        if custom_versions:
            latest = max(custom_versions, key=lambda x: x.get("version", 1))
            return Agent.from_dict(latest)
        
        # Fall back to default
        default_path = self.defaults_path / f"{agent_id}.json"
        if default_path.exists():
            with open(default_path, "r") as f:
                return Agent.from_dict(json.load(f))
        return None

    def get_original_agent(self, agent_id: str) -> Optional[Agent]:
        """Get the original default version of an agent (for reset functionality)."""
        default_path = self.defaults_path / f"{agent_id}.json"
        if default_path.exists():
            with open(default_path, "r") as f:
                return Agent.from_dict(json.load(f))
        return None

    def _get_custom_versions(self, agent_id: str) -> List[Dict]:
        """Get all custom versions of an agent."""
        versions = []
        pattern = f"{agent_id}_v*.json"
        for file_path in self.custom_path.glob(pattern):
            try:
                with open(file_path, "r") as f:
                    versions.append(json.load(f))
            except Exception as e:
                print(f"Error loading custom version {file_path}: {e}")
        return versions

    def get_agent_versions(self, agent_id: str) -> List[Dict]:
        """
        Get version history for an agent (for undo functionality).
        
        Returns list sorted by version (newest first), including default as version 0.
        """
        versions = self._get_custom_versions(agent_id)
        
        # Also include the original default as version 0
        default_path = self.defaults_path / f"{agent_id}.json"
        if default_path.exists():
            with open(default_path, "r") as f:
                original = json.load(f)
                original["version"] = 0
                original["is_default"] = True
                versions.append(original)
        
        return sorted(versions, key=lambda x: x.get("version", 0), reverse=True)

    # =========================================================================
    # Saving Agents
    # =========================================================================

    def save_agent_version(self, agent_data: Dict) -> Agent:
        """
        Save a new version of an existing agent (Write button).
        
        Increments version number and saves to custom folder.
        """
        agent_id = agent_data.get("id")
        if not agent_id:
            raise ValueError("Agent ID is required")
        
        # Get current max version
        existing_versions = self._get_custom_versions(agent_id)
        max_version = max((v.get("version", 0) for v in existing_versions), default=0)
        
        new_version = max_version + 1
        agent_data["version"] = new_version
        agent_data["created_at"] = datetime.now().isoformat()
        
        # Save to custom folder
        file_path = self.custom_path / f"{agent_id}_v{new_version}.json"
        with open(file_path, "w") as f:
            json.dump(agent_data, f, indent=2)
        
        return Agent.from_dict(agent_data)

    def create_new_agent(self, agent_data: Dict) -> Agent:
        """
        Create a completely new agent.
        
        Generates ID from name if not provided, ensures uniqueness.
        """
        agent_id = agent_data.get("id")
        if not agent_id:
            # Generate an ID from the name
            agent_id = agent_data.get("name", "agent").lower().replace(" ", "_")
            agent_data["id"] = agent_id
        
        # Check if ID already exists
        if self.get_agent_by_id(agent_id):
            # Append timestamp to make unique
            agent_id = f"{agent_id}_{int(datetime.now().timestamp())}"
            agent_data["id"] = agent_id
        
        agent_data["version"] = 1
        agent_data["created_at"] = datetime.now().isoformat()
        agent_data["is_custom"] = True  # New agents are always custom (deletable)
        
        # Save as first custom version
        file_path = self.custom_path / f"{agent_id}_v1.json"
        with open(file_path, "w") as f:
            json.dump(agent_data, f, indent=2)
        
        agent = Agent.from_dict(agent_data)
        agent.is_custom = True
        return agent

    # =========================================================================
    # Deleting Agents
    # =========================================================================

    def is_custom_agent(self, agent_id: str) -> bool:
        """Check if an agent is a custom agent (not a default)."""
        default_path = self.defaults_path / f"{agent_id}.json"
        return not default_path.exists()

    def delete_agent(self, agent_id: str) -> bool:
        """
        Delete a custom agent and all its versions.
        
        Returns True if deleted, False if agent is a default (cannot delete).
        Raises ValueError if agent doesn't exist.
        """
        # Check if it's a default agent (cannot delete)
        default_path = self.defaults_path / f"{agent_id}.json"
        if default_path.exists():
            return False  # Cannot delete default agents
        
        # Delete all custom versions
        deleted_any = False
        pattern = f"{agent_id}_v*.json"
        for file_path in self.custom_path.glob(pattern):
            try:
                file_path.unlink()
                deleted_any = True
            except Exception as e:
                print(f"Error deleting {file_path}: {e}")
        
        if not deleted_any:
            raise ValueError(f"Agent '{agent_id}' not found")
        
        return True

    def delete_custom_versions(self, agent_id: str) -> int:
        """
        Delete all custom versions of an agent (reset to default).
        
        Returns the number of versions deleted.
        """
        deleted_count = 0
        pattern = f"{agent_id}_v*.json"
        for file_path in self.custom_path.glob(pattern):
            try:
                file_path.unlink()
                deleted_count += 1
            except Exception as e:
                print(f"Error deleting {file_path}: {e}")
        return deleted_count


# Global instance for easy import
agent_storage = AgentStorage()
