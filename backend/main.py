"""
Court Simulator Backend
FastAPI application with WebSocket support for real-time courtroom simulation.
"""

import os
import json
import asyncio
import logging
from datetime import datetime
from typing import Optional, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

from services.judge_engine import JudgeEngine
from services.tts_provider import get_tts_provider, TTSProvider
from services.stt_provider import get_stt_provider, STTProvider
from services.case_ingestion import CaseIngestionService

load_dotenv()

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

class SessionConfig(BaseModel):
    proceeding_type: str  # 'appellate', 'moot', 'trial'
    user_role: str  # 'attorney', 'self-represented'
    judge_personality: str = 'strict'
    interruption_frequency: str = 'medium'


class SeedQuestionRequest(BaseModel):
    appellant_brief: str
    appellee_brief: str
    system_prompt: Optional[str] = None


class SynthesisRequest(BaseModel):
    transcript: str
    seed_questions: List[str]
    brief_summary: str
    asked_questions: List[str] = []
    system_prompt: Optional[str] = None


class TTSRequest(BaseModel):
    text: str
    voice: str = 'onyx'
    provider: str = 'openai'  # 'openai', 'elevenlabs', 'browser'


# -----------------------------------------------------------------------------
# App Setup
# -----------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown logic."""
    logger.info("Starting Court Simulator Backend...")
    logger.info(f"OpenAI API Key configured: {'Yes' if os.getenv('OPENAI_API_KEY') else 'No'}")
    yield
    logger.info("Shutting down Court Simulator Backend...")


app = FastAPI(
    title="Court Simulator API",
    description="Backend API for the Court Simulator with real-time judge interactions",
    version="1.0.0",
    lifespan=lifespan
)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -----------------------------------------------------------------------------
# Connection Manager for WebSocket
# -----------------------------------------------------------------------------

class ConnectionManager:
    """Manages WebSocket connections for courtroom sessions."""
    
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}
        self.session_data: dict[str, dict] = {}
    
    async def connect(self, session_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[session_id] = websocket
        # Only initialize session data if it doesn't exist (preserve across reconnects)
        if session_id not in self.session_data:
            self.session_data[session_id] = {
                'connected_at': datetime.now().isoformat(),
                'transcript': '',
                'questions_asked': [],
                'phase': 'OFF_RECORD'
            }
            logger.info(f"[WS] Session {session_id} connected (new session)")
        else:
            logger.info(f"[WS] Session {session_id} reconnected (phase: {self.session_data[session_id].get('phase', 'OFF_RECORD')})")
    
    def disconnect(self, session_id: str):
        if session_id in self.active_connections:
            del self.active_connections[session_id]
        # Don't delete session_data to allow reconnection with preserved state
        logger.info(f"[WS] Session {session_id} disconnected (session data preserved)")
    
    async def send_json(self, session_id: str, data: dict):
        if session_id in self.active_connections:
            await self.active_connections[session_id].send_json(data)
    
    async def broadcast(self, data: dict):
        for connection in self.active_connections.values():
            await connection.send_json(data)


manager = ConnectionManager()

# Global judge engine instance (persists across WebSocket connections)
# This ensures context is maintained per session even across reconnects
global_judge_engine = JudgeEngine()


# -----------------------------------------------------------------------------
# REST Endpoints
# -----------------------------------------------------------------------------

@app.get("/")
async def root():
    return {"message": "Court Simulator API", "status": "running"}


@app.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}


