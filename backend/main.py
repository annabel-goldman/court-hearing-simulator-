"""
Court Simulator Backend - Streamlined OpenAI Version
"""

import os
import json
import logging
import base64
from datetime import datetime
from typing import Optional, List, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# Load environment variables from the root .env file
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env"))

from services.judge_engine import JudgeEngine
from services.tts_provider import get_tts_provider
from services.stt_provider import get_stt_provider
from services.case_ingestion import CaseIngestionService
from multi_agent import multi_agent_service, Agent

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger('court-simulator')

# -----------------------------------------------------------------------------
# Models
# -----------------------------------------------------------------------------

class SeedQuestionRequest(BaseModel):
    appellant_brief: str
    appellee_brief: str
    system_prompt: Optional[str] = None

class SynthesisRequest(BaseModel):
    transcript: str
    seed_questions: List[dict]
    brief_summary: str
    asked_questions: List[str] = []
    system_prompt: Optional[str] = None

class SummarizeRequest(BaseModel):
    appellant_brief: str
    appellee_brief: str
    system_prompt: Optional[str] = None

class TTSRequest(BaseModel):
    text: str
    voice: str = 'onyx'

# Multi-Agent Models
class MultiAgentSummarizeRequest(BaseModel):
    user_brief: str
    opposing_brief: str

class AgentConfig(BaseModel):
    id: Optional[str] = None
    name: str
    color: str
    description: str
    triggers: List[str]
    example_questions: List[str]
    extra_prompt: str
    version: Optional[int] = None

# -----------------------------------------------------------------------------
# App Setup
# -----------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Court Simulator Backend...")
    logger.info(f"OpenAI API Key configured: {'Yes' if os.getenv('OPENAI_API_KEY') else 'No'}")
    yield

app = FastAPI(title="Court Simulator API", lifespan=lifespan)

_cors_origins = ["http://localhost:3000", "http://localhost:5173"]
if os.getenv("CORS_ORIGINS"):
    _cors_origins.extend(o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip())

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -----------------------------------------------------------------------------
# Connection Manager
# -----------------------------------------------------------------------------

