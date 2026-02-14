# Court Simulator Architecture

This document explains how each file in the codebase works together, the separation of concerns, and the frontend-backend communication flow.

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React)                               │
│                                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                      │
│  │   Home.tsx  │───▶│  Avatar.tsx │───▶│ CourtroomScene │                   │
│  │ (PDF Upload)│    │(Orchestrator)│    │   (3D World)   │                   │
│  └─────────────┘    └──────┬──────┘    └───────────────┘                    │
│                            │                                                 │
│                            ▼                                                 │
│                   ┌────────────────────┐                                     │
│                   │useSimulationSocket │                                     │
│                   │   (WebSocket Hook) │                                     │
│                   └─────────┬──────────┘                                     │
└─────────────────────────────┼───────────────────────────────────────────────┘
                              │ WebSocket (ws://localhost:8000/ws/{session_id})
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND (FastAPI)                              │
│                                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                      │
│  │  main.py    │───▶│JudgeEngine  │    │ STTProvider │                      │
│  │ (WebSocket) │    │   (GPT-4)   │    │  (Whisper)  │                      │
│  └─────────────┘    └─────────────┘    └─────────────┘                      │
│         │                                                                    │
│         └──────────────────┬─────────────────────────────────────────────────┤
│                            ▼                                                 │
│                   ┌─────────────────┐                                        │
│                   │   TTSProvider   │                                        │
│                   │   (OpenAI TTS)  │                                        │
│                   └─────────────────┘                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Frontend Architecture

### Entry Point

| File | Purpose |
|------|---------|
| `main.tsx` | React entry point. Mounts the `<App />` component. |
| `App.tsx` | Sets up routing and wraps everything in `<AuthGate>` for password protection. |

### Pages (Routes)

| File | Route | Purpose |
|------|-------|---------|
| `pages/Home.tsx` | `/` | PDF upload interface. Extracts text from briefs using PDF.js and stores in `sessionStorage`. |
| `pages/Avatar.tsx` | `/courtroom` | **Main orchestrator**. Manages the simulation loop, audio recording, WebSocket communication, and renders the 3D scene. |
| `pages/JudgeAdmin.tsx` | `/admin/judge` | Admin tool for testing judge prompts via backend API. |

### Components

#### Courtroom (3D)

| File | Purpose |
|------|---------|
| `components/courtroom/CourtroomScene.tsx` | The `<Canvas>` wrapper. Sets up lighting, fog, camera, and renders the 3D courtroom + avatars. |
| `components/courtroom/Courtroom.tsx` | The 3D courtroom model (benches, walls, floor, chairs, tables). |
| `components/courtroom/AvatarModel.tsx` | Loads Ready Player Me avatars and applies lipsync/sitting poses. |
| `components/courtroom/types.ts` | Shared TypeScript types (`SimulationPhase`, `SpeakingRole`, etc.). |

#### Overlays (2D UI)

| File | Purpose |
|------|---------|
| `components/overlays/RitualOverlay.tsx` | Full-screen overlay for ritual phases (All Rise, Judge Seated, Adjourned). Prompts user to click to advance. |
| `components/overlays/JudgeQuestionOverlay.tsx` | Displays the judge's current question as a subtitle. |
| `components/overlays/CourtroomHUD.tsx` | Heads-up display: self-preview video, timer, transcript feedback, connection status, end session button. |

#### Other

| File | Purpose |
|------|---------|
| `components/AuthGate.tsx` | Password gate. Currently uses a hardcoded hash (to be moved to backend). |

### Hooks

| File | Purpose |
|------|---------|
| `hooks/useSimulationSocket.ts` | **Core communication hook**. Manages the WebSocket connection to the backend. Exposes `sendAudio`, `sendConfig`, `changePhase`, and handles incoming `judge_interrupt` and `transcript_update` messages. Also includes `useAudioPlayer` for playing TTS audio via Web Audio API. |

### Config

| File | Purpose |
|------|---------|
| `config/scenePresets.ts` | Configuration for 3D scene layout (camera position, avatar positions, bench dimensions). |

---

## Backend Architecture

### Entry Point

| File | Purpose |
|------|---------|
| `main.py` | FastAPI application. Defines REST endpoints and the WebSocket handler. Orchestrates STT, Judge Engine, and TTS. |

### Services (Separation of Concerns)

| File | Responsibility |
|------|----------------|
| `services/stt_provider.py` | **Speech-to-Text**. Wraps OpenAI Whisper. Takes WebM audio bytes, returns transcript text. |
| `services/tts_provider.py` | **Text-to-Speech**. Wraps OpenAI TTS. Takes text, returns Base64-encoded Opus audio. |
| `services/judge_engine.py` | **The Brain**. Uses GPT-4 to analyze the rolling transcript and decide when to interrupt. Generates questions. Manages per-session context. |
| `services/case_ingestion.py` | Parses uploaded PDF briefs and extracts text/sections. |

---

## Data Flow: The Real-Time Loop

This is the core loop that makes the app work:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         THE REAL-TIME SIMULATION LOOP                        │
└──────────────────────────────────────────────────────────────────────────────┘

1. USER SPEAKS
   └─▶ Browser MediaRecorder captures audio in 4-second WebM chunks.
       (Avatar.tsx: startRecording)

2. AUDIO SENT TO BACKEND
   └─▶ Chunk is Base64-encoded and sent via WebSocket.
       (useSimulationSocket.ts: sendAudio)

3. SPEECH-TO-TEXT (STT)
   └─▶ Backend decodes Base64, sends to OpenAI Whisper.
       (main.py → stt_provider.py)

4. TRANSCRIPT APPENDED
   └─▶ Transcript text is appended to a rolling session transcript.
       (main.py: session_data['transcript'])

5. TRANSCRIPT SENT BACK
   └─▶ Backend sends `transcript_update` to frontend for UI feedback.
       (main.py → useSimulationSocket.ts → CourtroomHUD)

6. JUDGE DECISION
   └─▶ JudgeEngine (GPT-4) analyzes transcript:
       - Is there a logical gap?
       - Is the point unclear?
       - Has enough time passed since last interrupt?
       (main.py: check_and_trigger_interrupt → judge_engine.py: should_interrupt)

7. IF INTERRUPT:
   └─▶ JudgeEngine generates a question.
   └─▶ TTSProvider synthesizes audio (OpenAI TTS → Opus).
   └─▶ Backend sends `judge_interrupt` with question text + Base64 audio.
       (main.py → tts_provider.py → useSimulationSocket.ts)

8. FRONTEND PLAYS AUDIO
   └─▶ useAudioPlayer decodes Base64 → Web Audio API playback.
   └─▶ Judge avatar mouth animates (lipsync).
   └─▶ Question displayed in JudgeQuestionOverlay.
       (Avatar.tsx: handleJudgeInterrupt)

9. LOOP REPEATS
   └─▶ Every 4.5 seconds, a new audio chunk is sent.
```

---

## Separation of Concerns

### Frontend Responsibilities
- **UI/UX**: All visual rendering, 3D scene, overlays, user feedback.
- **Audio Capture**: MediaRecorder for capturing user speech.
- **Audio Playback**: Web Audio API for playing judge TTS.
- **Session State**: Manages `simulationPhase` (ritual progression).
- **PDF Parsing**: Extracts text from briefs using PDF.js (client-side).

### Backend Responsibilities
- **AI Services**: All OpenAI API calls (STT, TTS, GPT-4) happen server-side.
- **Session Management**: Maintains transcript, questions asked, cooldown timers per session.
- **Judge Logic**: Decides when to interrupt and what to ask.
- **Security**: API keys are never exposed to the client.

### What the Frontend Does NOT Do
- Never calls OpenAI directly (except for fallback browser TTS).
- Never stores API keys.
- Never decides when the judge should interrupt.

### What the Backend Does NOT Do
- No 3D rendering.
- No UI logic.
- No direct browser APIs (MediaRecorder, Web Audio).

---

## WebSocket Message Schema

### Frontend → Backend

| Type | Payload | When |
|------|---------|------|
| `config` | `{ proceedingType, userRole, seed_questions, brief_summary }` | When PROCEEDING phase starts |
| `audio` | `{ audio: "base64..." }` | Every 4 seconds during PROCEEDING |
| `phase_change` | `{ phase: "PROCEEDING" \| "ADJOURNED" }` | When user advances phases |
| `request_interrupt` | `{}` | (Debug) Force a judge interrupt |

### Backend → Frontend

| Type | Payload | When |
|------|---------|------|
| `transcript_update` | `{ text: "..." }` | After each STT transcription |
| `judge_interrupt` | `{ question, audio, audio_format }` | When judge decides to ask a question |
| `phase_update` | `{ phase: "..." }` | Echo of phase change |
| `error` | `{ message: "..." }` | On errors |

---

## File Dependency Graph

```
App.tsx
├── AuthGate.tsx
├── Home.tsx
│   └── (PDF.js for text extraction)
├── Avatar.tsx (ORCHESTRATOR)
│   ├── useSimulationSocket.ts (WebSocket + Audio Player)
│   ├── CourtroomScene.tsx
│   │   ├── Courtroom.tsx (3D model)
│   │   └── AvatarModel.tsx (Ready Player Me)
│   ├── RitualOverlay.tsx
│   ├── JudgeQuestionOverlay.tsx
│   └── CourtroomHUD.tsx
└── JudgeAdmin.tsx (calls /api/seed-questions, /api/synthesize-question)

main.py (BACKEND ORCHESTRATOR)
├── services/stt_provider.py (OpenAI Whisper)
├── services/tts_provider.py (OpenAI TTS)
├── services/judge_engine.py (GPT-4)
└── services/case_ingestion.py (PDF parsing)
```

---

## Environment Variables

All configuration is centralized in the root `.env` file:

| Variable | Used By | Purpose |
|----------|---------|---------|
| `OPENAI_API_KEY` | Backend | All OpenAI services (STT, TTS, GPT-4) |
| `PASSWORD` | (To be implemented) | App access password |
| `CORS_ORIGINS` | Backend | Allowed frontend origins in production |
| `VITE_API_URL` | Frontend | Backend URL for REST calls |
| `VITE_WS_URL` | Frontend | Backend URL for WebSocket |

---

## Key Design Decisions

1. **Single AI Provider (OpenAI)**: All AI services use OpenAI to simplify configuration and reduce API key management.

2. **WebSocket for Real-Time**: Audio is sent via WebSocket (not REST) to minimize latency in the interrupt loop.

3. **4-Second Audio Chunks**: Balances latency (shorter = faster feedback) with transcription quality (longer = more context for Whisper).

4. **Frontend Controls Ritual Phases**: The backend echoes phase changes but doesn't initiate them. This keeps the "theatrical" flow in the frontend.

5. **Backend Controls Judge Logic**: The decision to interrupt and the question content are entirely server-side. This keeps AI logic secure and modular.

6. **Rolling Transcript**: The backend maintains a growing transcript per session. The JudgeEngine analyzes the most recent 1500 characters to decide on interrupts.
