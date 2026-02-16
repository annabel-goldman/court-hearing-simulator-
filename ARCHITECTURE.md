# Court Simulator Architecture

This document explains how each file in the codebase works together, the separation of concerns, and the frontend-backend communication flow.

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React)                               │
│                                                                             │
│  ┌─────────────┐    ┌──────────────────┐    ┌─────────────────┐             │
│  │   Home.tsx  │───▶│ CourtroomPage.tsx│───▶│ CourtroomScene  │             │
│  │ (PDF Upload)│    │  (Orchestrator)  │    │   (3D World)    │             │
│  └─────────────┘    └────────┬─────────┘    └─────────────────┘             │
│                              │                                               │
│                              ▼                                               │
│              ┌───────────────────────────────────┐                           │
│              │ useSimulationSocket │ useMediaRecording │                     │
│              │    (WebSocket)      │  (Audio Capture)  │                     │
│              └───────────────────┬─────────────────────┘                     │
└──────────────────────────────────┼──────────────────────────────────────────┘
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

### Folder Structure

```
frontend/src/
├── main.tsx                    # React entry point
├── App.tsx                     # Routing + AuthGate wrapper
│
├── pages/
│   ├── Home.tsx                # PDF upload interface
│   ├── CourtroomPage.tsx       # Main simulation orchestrator
│   └── JudgeAdmin.tsx          # Admin tool for testing prompts
│
├── 3d-rendering/               # All 3D scene components
│   ├── index.ts                # Module exports
│   ├── types.ts                # Shared types (SpeakingRole, SimulationPhase, etc.)
│   ├── scenePresets.ts         # 3D layout configuration (camera, positions, colors)
│   ├── CourtroomScene.tsx      # Canvas wrapper with lighting/camera
│   ├── Courtroom.tsx           # Static courtroom geometry (benches, walls, etc.)
│   └── AvatarModel.tsx         # Ready Player Me avatar with lipsync
│
├── ui-overlays/                # 2D UI overlay components
│   ├── index.ts                # Module exports
│   ├── CourtroomRitualOverlay.tsx  # Full-screen ritual phase prompts
│   ├── JudgeSpeechOverlay.tsx      # Judge question subtitle display
│   └── StatusDashboardHUD.tsx      # Video preview, timer, transcript, controls
│
├── hooks/
│   ├── useSimulationSocket.ts  # WebSocket communication + audio player
│   └── useMediaRecording.ts    # Camera/mic capture + audio chunking
│
├── config/
│   └── simulationConfig.ts     # Centralized timing constants
│
└── components/
    └── AuthGate.tsx            # Password protection gate
```

### Entry Point

| File | Purpose |
|------|---------|
| `main.tsx` | React entry point. Mounts the `<App />` component. |
| `App.tsx` | Sets up routing and wraps everything in `<AuthGate>` for password protection. |

### Pages (Routes)

| File | Route | Purpose |
|------|-------|---------|
| `pages/Home.tsx` | `/` | PDF upload interface. Extracts text from briefs using PDF.js and stores in `sessionStorage`. |
| `pages/CourtroomPage.tsx` | `/courtroom` | **Main orchestrator**. Manages the simulation loop, uses hooks for audio and WebSocket, and renders the 3D scene with UI overlays. |
| `pages/JudgeAdmin.tsx` | `/admin/judge` | Admin tool for testing judge prompts via backend API. |

### 3D Rendering (`3d-rendering/`)

| File | Purpose |
|------|---------|
| `types.ts` | Shared TypeScript types: `SimulationPhase`, `SpeakingRole`, `SessionConfig`, `VISEME_MAP`. |
| `scenePresets.ts` | Configuration for 3D scene layout (camera position, avatar positions, bench dimensions, colors). Easily adjustable constants. |
| `CourtroomScene.tsx` | The `<Canvas>` wrapper. Sets up lighting, fog, camera controls, and renders the 3D courtroom + avatars. |
| `Courtroom.tsx` | The 3D courtroom model (benches, walls, floor, chairs, tables, flags, seal). |
| `AvatarModel.tsx` | Loads Ready Player Me avatars and applies lipsync/sitting poses via bone manipulation. |
| `index.ts` | Barrel export for all 3D components and types. |

### UI Overlays (`ui-overlays/`)

| File | Purpose |
|------|---------|
| `CourtroomRitualOverlay.tsx` | Full-screen overlay for ritual phases (All Rise, Judge Seated, Adjourned). Prompts user to click to advance. |
| `JudgeSpeechOverlay.tsx` | Displays the judge's current question as a subtitle in the center of the screen. |
| `StatusDashboardHUD.tsx` | Heads-up display: self-preview video, timer, transcript feedback, connection status, end session button. |
| `index.ts` | Barrel export for all overlay components. |

### Hooks

