"""Shared request DTOs for backend API contracts."""

from typing import Optional, List

from pydantic import BaseModel

# -----------------------------------------------------------------------------
# Models
# -----------------------------------------------------------------------------

class TTSRequest(BaseModel):
    text: str
    voice: str = 'onyx'

class JudgeIntroRequest(BaseModel):
    case_summary: str
    agenda_topics: List[str] = []
    voice: str = "onyx"

class AgentConfig(BaseModel):
    id: Optional[str] = None
    name: str
    color: str
    description: str
    triggers: List[str]
    example_questions: List[str]
    extra_prompt: str
    version: Optional[int] = None

class RewardDimensionModel(BaseModel):
    name: str
    weight: float
    description: str

class ExternalLLMConfigModel(BaseModel):
    enabled: bool = False
    base_url: str = ""
    api_key: str = ""
    model: str = ""
    tier_override: str = "LARGE"

class JudgeConfigRequest(BaseModel):
    judge_prompt: str
    scoring_prompt_template: str
    reward_dimensions: List[RewardDimensionModel]
    external_llm: ExternalLLMConfigModel = ExternalLLMConfigModel()

class OpponentConfigRequest(BaseModel):
    system_prompt: str
    aggressiveness: float = 0.7
    enabled_types: List[str] = ["rebuttal", "exploitation", "affirmative"]
    voice_id: str = ""

class TTSConfigRequest(BaseModel):
    enabled: bool = True
    api_key: str = ""
    base_url: str = ""
    voice: str = "onyx"
    model: str = "tts-1"

class STTConfigRequest(BaseModel):
    provider: str = "openai"
    api_key: str = ""
    base_url: str = ""
    model: str = ""  # whisper model for cloud (e.g. whisper-large-v3-turbo for Groq)
    whisper_model: str = "medium"
    device: str = "cuda"
    compute_type: str = "float16"

class TierConfigRequest(BaseModel):
    enabled: bool = False
    base_url: str = ""
    api_key: str = ""
    model: str = ""

class ModelRuntimeConfigRequest(BaseModel):
    large: TierConfigRequest = TierConfigRequest()
    small: TierConfigRequest = TierConfigRequest()
    tiny:  TierConfigRequest = TierConfigRequest()

