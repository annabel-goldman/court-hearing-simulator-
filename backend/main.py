"""
Court Simulator Backend - Streamlined OpenAI Version
"""

import os
import json
import logging
import base64
from datetime import datetime
from typing import Optional, List
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
                'phase': 'OFF_RECORD'
            }
    
    def disconnect(self, session_id: str):
        if session_id in self.active_connections:
            del self.active_connections[session_id]

    async def send_json(self, session_id: str, data: dict):
        if session_id in self.active_connections:
            await self.active_connections[session_id].send_json(data)

manager = ConnectionManager()
global_judge_engine = JudgeEngine()

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
        return {"audio": audio_data, "format": provider.audio_format}
    except Exception as e:
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
                    if custom_synthesis:
                        preview = (custom_synthesis[:150] + '...') if len(custom_synthesis) > 150 else custom_synthesis
                        logger.info(f"[Judge] Session {session_id}: using CUSTOM synthesis prompt. Preview: {preview.replace(chr(10), ' ')}")
                    else:
                        logger.info(f"[Judge] Session {session_id}: no custom synthesis prompt; using default system prompt")
                    manager.session_data[session_id].update({
                        'config': payload,
                        'seed_questions': payload.get('seed_questions', []),
                        'brief_summary': payload.get('brief_summary', ''),
                        'custom_synthesis_prompt': custom_synthesis
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
    except WebSocketDisconnect:
        manager.disconnect(session_id)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(session_id)

async def check_and_trigger_interrupt(session_id, engine, tts):
    session = manager.session_data.get(session_id, {})
    if session.get('phase') != 'PROCEEDING': return

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
        session['questions_asked'].append(question)
        session['last_interrupt_time'] = datetime.now()
        audio = await tts.synthesize(question, voice="onyx")
        await manager.send_json(session_id, {
            "type": "judge_interrupt",
            "data": {"question": question, "audio": audio, "audio_format": tts.audio_format}
        })

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