@app.post("/api/seed-questions")
async def generate_seed_questions(request: SeedQuestionRequest):
    """
    Generate initial seed questions from briefs.
    This is called after PDF upload to create the question bank.
    """
    try:
        engine = JudgeEngine()
        questions = await engine.generate_seed_questions(
            appellant_brief=request.appellant_brief,
            appellee_brief=request.appellee_brief,
            system_prompt=request.system_prompt
        )
        return {"questions": questions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/synthesize-question")
async def synthesize_question(request: SynthesisRequest):
    """
    Synthesize a real-time question based on transcript and seed questions.
    """
    try:
        engine = JudgeEngine()
        result = await engine.synthesize_question(
            transcript=request.transcript,
            seed_questions=request.seed_questions,
            brief_summary=request.brief_summary,
            asked_questions=request.asked_questions,
            system_prompt=request.system_prompt
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/tts")
async def text_to_speech(request: TTSRequest):
    """
    Convert text to speech using the specified provider.
    Returns audio data or a streaming response.
    """
    try:
        provider = get_tts_provider(request.provider)
        audio_data = await provider.synthesize(request.text, request.voice)
        return {"audio": audio_data, "format": provider.audio_format}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/upload-brief")
async def upload_brief(file: UploadFile = File(...), role: str = "appellant"):
    """
    Upload and process a PDF brief.
    """
    try:
        service = CaseIngestionService()
        content = await file.read()
        result = await service.process_pdf(content, role)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# -----------------------------------------------------------------------------
# WebSocket Endpoint
# -----------------------------------------------------------------------------

@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    """
    WebSocket endpoint for real-time courtroom simulation.
    
    Message types from client:
    - {"type": "config", "data": {...}} - Session configuration
    - {"type": "audio", "data": {"audio": "base64..."}} - Audio chunk for STT
    - {"type": "transcript", "data": {"text": "..."}} - Direct transcript (browser STT)
    - {"type": "phase_change", "data": {"phase": "..."}} - Simulation phase update
    
    Message types to client:
    - {"type": "judge_interrupt", "data": {"question": "...", "audio": "base64..."}}
    - {"type": "phase_update", "data": {"phase": "..."}}
    - {"type": "timer_update", "data": {"remaining": 120}}
    - {"type": "transcript_update", "data": {"text": "..."}} - STT result
    """
    await manager.connect(session_id, websocket)
    
    # Initialize services for this session
    stt_provider = get_stt_provider("openai")
    judge_engine = global_judge_engine  # Use global instance to persist context
    tts_provider = get_tts_provider("openai")
    
    interrupt_cooldown_seconds = 15  # Minimum seconds between interrupts

    try:
        while True:
            # Handle both JSON and binary messages
            message = await websocket.receive()
            
            if "text" in message:
                data = json.loads(message["text"])
                msg_type = data.get("type")
                payload = data.get("data", {})
                
                if msg_type == "config":
                    # Store session configuration WITHOUT changing the phase
                    # The frontend controls phase transitions; we just store config data
                    config = payload
                    current_phase = manager.session_data[session_id].get('phase', 'OFF_RECORD')
                    manager.session_data[session_id].update({
                        'config': config,
                        'seed_questions': config.get('seed_questions', []),
                        'brief_summary': config.get('brief_summary', '')
                    })
                    # Only log, don't send phase_update (frontend is source of truth for ritual phases)
                    logger.info(f"[WS] Session {session_id} config received (phase remains: {current_phase})")
                
                elif msg_type == "audio":
                    # Receive complete WebM audio file from frontend
                    import base64
                    audio_b64 = payload.get("audio", "")
                    if audio_b64:
                        audio_bytes = base64.b64decode(audio_b64)
                        
                        # Check if this is a valid WebM file
                        has_webm_header = len(audio_bytes) >= 4 and audio_bytes[:4] == b'\x1a\x45\xdf\xa3'
                        logger.debug("Audio received: %s bytes, has WebM header: %s", len(audio_bytes), has_webm_header)
                        
                        if has_webm_header:
                            # Transcribe immediately
                            logger.debug("Transcribing %s bytes...", len(audio_bytes))
                            transcript = await stt_provider.transcribe(audio_bytes, "webm")
                            
                            if transcript and transcript.strip():
                                logger.debug("Transcribed: %s...", transcript[:100])
                                # Append to rolling transcript
                                manager.session_data[session_id]['transcript'] += " " + transcript
                                
                                # Send transcript back to frontend
                                await manager.send_json(session_id, {
                                    "type": "transcript_update",
                                    "data": {"text": transcript}
                                })
                                
                                # Check for judge interruption
                                await check_and_trigger_interrupt(
                                    session_id, judge_engine, tts_provider,
                                    interrupt_cooldown_seconds
                                )
                        else:
                            logger.debug("Skipping chunk without WebM header")
                
                elif msg_type == "transcript":
                    # Direct transcript from browser STT
                    new_text = payload.get("text", "")
                    if new_text:
                        manager.session_data[session_id]['transcript'] += " " + new_text
                        
                        # Check for judge interruption
                        await check_and_trigger_interrupt(
                            session_id, judge_engine, tts_provider,
                            interrupt_cooldown_seconds
                        )
                
                elif msg_type == "phase_change":
                    new_phase = payload.get("phase")
                    # Ensure session data exists
                    if session_id not in manager.session_data:
                        manager.session_data[session_id] = {
                            'connected_at': datetime.now().isoformat(),
                            'transcript': '',
                            'questions_asked': [],
                            'phase': 'OFF_RECORD'
                        }
                    old_phase = manager.session_data[session_id].get('phase', 'OFF_RECORD')
                    logger.info("Session %s phase: %s -> %s", session_id, old_phase, new_phase)
                    manager.session_data[session_id]['phase'] = new_phase
                    await manager.send_json(session_id, {
                        "type": "phase_update",
                        "data": {"phase": new_phase}
                    })
                
                elif msg_type == "request_interrupt":
                    # Force an interruption check (for testing)
                    await trigger_judge_interrupt(session_id, judge_engine, tts_provider)
            
            elif "bytes" in message:
                # Binary audio data
                audio_bytes = message["bytes"]
                transcript = await stt_provider.transcribe(audio_bytes, "webm")
                
                if transcript:
                    manager.session_data[session_id]['transcript'] += " " + transcript
                    await manager.send_json(session_id, {
                        "type": "transcript_update",
                        "data": {"text": transcript}
                    })
    
    except WebSocketDisconnect:
        logger.info(f"[WS] Session {session_id} disconnected by client")
        manager.disconnect(session_id)
    except Exception as e:
        logger.error(f"[WS] Session {session_id} error: {e}", exc_info=True)
        manager.disconnect(session_id)


async def check_and_trigger_interrupt(
    session_id: str,
    judge_engine: JudgeEngine,
    tts_provider: TTSProvider,
    cooldown_seconds: int
):
    """Check if we should interrupt and trigger if appropriate."""
    session = manager.session_data.get(session_id, {})
    phase = session.get('phase', 'OFF_RECORD')
    
    logger.debug("Interrupt check - phase: %s", phase)
    
    if phase != 'PROCEEDING':
        logger.debug("Interrupt skipped - not in PROCEEDING phase")
        return
    
    # Cooldown: avoid interrupting too frequently
    last_interrupt = session.get('last_interrupt_time')
    if last_interrupt:
        elapsed = (datetime.now() - last_interrupt).total_seconds()
        if elapsed < cooldown_seconds:
            logger.debug("Interrupt skipped - cooldown (%.1fs remaining)", cooldown_seconds - elapsed)
            return
    
    # Get the latest transcript
    transcript = session.get('transcript', '')
    config = session.get('config', {})
    
    logger.debug("Interrupt transcript (%s chars): ...%s", len(transcript), (transcript[-100:] if transcript else 'EMPTY'))
    
    # Use the should_interrupt method that manages its own context and timing
    should_interrupt, question, reasoning = await judge_engine.should_interrupt(
        session_id=session_id,
        transcript=transcript,
        config=config
    )
    
    logger.debug("Interrupt result: should_interrupt=%s, reasoning=%s", should_interrupt, reasoning)
    
    if should_interrupt and question:
        logger.info("Interrupt triggering: %s...", question[:80])
        await trigger_judge_interrupt(session_id, judge_engine, tts_provider, question)
    else:
        logger.debug("No interrupt: %s", reasoning)


async def trigger_judge_interrupt(
    session_id: str,
    judge_engine: JudgeEngine,
    tts_provider: TTSProvider,
    question: Optional[str] = None
):
    """Trigger a judge interruption with TTS audio."""
    session = manager.session_data.get(session_id, {})
    
    # Generate question if not provided (forced interrupt request)
    if not question:
        should_interrupt, question, reasoning = await judge_engine.should_interrupt(
            session_id=session_id,
            transcript=session.get('transcript', ''),
            config=session.get('config', {})
        )
        
        if not question:
            # If still no question, use synthesize_question as fallback
            result = await judge_engine.synthesize_question(
                transcript=session.get('transcript', ''),
                seed_questions=[q.get('text', q) if isinstance(q, dict) else q 
                               for q in session.get('seed_questions', [])],
                brief_summary=session.get('brief_summary', ''),
                asked_questions=session.get('questions_asked', [])
            )
            question = result.get('question')
    
    if not question:
        return
    
    # Track asked questions
    if 'questions_asked' not in session:
        session['questions_asked'] = []
    session['questions_asked'].append(question)
    
    # Generate TTS audio using OpenAI with "onyx" voice (authoritative judge voice)
    try:
        audio_data = await tts_provider.synthesize(question, voice="onyx")
        audio_format = tts_provider.audio_format
        logger.info(f"[TTS] Generated audio for judge question")
    except Exception as e:
        logger.error(f"[TTS] Error generating audio: {e}")
        audio_data = None
        audio_format = None
    
    # Update cooldown so we don't interrupt again too soon
    if session_id in manager.session_data:
        manager.session_data[session_id]['last_interrupt_time'] = datetime.now()

    # Send interrupt to frontend
    await manager.send_json(session_id, {
        "type": "judge_interrupt",
        "data": {
            "question": question,
            "audio": audio_data,
            "audio_format": audio_format
        }
    })


# -----------------------------------------------------------------------------
# Run with: uvicorn main:app --reload --port 8000
# -----------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
