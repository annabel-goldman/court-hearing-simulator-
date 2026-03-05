# Court Hearing Simulator — CLAUDE.md

Codebase and development instructions for Claude Code. Follow these instructions exactly.

---

## Project Philosophy

This is a **real-time moot-court simulator** where a law student argues before a panel of AI judges in a 3D courtroom. The core UX contract is:

> The student speaks → judges interrupt naturally → the student improves.

Every architectural decision serves latency and naturalness:
- **Never block the audio receive loop.** STT → transcript must be fast.
- **Degrade gracefully.** If the API is unreachable, fall back silently. Never crash the session.
- **Multi-agent orchestration over a single WebSocket.** The courtroom runs one `ws/{session_id}` connection; multi-agent judge selection, scoring, deduplication, and cooldowns all happen server-side within that connection.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Backend runtime | FastAPI + uvicorn (asyncio) |
| Backend package manager | **`uv`** — always `uv run` and `uv sync` |
| Frontend | React 18 + TypeScript + Vite |
| Frontend package manager | **`bun`** |
| 3D rendering | Three.js via `@react-three/fiber` + `@react-three/drei` |
| Avatar lipsync | `wawa-lipsync` + Ready Player Me GLB avatars |
| LLM inference | OpenAI API (or any OpenAI-compatible endpoint) |
| STT | Local faster-whisper (GPU, optional) or OpenAI Whisper API |
| TTS | OpenAI TTS (opus format) — fallback to browser SpeechSynthesis |

**Install and run:**
```bash
# One-command start (backend + frontend)
./start.sh

# Or manually:
cd backend && uv sync && uv run uvicorn main:app --reload --port 8000
cd frontend && bun install && bun run dev
```

---

## Directory Map

```
backend/
├── main.py                          # FastAPI app, both WebSocket endpoints, all REST API routes
├── multi_agent/
│   ├── __init__.py                  # Re-exports Agent, service, get_embedding, is_semantic_duplicate
│   ├── service.py                   # Agent CRUD + orchestration entry points
│   ├── llm.py                       # analyze_agent_question + brief summary LLM calls
│   ├── models.py                    # Agent dataclass
│   ├── prompts.py                   # All LLM prompt templates
│   ├── similarity.py                # Embedding + cosine similarity for semantic dedup
│   ├── storage.py                   # File-based agent JSON persistence + versioning
│   └── data/
│       ├── defaults/                # Built-in agents (7 agents, not deletable)
│       └── custom/                  # User-created agents (versioned JSON)
├── services/
│   ├── judge_engine.py              # Single-judge LLM logic (should_interrupt, synthesize_question)
│   ├── tts_provider.py              # TTS (OpenAI Opus, fallback empty)
│   ├── stt_provider.py              # STT (local faster-whisper or OpenAI Whisper)
│   └── case_ingestion.py            # PDF brief extraction (pypdf)
├── projected_timeline/              # ⚠️  NOT INTEGRATED — see "Integration Gap" below
│   ├── bartowski/                   # Local model configs (llama.cpp)
│   ├── llama.cpp/                   # Local inference server
│   └── unsloth/                     # Model weights/configs
├── requirements.txt                 # pip dependencies (legacy)
└── pyproject.toml                   # uv project config (primary)

frontend/
├── src/
│   ├── App.tsx                      # Router: / → Home, /courtroom → CourtroomPage,
│   │                                #   /3d → ThreeDPage, /session-audit → SessionAuditPage,
│   │                                #   /multi-agent → AgentSimulation
│   ├── pages/
│   │   ├── Home.tsx                 # Brief upload + session config → redirects to /courtroom
│   │   ├── CourtroomPage.tsx        # Main courtroom: 3D scene + WebSocket + recording + ritual phases
│   │   ├── SessionAuditPage.tsx     # Post-session review (questions, missed questions, transcript)
│   │   └── ThreeDPage.tsx           # Standalone 3D scene viewer
│   ├── 3d-rendering/
│   │   ├── CourtroomScene.tsx       # Three.js Canvas, lighting, fog, camera, orbit controls
│   │   ├── Courtroom.tsx            # Courtroom geometry (bench, podium, gallery)
│   │   ├── AvatarModel.tsx          # Ready Player Me GLB avatar with morph targets + animation
│   │   ├── JudgeEntranceSequence.tsx # Judge walk-in animation
│   │   ├── scenePresets.ts          # Camera positions, light configs
│   │   └── types.ts                 # SimulationPhase, SpeakingRole, SessionConfig, VISEME_MAP
│   ├── ui-overlays/
│   │   ├── JudgeSpeechOverlay.tsx   # Floating judge question display with agent source badge
│   │   ├── StatusDashboardHUD.tsx   # Camera, mic, recording status, timer, transcript
│   │   ├── InterruptLogPanel.tsx    # Scrollable log of all judge questions + missed questions
│   │   ├── AgentSentimentPanel.tsx  # Live agent relevance/eagerness bars
│   │   └── CourtroomRitualOverlay.tsx # Phase transition prompts (All rise, etc.)
│   ├── hooks/
│   │   ├── useSimulationSocket.ts   # Primary WebSocket hook (ws/{session_id})
│   │   └── useMediaRecording.ts     # MediaRecorder + audio chunk streaming
│   ├── multi-agent/                 # Standalone multi-agent simulation page (/multi-agent)
│   │   ├── pages/AgentSimulation.tsx
│   │   ├── components/              # AgentEditor, BriefUpload, QuestionFeed, etc.
│   │   ├── hooks/                   # useMultiAgentSocket, useMediaRecording
│   │   └── styles/                  # Per-component CSS (ma-* prefix)
│   ├── config/
│   │   ├── simulationConfig.ts      # All timing constants (chunk duration, silence trigger, etc.)
│   │   ├── assetUrls.ts             # S3 URLs for GLB avatar assets
│   │   └── homeLandingConfig.ts     # Home page copy/config
│   ├── styles/                      # Global CSS (app-shell, courtroom, ritual, proceeding setup)
│   ├── types/
│   │   └── sessionAudit.ts          # SessionAuditPayload, question/transcript record types
│   └── components/
│       ├── AuthGate.tsx             # Password gate wrapper
│       └── LandingAgreementAvatar.tsx # Landing page avatar
└── package.json                     # bun, React 18, Three.js, react-router-dom v7, wawa-lipsync
```

