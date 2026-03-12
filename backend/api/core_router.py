"""Compatibility shim for legacy imports.

This module now re-exports the canonical handlers and models from the
new backend package layout:
- API routes: backend/api/routes/*
- WS routes: backend/api/ws/* (registration) + backend/domain/simulation/* (logic)
- DTOs: backend/schemas/*
"""

from api.router import router
from api.routes.config import (
    get_judge_config,
    get_default_judge_config_endpoint,
    save_judge_config_endpoint,
    get_opponent_config,
    get_default_opponent_config_endpoint,
    save_opponent_config_endpoint,
    get_tts_config_endpoint,
    get_default_tts_config_endpoint,
    save_tts_config_endpoint,
    get_tts_voices,
    get_stt_config_endpoint,
    get_default_stt_config_endpoint,
    save_stt_config_endpoint,
    get_model_config_endpoint,
    get_default_model_config_endpoint,
    save_model_config_endpoint,
)
from api.routes.multi_agent import (
    text_to_speech,
    get_agents,
    save_agent,
    create_new_agent,
    reset_agent,
    delete_agent,
    generate_judge_intro,
)
from domain.simulation.runtime import (
    manager,
    multi_agent_manager,
    global_judge_engine,
    global_opponent_engine,
    websocket_endpoint,
    multi_agent_websocket,
    check_and_trigger_interrupt,
    check_multi_agent_questions,
    check_tracker_and_counter,
)
from schemas.requests import (
    TTSRequest,
    JudgeIntroRequest,
    AgentConfig,
    RewardDimensionModel,
    ExternalLLMConfigModel,
    JudgeConfigRequest,
    OpponentConfigRequest,
    TTSConfigRequest,
    STTConfigRequest,
    TierConfigRequest,
    ModelRuntimeConfigRequest,
)

__all__ = [
    "router",
    "manager",
    "multi_agent_manager",
    "global_judge_engine",
    "global_opponent_engine",
    "websocket_endpoint",
    "multi_agent_websocket",
    "check_and_trigger_interrupt",
    "check_multi_agent_questions",
    "check_tracker_and_counter",
    "text_to_speech",
    "get_agents",
    "save_agent",
    "create_new_agent",
    "reset_agent",
    "delete_agent",
    "generate_judge_intro",
    "get_judge_config",
    "get_default_judge_config_endpoint",
    "save_judge_config_endpoint",
    "get_opponent_config",
    "get_default_opponent_config_endpoint",
    "save_opponent_config_endpoint",
    "get_tts_config_endpoint",
    "get_default_tts_config_endpoint",
    "save_tts_config_endpoint",
    "get_tts_voices",
    "get_stt_config_endpoint",
    "get_default_stt_config_endpoint",
    "save_stt_config_endpoint",
    "get_model_config_endpoint",
    "get_default_model_config_endpoint",
    "save_model_config_endpoint",
    "TTSRequest",
    "JudgeIntroRequest",
    "AgentConfig",
    "RewardDimensionModel",
    "ExternalLLMConfigModel",
    "JudgeConfigRequest",
    "OpponentConfigRequest",
    "TTSConfigRequest",
    "STTConfigRequest",
    "TierConfigRequest",
    "ModelRuntimeConfigRequest",
]
