"""
Multi-Agent Models

Data structures for agent configurations.
"""

from dataclasses import dataclass, asdict
from typing import Dict, List, Optional


@dataclass
class Agent:
    """Represents an agent configuration."""
    id: str
    name: str
    color: str
    description: str
    triggers: List[str]
    example_questions: List[str]
    extra_prompt: str
    version: int = 1
    created_at: Optional[str] = None

    def to_dict(self) -> Dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict) -> "Agent":
        return cls(
            id=data.get("id", ""),
            name=data.get("name", ""),
            color=data.get("color", "#000000"),
            description=data.get("description", ""),
            triggers=data.get("triggers", []),
            example_questions=data.get("example_questions", []),
            extra_prompt=data.get("extra_prompt", ""),
            version=data.get("version", 1),
            created_at=data.get("created_at"),
        )