---

## Architecture Overview

### Session Lifecycle

1. **Home** (`/`): User uploads briefs (PDF), gets judicial summary, configures session (duration, multi-agent toggle, judge difficulty), stores config in `sessionStorage.courtSession`, navigates to `/courtroom`.

2. **Courtroom** (`/courtroom`): Reads `sessionStorage.courtSession`, opens WebSocket to `ws/{session_id}`, then progresses through ritual phases:
   - `OFF_RECORD` → `ALL_RISE` → `JUDGE_ENTERING` → `JUDGE_SEATED` → `PROCEEDING` → `ADJOURNED`
   - Ritual phases are frontend-controlled (timed transitions + TTS cues).
   - `PROCEEDING` triggers recording start + backend config message.

3. **During PROCEEDING**: Audio chunks stream to backend → STT → transcript_update → interrupt check. Backend may send `judge_interrupt` with question + TTS audio.

4. **Session End**: Timer expires → `ADJOURNED` → session audit payload saved to `sessionStorage` → navigate to `/session-audit`.

### Two WebSocket Endpoints

| Endpoint | Purpose | Used by |
|----------|---------|---------|
| `/ws/{session_id}` | Primary courtroom: single-judge or multi-agent interrupt orchestration | `CourtroomPage` via `useSimulationSocket` |
| `/ws/multi-agent/{session_id}` | Standalone multi-agent simulation (no 3D, simpler protocol) | `AgentSimulation` via `useMultiAgentSocket` |

The primary endpoint (`/ws/{session_id}`) handles both single-judge and multi-agent modes based on the `multi_agent` field in the config message. When `multi_agent.enabled` is true, the backend evaluates multiple judge agents per transcript chunk and selects the highest-relevance, non-duplicate question.

---

## WebSocket Message Protocol

### Primary endpoint (`/ws/{session_id}`)

**Client → Server:**

| type | payload |
|------|---------|
| `config` | `{proceedingType, userRole, seed_questions, brief_summary, synthesis_prompt?, multi_agent?}` |
| `audio` | `{audio: base64_webm}` |
| `phase_change` | `{phase}` |
| `silence_timeout` | `{}` |
| `question_cutoff` | `{}` |

**Server → Client:**

| type | payload |
|------|---------|
| `phase_update` | `{phase}` |
| `transcript_update` | `{text}` |
| `judge_interrupt` | `{question, audio, audio_format, source: {type, agent_id?, agent_name?, agent_color?, strategy?}}` |
| `agent_scores` | `{scores: [{agent_id, agent_name, agent_color, relevance, should_ask, on_cooldown}]}` |
| `missed_question` | `{agent_id, agent_name, agent_color, question, relevance, reason, timestamp}` |

### Multi-agent endpoint (`/ws/multi-agent/{session_id}`)

**Client → Server:**

| type | payload |
|------|---------|
| `config` | `{agents, brief_summary}` |
| `audio` | `{audio: base64_webm}` |
| `phase_change` | `{phase}` |
| `update_agents` | `{agents}` |

**Server → Client:**