class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}
        self.session_data: dict[str, dict] = {}
    
    async def connect(self, session_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[session_id] = websocket
        if session_id not in self.session_data:
            self.session_data[session_id] = {
                'transcript': '',
                'questions_asked': [],
                'phase': 'OFF_RECORD',
                'multi_agent': {
                    'enabled': False,
                    'strategy': 'round_robin',
                    'agents': [],
                    'next_agent_index': 0,
                    'max_agents_per_pass': 2,
                }
            }
    
    def disconnect(self, session_id: str):
        if session_id in self.active_connections:
            del self.active_connections[session_id]

    async def send_json(self, session_id: str, data: dict):
        if session_id in self.active_connections:
            await self.active_connections[session_id].send_json(data)

manager = ConnectionManager()
global_judge_engine = JudgeEngine()


def _extract_question_text(question_entry: Any) -> str:
    """Normalize question entries that may be plain strings or dict payloads."""
    if isinstance(question_entry, str):
        return question_entry
    if isinstance(question_entry, dict):
        if isinstance(question_entry.get("question"), str):
            return question_entry["question"]
        if isinstance(question_entry.get("text"), str):
            return question_entry["text"]
    return ""


def _extract_seed_question_text(seed_entry: Any) -> str:
    """Normalize seed question entries that may be strings or dict payloads."""
    if isinstance(seed_entry, str):
        return seed_entry
    if isinstance(seed_entry, dict):
        if isinstance(seed_entry.get("question"), str):
            return seed_entry["question"]
        if isinstance(seed_entry.get("text"), str):
            return seed_entry["text"]
    return ""


def _normalize_multi_agent_config(raw_config: Any) -> dict:
    """Parse optional multi-agent config for the main courtroom socket."""
    if not isinstance(raw_config, dict):
        return {
            "enabled": False,
            "strategy": "round_robin",
            "agents": [],
            "next_agent_index": 0,
            "max_agents_per_pass": 2,
        }

    enabled = bool(raw_config.get("enabled"))
    strategy = str(raw_config.get("strategy", "round_robin"))
    try:
        max_agents_per_pass = int(raw_config.get("max_agents_per_pass", 2))
    except (TypeError, ValueError):
        max_agents_per_pass = 2
    max_agents_per_pass = min(max(max_agents_per_pass, 1), 5)

    agents: List[Agent] = []
    raw_agents = raw_config.get("agents") or []
    for agent_data in raw_agents:
        if isinstance(agent_data, dict):
            agents.append(Agent.from_dict(agent_data))

    if enabled and not agents:
        try:
            agents = multi_agent_service.get_all_agents()
        except Exception as exc:
            logger.error(f"[Orchestrator] Failed to load default agents: {exc}")

    return {
        "enabled": enabled and len(agents) > 0,
        "strategy": strategy,
        "agents": agents,
        "next_agent_index": 0,
        "max_agents_per_pass": max_agents_per_pass,
    }

# -----------------------------------------------------------------------------
# REST Endpoints
# -----------------------------------------------------------------------------

@app.post("/api/seed-questions")
async def generate_seed_questions(request: SeedQuestionRequest):
    try:
        questions = await global_judge_engine.generate_seed_questions(
            appellant_brief=request.appellant_brief,
            appellee_brief=request.appellee_brief,
            system_prompt=request.system_prompt
        )
        return {"questions": questions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/summarize-briefs")
async def summarize_briefs(request: SummarizeRequest):
    try:
        summary = await global_judge_engine.summarize_briefs(
            appellant_text=request.appellant_brief,
            appellee_text=request.appellee_brief,
            system_prompt=request.system_prompt
        )
        return {"summary": summary}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/synthesize-question")
async def synthesize_question(request: SynthesisRequest):
    try:
        # Pass seed questions as text list for synthesis
        seed_texts = [q.get('text', str(q)) if isinstance(q, dict) else str(q) for q in request.seed_questions]
        result = await global_judge_engine.synthesize_question(
            transcript=request.transcript,
            seed_questions=seed_texts,
            brief_summary=request.brief_summary,
            asked_questions=request.asked_questions,
            system_prompt=request.system_prompt
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/tts")
async def text_to_speech(request: TTSRequest):
    try:
        provider = get_tts_provider()
        audio_data = await provider.synthesize(request.text, request.voice)
        if not audio_data:
            raise HTTPException(status_code=502, detail="TTS returned empty audio payload")
        return {"audio": audio_data, "format": provider.audio_format}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"TTS synthesis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/upload-brief")
async def upload_brief(file: UploadFile = File(...), role: str = "appellant"):
    try:
        service = CaseIngestionService()
        content = await file.read()
        return await service.process_pdf(content, role)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# -----------------------------------------------------------------------------
# Multi-Agent REST Endpoints
# -----------------------------------------------------------------------------

@app.get("/api/multi-agent/agents")
async def get_agents():
    """Get all available agents (defaults + custom versions + new custom agents)."""
    try:
        all_agents = multi_agent_service.get_all_agents()
        agents_data = [agent.to_dict() for agent in all_agents]
        return {"agents": agents_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/multi-agent/agents")
async def save_agent(agent: AgentConfig):
    """Save a new version of an agent (Write button)."""
    try:
        saved_agent = multi_agent_service.save_agent_version(agent.model_dump())
        return {"agent": saved_agent.to_dict()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/multi-agent/agents/new")
async def create_new_agent(agent: AgentConfig):
    """Create a completely new agent."""
    try:
        new_agent = multi_agent_service.create_new_agent(agent.model_dump())
        return {"agent": new_agent.to_dict()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/multi-agent/agents/{agent_id}/versions")
async def get_agent_versions(agent_id: str):
    """Get version history for an agent (for Undo functionality)."""
    try:
        versions = multi_agent_service.get_agent_versions(agent_id)
        return {"versions": versions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/multi-agent/agents/{agent_id}/reset")
async def reset_agent(agent_id: str):
    """Get the original default version of an agent (Reset button)."""
    try:
        original = multi_agent_service.get_original_agent(agent_id)
        if not original:
            raise HTTPException(status_code=404, detail=f"Agent {agent_id} not found")
        return {"agent": original.to_dict()}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/multi-agent/agents/{agent_id}")
async def delete_agent(agent_id: str):
    """Delete a custom agent (cannot delete default agents)."""
    try:
        deleted = multi_agent_service.delete_agent(agent_id)
        if not deleted:
            raise HTTPException(
                status_code=400, 
                detail=f"Cannot delete default agent '{agent_id}'. Use Reset instead."
            )
        return {"success": True, "message": f"Agent '{agent_id}' deleted"}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/multi-agent/summarize")
async def multi_agent_summarize(request: MultiAgentSummarizeRequest):
    """Generate a summary of both briefs for multi-agent simulation."""
    try:
        summary = await multi_agent_service.generate_brief_summary(
            user_brief=request.user_brief,
            opposing_brief=request.opposing_brief
        )
        return {"summary": summary}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# -----------------------------------------------------------------------------
# Multi-Agent Connection Manager
# -----------------------------------------------------------------------------

class MultiAgentConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}
        self.session_data: dict[str, dict] = {}
    
    async def connect(self, session_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[session_id] = websocket
        if session_id not in self.session_data:
            self.session_data[session_id] = {
                'transcript': '',
                'questions_asked': [],  # List of {agent_id, agent_name, question, color}
                'agents': [],
                'brief_summary': '',
                'phase': 'SETUP'
            }
    
    def disconnect(self, session_id: str):
        if session_id in self.active_connections:
            del self.active_connections[session_id]
        if session_id in self.session_data:
            del self.session_data[session_id]

    async def send_json(self, session_id: str, data: dict):
        if session_id in self.active_connections:
            await self.active_connections[session_id].send_json(data)

multi_agent_manager = MultiAgentConnectionManager()

# -----------------------------------------------------------------------------
# WebSocket
# -----------------------------------------------------------------------------

@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await manager.connect(session_id, websocket)
    stt_provider = get_stt_provider()
    tts_provider = get_tts_provider()
    
    try:
        while True:
            message = await websocket.receive()
            if "text" in message:
                data = json.loads(message["text"])
                msg_type, payload = data.get("type"), data.get("data", {})
                
                if msg_type == "config":
                    custom_synthesis = payload.get('synthesis_prompt')
                    multi_agent_config = _normalize_multi_agent_config(payload.get('multi_agent'))
                    if custom_synthesis:
                        preview = (custom_synthesis[:150] + '...') if len(custom_synthesis) > 150 else custom_synthesis
                        logger.info(f"[Judge] Session {session_id}: using CUSTOM synthesis prompt. Preview: {preview.replace(chr(10), ' ')}")
                    else:
                        logger.info(f"[Judge] Session {session_id}: no custom synthesis prompt; using default system prompt")
                    if multi_agent_config["enabled"]:
                        logger.info(
                            f"[Orchestrator] Session {session_id}: enabled {multi_agent_config['strategy']} "
                            f"with {len(multi_agent_config['agents'])} agents"
                        )
                    else:
                        logger.info(f"[Orchestrator] Session {session_id}: multi-agent disabled")
                    manager.session_data[session_id].update({
                        'config': payload,
                        'seed_questions': payload.get('seed_questions', []),
                        'brief_summary': payload.get('brief_summary', ''),
                        'custom_synthesis_prompt': custom_synthesis,
                        'multi_agent': multi_agent_config,
                    })
                
                elif msg_type == "audio":
                    audio_bytes = base64.b64decode(payload.get("audio", ""))
                    if audio_bytes and audio_bytes[:4] == b'\x1a\x45\xdf\xa3':
                        transcript = await stt_provider.transcribe(audio_bytes, "webm")
                        if transcript.strip():
                            manager.session_data[session_id]['transcript'] += " " + transcript
                            await manager.send_json(session_id, {
                                "type": "transcript_update",
                                "data": {"text": transcript}
                            })
                            await check_and_trigger_interrupt(session_id, global_judge_engine, tts_provider)
                
                elif msg_type == "phase_change":
                    manager.session_data[session_id]['phase'] = payload.get("phase")
                    await manager.send_json(session_id, {
                        "type": "phase_update",
                        "data": {"phase": payload.get("phase")}
                    })

                elif msg_type == "silence_timeout":
                    await trigger_silence_interrupt(session_id, global_judge_engine, tts_provider)
    except WebSocketDisconnect:
        manager.disconnect(session_id)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(session_id)

async def check_and_trigger_interrupt(session_id, engine, tts):
    session = manager.session_data.get(session_id, {})
    if session.get('phase') != 'PROCEEDING': return

    multi_agent_config = session.get("multi_agent") or {}
    if multi_agent_config.get("enabled"):
        await check_and_trigger_multi_agent_interrupt(
            session_id=session_id,
            session=session,
            tts=tts,
            engine=engine,
        )
        return

    custom_prompt = session.get('custom_synthesis_prompt')
    if custom_prompt:
        logger.info(f"[Judge] Interrupt check: using custom synthesis prompt (len={len(custom_prompt)})")
    else:
        logger.info("[Judge] Interrupt check: using default system prompt")
    brief_summary = (session.get('brief_summary') or '').strip()
    seed_questions = session.get('seed_questions') or []
    asked_questions = session.get('questions_asked') or []

    should, question, _ = await engine.should_interrupt(
        session_id,
        session.get('transcript', ''),
        session.get('config'),
        custom_system_prompt=custom_prompt,
        brief_summary=brief_summary if brief_summary else None,
        seed_questions=seed_questions if seed_questions else None,
        asked_questions=asked_questions if asked_questions else None,
    )
    
    if should and question:
        source = {"type": "judge_engine", "strategy": "single_judge"}
        session['questions_asked'].append({
            "question": question,
            "source": source,
            "timestamp": datetime.now().isoformat(),
        })
        session['last_interrupt_time'] = datetime.now()
        audio = await tts.synthesize(question, voice="onyx")
        await manager.send_json(session_id, {
            "type": "judge_interrupt",
            "data": {
                "question": question,
                "audio": audio,
                "audio_format": tts.audio_format,
                "source": source,
            }
        })


async def trigger_silence_interrupt(session_id: str, engine: JudgeEngine, tts) -> None:
    """Force a judge question after a frontend-reported silence window."""
    session = manager.session_data.get(session_id, {})
    if session.get("phase") != "PROCEEDING":
        return

    transcript = session.get("transcript", "")
    brief_summary = (session.get("brief_summary") or "").strip()
    asked_entries = session.get("questions_asked") or []
    asked_questions = [text for text in (_extract_question_text(entry) for entry in asked_entries) if text]
    seed_entries = session.get("seed_questions") or []
    seed_questions = [text for text in (_extract_seed_question_text(entry) for entry in seed_entries) if text]
    custom_prompt = session.get("custom_synthesis_prompt")

    question: Optional[str] = None
    try:
        synthesized = await engine.synthesize_question(
            transcript=transcript,
            seed_questions=seed_questions,
            brief_summary=brief_summary,
            asked_questions=asked_questions,
            system_prompt=custom_prompt,
        )
        if isinstance(synthesized, dict):
            candidate = synthesized.get("question")
            if isinstance(candidate, str) and candidate.strip():
                question = candidate.strip()
    except Exception as exc:
        logger.error(f"[Judge] Silence-trigger synthesis failed for session {session_id}: {exc}")

    if not question:
        question = "Counsel, you've paused. What is your strongest legal point right now?"

    source = {"type": "judge_engine", "strategy": "silence_trigger"}
    session["questions_asked"].append({
        "question": question,
        "source": source,
        "timestamp": datetime.now().isoformat(),
    })
    session["last_interrupt_time"] = datetime.now()

    # Keep the judge context in sync so follow-up questions can avoid repetition.
    engine.get_or_create_context(session_id, session.get("config")).add_judge_question(
        question=question,
        reasoning="Forced silence-trigger interruption.",
        topic="silence",
    )

    audio = await tts.synthesize(question, voice="onyx")
    await manager.send_json(session_id, {
        "type": "judge_interrupt",
        "data": {
            "question": question,
            "audio": audio,
            "audio_format": tts.audio_format,
            "source": source,
        }
    })


async def check_and_trigger_multi_agent_interrupt(session_id: str, session: dict, tts, engine: JudgeEngine):
    """Orchestrate one judge interruption from the multi-agent ensemble."""
    multi_agent_config = session.get("multi_agent") or {}
    agents: List[Agent] = multi_agent_config.get("agents") or []
    if not agents:
        return

    transcript = session.get("transcript", "")
    if len(transcript.strip().split()) < 10:
        return

    last_interrupt_time: Optional[datetime] = session.get("last_interrupt_time")
    if last_interrupt_time:
        elapsed_seconds = (datetime.now() - last_interrupt_time).total_seconds()
        if elapsed_seconds < engine.min_seconds_between:
            return

    questions_asked = session.get("questions_asked", [])
    asked_texts = [text for text in (_extract_question_text(entry) for entry in questions_asked) if text]
    brief_summary = session.get("brief_summary", "")

    strategy = str(multi_agent_config.get("strategy", "round_robin"))
    try:
        next_agent_index = int(multi_agent_config.get("next_agent_index", 0))
    except (TypeError, ValueError):
        next_agent_index = 0
    try:
        max_agents_per_pass = int(multi_agent_config.get("max_agents_per_pass", 2))
    except (TypeError, ValueError):
        max_agents_per_pass = 2
    max_agents_per_pass = min(max(max_agents_per_pass, 1), len(agents))

    selected_agent: Optional[Agent] = None
    selected_question: Optional[str] = None
    total_agents = len(agents)

    for checked_count in range(max_agents_per_pass):
        agent_index = (next_agent_index + checked_count) % total_agents
        agent = agents[agent_index]
        try:
            should_ask, question = await multi_agent_service.analyze_agent_question(
                agent=agent,
                transcript=transcript,
                brief_summary=brief_summary,
                questions_already_asked=asked_texts,
            )
        except Exception as exc:
            logger.error(f"[Orchestrator] Agent check failed for {agent.name}: {exc}")
            should_ask, question = False, None

        if should_ask and question:
            selected_agent = agent
            selected_question = question
            multi_agent_config["next_agent_index"] = (agent_index + 1) % total_agents
            break

    if not selected_agent or not selected_question:
        multi_agent_config["next_agent_index"] = (next_agent_index + max_agents_per_pass) % total_agents
        return

    source = {
        "type": "multi_agent",
        "agent_id": selected_agent.id,
        "agent_name": selected_agent.name,
        "agent_color": selected_agent.color,
        "strategy": strategy,
    }
    session["questions_asked"].append({
        "question": selected_question,
        "source": source,
        "timestamp": datetime.now().isoformat(),
    })
    session["last_interrupt_time"] = datetime.now()

    audio = await tts.synthesize(selected_question, voice="onyx")
    await manager.send_json(session_id, {
        "type": "judge_interrupt",
        "data": {
            "question": selected_question,
            "audio": audio,
            "audio_format": tts.audio_format,
            "source": source,
        }
    })
    logger.info(
        f"[Orchestrator] Session {session_id}: {selected_agent.name} asked -> {selected_question[:80]}..."
    )

# -----------------------------------------------------------------------------
# Multi-Agent WebSocket
# -----------------------------------------------------------------------------

@app.websocket("/ws/multi-agent/{session_id}")
async def multi_agent_websocket(websocket: WebSocket, session_id: str):
    """WebSocket endpoint for multi-agent simulation."""
    await multi_agent_manager.connect(session_id, websocket)
    stt_provider = get_stt_provider()
    
    try:
        while True:
            message = await websocket.receive()
            if "text" in message:
                data = json.loads(message["text"])
                msg_type, payload = data.get("type"), data.get("data", {})
                
                if msg_type == "config":
                    # Initialize session with agents and brief summary
                    agents_data = payload.get('agents', [])
                    agents = [Agent.from_dict(a) for a in agents_data]
                    multi_agent_manager.session_data[session_id].update({
                        'agents': agents,
                        'brief_summary': payload.get('brief_summary', ''),
                        'phase': 'READY'
                    })
                    await multi_agent_manager.send_json(session_id, {
                        "type": "config_ack",
                        "data": {"status": "ready", "agent_count": len(agents)}
                    })
                
                elif msg_type == "audio":
                    audio_bytes = base64.b64decode(payload.get("audio", ""))
                    if audio_bytes and audio_bytes[:4] == b'\x1a\x45\xdf\xa3':
                        transcript = await stt_provider.transcribe(audio_bytes, "webm")
                        if transcript.strip():
                            multi_agent_manager.session_data[session_id]['transcript'] += " " + transcript
                            await multi_agent_manager.send_json(session_id, {
                                "type": "transcript_update",
                                "data": {"text": transcript}
                            })
                            # Check each agent for potential questions
                            await check_multi_agent_questions(session_id)
                
                elif msg_type == "phase_change":
                    new_phase = payload.get("phase")
                    multi_agent_manager.session_data[session_id]['phase'] = new_phase
                    await multi_agent_manager.send_json(session_id, {
                        "type": "phase_update",
                        "data": {"phase": new_phase}
                    })
                
                elif msg_type == "update_agents":
                    # Allow updating agents mid-session
                    agents_data = payload.get('agents', [])
                    agents = [Agent.from_dict(a) for a in agents_data]
                    multi_agent_manager.session_data[session_id]['agents'] = agents
                    await multi_agent_manager.send_json(session_id, {
                        "type": "agents_updated",
                        "data": {"agent_count": len(agents)}
                    })

    except WebSocketDisconnect:
        multi_agent_manager.disconnect(session_id)
    except Exception as e:
        logger.error(f"Multi-agent WebSocket error: {e}")
        multi_agent_manager.disconnect(session_id)


async def check_multi_agent_questions(session_id: str):
    """Check each agent to see if they want to ask a question."""
    session = multi_agent_manager.session_data.get(session_id, {})
    if session.get('phase') != 'RECORDING':
        return
    
    agents = session.get('agents', [])
    transcript = session.get('transcript', '')
    brief_summary = session.get('brief_summary', '')
    questions_asked = session.get('questions_asked', [])
    
    # Extract just the question text for deduplication
    asked_texts = [q.get('question', '') for q in questions_asked]
    
    for agent in agents:
        try:
            should_ask, question = await multi_agent_service.analyze_agent_question(
                agent=agent,
                transcript=transcript,
                brief_summary=brief_summary,
                questions_already_asked=asked_texts
            )
            
            if should_ask and question:
                question_data = {
                    "agent_id": agent.id,
                    "agent_name": agent.name,
                    "color": agent.color,
                    "question": question,
                    "timestamp": datetime.now().isoformat()
                }
                session['questions_asked'].append(question_data)
                
                await multi_agent_manager.send_json(session_id, {
                    "type": "agent_question",
                    "data": question_data
                })
                
                logger.info(f"[MultiAgent] {agent.name} asked: {question[:50]}...")
                
        except Exception as e:
            logger.error(f"Error checking agent {agent.name}: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