| File | Purpose |
|------|---------|
| `useSimulationSocket.ts` | **WebSocket communication**. Manages connection to backend. Exposes `sendAudio`, `sendConfig`, `changePhase`. Handles incoming `judge_interrupt` and `transcript_update` messages. Includes `useAudioPlayer` for playing TTS audio via Web Audio API. |
| `useMediaRecording.ts` | **Media capture**. Initializes camera/mic, provides video preview ref, monitors audio levels, and captures audio in configurable chunks. Returns `startRecording`/`stopRecording` controls. |

### Config

| File | Purpose |
|------|---------|
| `simulationConfig.ts` | **Centralized timing constants**. All magic numbers for audio chunking, recording intervals, TTS settings, ritual timing, and session duration. Easy to adjust without hunting through code. |

#### Key Constants in `simulationConfig.ts`:

| Constant | Default | Purpose |
|----------|---------|---------|
| `AUDIO_CHUNK_DURATION_MS` | 4000 | Duration of each audio chunk sent to backend |
| `RECORDING_INTERVAL_MS` | 4500 | Interval between starting new recordings |
| `RECORDING_SYNC_DELAY_MS` | 500 | Delay before starting recording after phase change |
| `DEMO_SESSION_DURATION_SECONDS` | 60 | Total session time for demo mode |
| `MS_PER_WORD` | 400 | Used to calculate judge speaking duration |
| `RITUAL_START_DELAY_MS` | 1500 | Delay before "All Rise" starts |
| `JUDGE_ENTERING_DURATION_MS` | 3000 | Duration of judge entering animation |

### Other Components

| File | Purpose |
|------|---------|
| `components/AuthGate.tsx` | Password gate. Currently uses a hardcoded hash (to be moved to backend). |

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
       (useMediaRecording.ts: startRecording)

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
       (main.py → useSimulationSocket.ts → StatusDashboardHUD)

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
   └─▶ Question displayed in JudgeSpeechOverlay.
       (CourtroomPage.tsx: handleJudgeInterrupt)

9. LOOP REPEATS
   └─▶ Every 4.5 seconds, a new audio chunk is sent.
       (Configurable via RECORDING_INTERVAL_MS in simulationConfig.ts)
```

---

## Separation of Concerns

### Frontend Responsibilities
- **UI/UX**: All visual rendering, 3D scene, overlays, user feedback.
- **Audio Capture**: useMediaRecording hook handles MediaRecorder.
- **Audio Playback**: Web Audio API for playing judge TTS.
- **Session State**: Manages `simulationPhase` (ritual progression).
- **PDF Parsing**: Extracts text from briefs using PDF.js (client-side).
- **Timing Configuration**: All timing constants centralized in `simulationConfig.ts`.

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
| `audio` | `{ audio: "base64..." }` | Every 4.5 seconds during PROCEEDING |
| `phase_change` | `{ phase: "PROCEEDING" \| "ADJOURNED" }` | When user advances phases |

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
├── CourtroomPage.tsx (ORCHESTRATOR)
│   ├── useSimulationSocket.ts (WebSocket + Audio Player)
│   ├── useMediaRecording.ts (Camera/Mic + Audio Chunks)
│   ├── simulationConfig.ts (Timing Constants)
│   ├── 3d-rendering/
│   │   ├── CourtroomScene.tsx
│   │   │   ├── Courtroom.tsx (3D geometry)
│   │   │   └── AvatarModel.tsx (Ready Player Me)
│   │   ├── scenePresets.ts (Layout config)
│   │   └── types.ts (Shared types)
│   └── ui-overlays/
│       ├── CourtroomRitualOverlay.tsx
│       ├── JudgeSpeechOverlay.tsx
│       └── StatusDashboardHUD.tsx
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

3. **Configurable Audio Chunks**: Chunk duration and interval are centralized in `simulationConfig.ts` for easy tuning.

4. **Frontend Controls Ritual Phases**: The backend echoes phase changes but doesn't initiate them. This keeps the "theatrical" flow in the frontend.

5. **Backend Controls Judge Logic**: The decision to interrupt and the question content are entirely server-side. This keeps AI logic secure and modular.

6. **Rolling Transcript**: The backend maintains a growing transcript per session. The JudgeEngine analyzes the most recent 1500 characters to decide on interrupts.

7. **Modular Folder Structure**: 3D rendering, UI overlays, hooks, and config are separated into distinct folders for maintainability.

8. **Centralized Timing Config**: All timing constants are in one file (`simulationConfig.ts`) to make tuning the simulation easy.

9. **Hook-Based Architecture**: Media recording is extracted into `useMediaRecording` for reusability and cleaner separation from the main page component.

10. **React Router Navigation**: Session end uses `useNavigate()` for proper SPA navigation instead of `window.location.href`.