| type | payload |
|------|---------|
| `config_ack` | `{status, agent_count}` |
| `transcript_update` | `{text}` |
| `agent_question` | `{agent_id, agent_name, color, question, timestamp}` |
| `agents_updated` | `{agent_count}` |
| `phase_update` | `{phase}` |

---

## Multi-Agent Orchestration (Primary WebSocket)

When `multi_agent.enabled` is true in the config message, the primary WebSocket uses a competitive agent selection model:

1. **Per-transcript chunk**: After STT produces a transcript update, `check_and_trigger_interrupt` is called.
2. **Window check**: Must be in PROCEEDING phase, no cutoff, no active cooldown timer, enough new words since last question (`MIN_NEW_WORDS_AFTER_QUESTION = 10`).
3. **Agent evaluation**: Up to `max_agents_per_pass` agents are evaluated in round-robin order. Each agent's `analyze_agent_question` (LLM call) returns `(should_ask, question, relevance)`.
4. **Per-agent cooldown**: Each agent has a 60-second cooldown and must see 30 new words before asking again.
5. **Relevance gate**: Only agents with relevance >= `MIN_RELEVANCE_TO_ASK` (7) become candidates.
6. **Semantic dedup**: Candidate questions are compared against all previously asked questions via embedding cosine similarity (threshold 0.85).
7. **Selection**: Highest-relevance non-duplicate candidate wins. TTS is synthesized and `judge_interrupt` is sent.
8. **Side channels**: `agent_scores` (live relevance bars) and `missed_question` (questions that lost selection or were duplicates) are also sent.

### Key Constants (in `main.py`)
```
DEDUP_SIMILARITY_THRESHOLD = 0.85
MIN_RELEVANCE_TO_ASK = 7
JUDGE_MS_PER_WORD = 400
JUDGE_MIN_SPEAKING_TIME_MS = 3000
JUDGE_POST_SPEECH_COOLDOWN_SECONDS = 3
MIN_NEW_WORDS_AFTER_QUESTION = 10
AGENT_MIN_COOLDOWN_SECONDS = 60
AGENT_MIN_NEW_WORDS = 30
```

---

## 3D Rendering

The courtroom uses `@react-three/fiber` with a full Three.js scene:

- **Courtroom geometry** (`Courtroom.tsx`): bench, podium, gallery, floor — built from primitive meshes.
- **Avatars** (`AvatarModel.tsx`): Ready Player Me `.glb` files loaded via `useGLTF`. Morph targets for visemes (lip-sync). Animation states: `seatedIdle`, `seatedTalk`, `clap`, `cheer`, `sitTransition`, `sitToStand`.
- **Judge entrance** (`JudgeEntranceSequence.tsx`): Animated walk to bench during `JUDGE_ENTERING` phase.
- **Scene** (`CourtroomScene.tsx`): Canvas, fog, directional + ambient light, `OrbitControls`.
- **Lipsync**: `wawa-lipsync` library drives avatar morph targets from TTS audio.
- **Debug API**: `window.courtAnim` exposes `.set()`, `.pulse()`, `.demo()`, `.clear()` for console-driven animation testing.

Avatar assets are hosted on S3 (see `config/assetUrls.ts`). Judge difficulty (`easy`/`medium`/`hard`) selects different avatar URLs.

---

## Audio Pipeline

1. Frontend records WebM audio chunks (4s duration) via `MediaRecorder` (`useMediaRecording`)
2. Sends as base64 over WebSocket (`audio` message)
3. Backend verifies WebM magic bytes (`\x1a\x45\xdf\xa3`)
4. STT provider transcribes (faster-whisper local GPU, or OpenAI Whisper API)
5. Transcript appended to session state, `transcript_update` sent to client
6. Interrupt check triggered

### Silence Detection (Frontend)
- `audioLevel` below `SILENCE_AUDIO_LEVEL_THRESHOLD` (10) for `SILENCE_TRIGGER_MS` (8000ms) → sends `silence_timeout` to backend
- Backend responds with a synthesized judge question (either from multi-agent or single-judge fallback)
- Judge speaking resets the silence timer

---

## Agent Storage

- **Default agents** (7): `multi_agent/data/defaults/{id}.json` — never delete these files at runtime
  - `clarification_agent`, `example_agent_devils_advocate`, `hypothetical_agent`, `jerk_judge`, `precedent_agent`, `sanity_check_agent`, `statutory_interp_agent`
- **Custom agents**: `multi_agent/data/custom/{id}_v{N}.json` — full version history
- `storage.py` handles all CRUD. Versioning is append-only.
- The `Agent` dataclass is defined in `multi_agent/models.py`

---

