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
                    manager.session_data[session_id].update({
                        'config': payload,
                        'seed_questions': payload.get('seed_questions', []),
                        'brief_summary': payload.get('brief_summary', ''),
                        'custom_synthesis_prompt': payload.get('synthesis_prompt')
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
    
    last_interrupt = session.get('last_interrupt_time')
    custom_prompt = session.get('custom_synthesis_prompt')

    should, question, _ = await engine.should_interrupt(
        session_id, session.get('transcript', ''), session.get('config'),
        custom_system_prompt=custom_prompt
    )
    
    if should and question:
        session['questions_asked'].append(question)
        session['last_interrupt_time'] = datetime.now()
        audio = await tts.synthesize(question, voice="onyx")
        await manager.send_json(session_id, {
            "type": "judge_interrupt",
            "data": {"question": question, "audio": audio, "audio_format": tts.audio_format}
        })

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