## REST API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/seed-questions` | POST | Generate seed questions from briefs |
| `/api/summarize-briefs` | POST | Summarize appellant + appellee briefs |
| `/api/synthesize-question` | POST | Synthesize a judge question from transcript context |
| `/api/tts` | POST | Text-to-speech synthesis |
| `/api/upload-brief` | POST | Upload + extract PDF brief |
| `/api/multi-agent/agents` | GET | List all agents |
| `/api/multi-agent/agents` | POST | Save new agent version |
| `/api/multi-agent/agents/new` | POST | Create new agent |
| `/api/multi-agent/agents/{id}/versions` | GET | Agent version history |
| `/api/multi-agent/agents/{id}/reset` | GET | Reset agent to default |
| `/api/multi-agent/agents/{id}` | DELETE | Delete custom agent |
| `/api/multi-agent/summarize` | POST | Generate brief summary for multi-agent session |

---

## Environment Variables

```bash
# Required
OPENAI_API_KEY=sk-...             # or any OpenAI-compatible key

# Optional model config
OPENAI_BASE_URL=https://api.openai.com/v1   # or local endpoint

# STT
STT_PROVIDER=local                # "local" (faster-whisper) or "openai"
WHISPER_MODEL=medium              # tiny, base, small, medium, large-v3
WHISPER_DEVICE=cuda               # cuda or cpu
WHISPER_COMPUTE_TYPE=float16

# TTS (falls back to OPENAI_API_KEY if unset)
TTS_API_KEY=sk-...
TTS_BASE_URL=https://api.openai.com/v1

# Frontend URLs (for deployed environments)
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000/ws

# CORS
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
```

---

## Frontend Timing Constants (`config/simulationConfig.ts`)

| Constant | Value | Purpose |
|----------|-------|---------|
| `AUDIO_CHUNK_DURATION_MS` | 4000 | Audio chunk length |
| `RECORDING_SYNC_DELAY_MS` | 500 | Delay before recording after phase change |
| `DEMO_SESSION_DURATION_SECONDS` | 180 | Default session length (3 min) |
| `SILENCE_TRIGGER_MS` | 8000 | Silence before judge question |
| `SILENCE_AUDIO_LEVEL_THRESHOLD` | 10 | Audio level treated as silence |
| `MS_PER_WORD` | 400 | Judge speaking pace estimate |
| `MIN_SPEAKING_TIME_MS` | 3000 | Min judge question display |
| `TIMER_OVERTIME_SECONDS` | 10 | Extra time when timer expires mid-question |

---

## Integration Gap: `projected_traj` Backend

The `projected_traj` branch contains a trajectory-tracking and topic-prediction system that is **not yet integrated** into this branch. That branch provides:

- **`projected_timeline/`** module: `tracker.py` (real-time trajectory classifier), `mcts.py` (MCTS topic sequencer), `models.py` (Pydantic models), `router.py` (REST + SSE endpoints), `timeline_generator.py` (issue extraction + per-lens agenda generation)
- **`services/opponent_engine.py`**: Adaptive opposing counsel that uses trajectory context
- **`services/model_router.py`**: LARGE/SMALL/TINY model tier routing with runtime overrides
- Deep integration into `main.py`: `set_agenda` WebSocket handler, `_build_trajectory_context()`, `check_tracker_and_counter()`, `agenda_update` messages, MCTS re-projection on each transcript flush
- Frontend `OrchestratedAgents` page with `AgendaPanel`, `MCTSTreeViz`, `OpponentFeed`, `ScoreLog`, config panels

To integrate, the `projected_traj` backend modules need to be merged in, `main.py` needs the tracker/MCTS wiring, and the frontend needs either the OrchestratedAgents page ported or trajectory awareness added to the existing CourtroomPage HUD.

---

## Development Rules

1. **Always use `uv run` and `uv sync`** for backend, **`bun`** for frontend. Never bare `pip` or `npm`.
2. **Never block the event loop.** CPU-bound work → thread pool. File I/O → async or threaded.
3. **Session state is in-process dicts** (`manager.session_data` / `multi_agent_manager.session_data`). Document new fields.
4. **Agent defaults are sacred.** Never modify `data/defaults/*.json` at runtime; always write to `data/custom/`.
5. **Semantic dedup before sending any question.** Every candidate question must pass the embedding similarity check against `question_embeddings` in the session.
6. **Ritual phases are frontend-controlled.** The backend should only emit `phase_update` for `PROCEEDING` and `ADJOURNED`; the frontend drives `ALL_RISE` → `JUDGE_ENTERING` → `JUDGE_SEATED` transitions.
7. **Question window must be respected.** Never send a `judge_interrupt` unless `_is_question_window_open()` returns true. This prevents overlapping questions and ensures cooldown/new-speech gates are honored.
8. **3D assets on S3.** GLB avatar files are loaded from S3 URLs defined in `config/assetUrls.ts`. Do not commit large binary assets to the repo.
