# Court Hearing Simulator — AGENTS.md

Codebase and development instructions for Codex. Follow these instructions exactly.

---

## Project Philosophy

This is a **real-time moot-court simulator** where a law student argues before a panel of AI judges. The core UX contract is:

> The student speaks → judges and respondent interrupt naturally → the student improves.

Every architectural decision serves latency and naturalness:
- **Never block the audio receive loop.** STT → transcript must be fast.
- **Decouple heavy work.** LLM calls, MCTS, quality scoring all run out of the hot path via fire-and-forget or thread pool.
- **Degrade gracefully.** If a model tier is unreachable, fall back silently. If embeddings fail, use TF-IDF. Never crash the session.
- **Small models for hot decisions, large models for quality output.** Agent analysis uses SMALL tier; judge questions use LARGE tier.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Backend runtime | FastAPI + Hypercorn (`--worker-class trio`) + anyio |
| Package manager | **`uv`** — always `uv run` and `uv sync` |
| Frontend | React + TypeScript + Vite (`frontend/`) |
| LLM inference | OpenAI-compatible API (local llama-server or cloud: OpenRouter, Groq, etc.) |
| STT | Groq Whisper, OpenAI Whisper API, or local faster-whisper (GPU) |
| TTS | Multi-provider: OpenAI, Groq (Orpheus), or Cartesia — with failover |
| Embeddings | sentence-transformers `all-MiniLM-L6-v2` (fallback: TF-IDF trigrams) |

**Install and run:**
```bash
# Local dev (includes faster-whisper + sentence-transformers GPU deps)
cd backend && uv sync --extra local

# Cloud/API-only (no CUDA deps)
cd backend && uv sync

# Start server
uv run hypercorn main:app --bind 0.0.0.0:8000 --worker-class trio --reload
```

---

## Directory Map

```
backend/
├── main.py                          # FastAPI app composition (lifespan + middleware + routers)
├── model_router.py                  # LARGE/SMALL/TINY tier routing + runtime overrides
├── api/
│   ├── router.py                    # Composed API router (includes all sub-routers)
│   ├── routes/
│   │   ├── config.py                # REST endpoints: judge/opponent/tts/stt/model config
│   │   └── multi_agent.py           # REST endpoints: agents, scores, opponent, sessions
│   └── ws/
│       └── multi_agent.py           # WebSocket route registration
├── domain/
│   └── simulation/
│       └── runtime.py               # Core simulation logic: session mgmt, WS handler, eval hot path
├── schemas/
│   └── requests.py                  # Pydantic request models for REST endpoints
├── multi_agent/
│   ├── service.py                   # Agent CRUD + orchestration entry points
│   ├── llm.py                       # analyze_agent_question + brief summary
│   ├── models.py                    # Agent dataclass
│   ├── prompts.py                   # All LLM prompt templates
│   ├── storage.py                   # File-based agent JSON persistence + versioning
│   └── data/
│       ├── defaults/                # Built-in agents (not deletable)
│       └── custom/                  # User-created agents (versioned JSON)
├── projected_timeline/
│   ├── models.py                    # Pydantic models for timeline/tracker
│   ├── tracker.py                   # Real-time trajectory classifier (EMA + embeddings)
│   ├── mcts.py                      # MCTS topic sequencer (generation + projection)
│   ├── timeline_generator.py        # Phase1 issue extraction + Phase2 per-lens agendas
│   └── router.py                    # REST + SSE endpoints
├── services/
│   ├── judge_engine.py              # Single-judge LLM logic + argument scoring
│   ├── judge_config.py              # Judge config dataclasses, file I/O, defaults
│   ├── opponent_engine.py           # Adaptive respondent (opposing counsel) engine
│   ├── opponent_config.py           # Opponent config dataclasses, file I/O, defaults
│   ├── tts_provider.py              # Multi-provider TTS (OpenAI, Groq, Cartesia) + failover
│   ├── stt_provider.py              # Multi-provider STT (Groq, OpenAI, local faster-whisper)
│   ├── media_config.py              # TTS/STT runtime config dataclasses + file I/O
│   └── model_config.py              # Per-tier model runtime config dataclasses + file I/O
└── data/
    ├── judge_config.json            # Persisted judge config (auto-created on first save)
    ├── opponent_config.json         # Persisted opponent config (auto-created on first save)
    ├── tts_config.json              # Persisted TTS config (auto-created on first save)
    ├── stt_config.json              # Persisted STT config (auto-created on first save)
    └── model_config.json            # Persisted per-tier model config (auto-created on first save)

frontend/
├── src/pages/
│   ├── OrchestratedAgents.tsx       # Multi-judge panel page (main simulation)
│   ├── CourtroomPage.tsx            # Single-judge page
│   ├── Home.tsx                     # Brief upload + landing
│   ├── SessionAuditPage.tsx         # Session audit/review page
│   └── ThreeDPage.tsx               # 3D visualization page
├── src/orchestrated-agents/
│   ├── AgendaPanel.tsx              # Topic coverage visualization
│   ├── OpponentFeed.tsx             # Opposing counsel response display
│   ├── OpponentConfigPanel.tsx      # Collapsible opponent config panel (2 tabs)
│   ├── MCTSTreeViz.tsx              # Live MCTS tree animation
│   ├── JudgeConfigPanel.tsx         # Collapsible judge config panel (3 tabs)
│   ├── JudgeActivityFeed.tsx        # Judge question activity feed
│   ├── ScoreLog.tsx                 # Argument score display
│   ├── SystemConfigPanel.tsx        # Model/TTS/STT config panel (3 tabs)
│   ├── AboutPanel.tsx               # About/info panel
│   ├── judge-config.css             # Styles for JudgeConfigPanel (jcp-* prefix)
│   ├── opponent-config.css          # Styles for OpponentConfigPanel (ocp-* prefix)
│   ├── system-config.css            # Styles for SystemConfigPanel
│   ├── playground-theme.css         # Theme variants
│   ├── score-log.css                # Styles for ScoreLog
│   └── agenda.css                   # Styles for agenda/MCTS viz + layout (oa-* prefix)
├── src/features/
│   ├── orchestrated/
│   │   ├── services/                # configService, multiAgentService, timelineService
│   │   └── utils/sseParser.ts       # SSE stream parsing
│   ├── pdf/utils/extractPdfText.ts  # Client-side PDF text extraction
│   ├── socket/utils/wsBase.ts       # WebSocket base utilities
│   ├── media/utils/audioEncoding.ts # Audio encoding utilities
│   └── courtroom/services/          # TTS service
└── src/multi-agent/
    ├── components/
    │   ├── AgentEditor.tsx          # Edit/create judge agents
    │   ├── BriefUpload.tsx          # PDF brief upload
    │   └── ui/                      # Button, Card, Alert, Input, Badge, FileUpload
    ├── hooks/                       # useMultiAgentSocket, useMediaRecording
    └── styles/                      # variables.css + per-component CSS (ma-* prefix)
```

---

## Model Tier Routing (`model_router.py`)

Three tiers, each cascades to the next if unreachable:

| Tier | Default port | Default model | Used for |
|------|-------------|---------------|----------|
| LARGE | 8001 | Qwen3.5-35B | judge questions, counter-arguments, synthesize |
| SMALL | 8002 | Qwen3-4B | agent analysis, quality assessment, brief summary, argument scoring, opponent response |
| TINY | 8003 | gemma-3-1b-it | issue extraction, agenda generation |

Task-to-tier map lives entirely in `TASK_TIER_MAP` in `model_router.py`. Always add new tasks there.

Env vars: `MODEL_LARGE`, `MODEL_LARGE_URL`, `MODEL_SMALL`, `MODEL_SMALL_URL`, `MODEL_TINY`, `MODEL_TINY_URL`. All cascade: if SMALL is unset it inherits LARGE. In cloud/deployment mode, all tiers typically point to the same OpenAI-compatible API (e.g. OpenRouter) with different model names.

### Runtime overrides

`model_router._runtime_overrides` is a dict that maps `ModelTier → ModelEndpoint` and takes priority over env-var resolution and reachability fallback. Set via `apply_runtime_override(tier, base_url, model, api_key)` and cleared with `clear_runtime_override(tier)`. Used by the Judge Configuration Panel and Model Configuration Panel to route to external OpenAI-compatible APIs without restarting the server.

### Model Configuration (`services/model_config.py`)

Persists per-tier runtime overrides to `backend/data/model_config.json`. Wraps `model_router.apply_runtime_override()` / `clear_runtime_override()` so the UI can configure each tier independently.

```python
@dataclass
class TierConfig:
    enabled: bool = False
    base_url: str = ""
    api_key: str = ""
    model: str = ""

@dataclass
class ModelRuntimeConfig:
    large: TierConfig
    small: TierConfig
    tiny: TierConfig
```

---

## Async / Trio Interoperability

**Critical rule**: The backend runs under **trio** via Hypercorn. Use `anyio` APIs everywhere. Do not use bare `asyncio.*` in new code.

### What works under trio
- `await anyio.to_thread.run_sync(fn)` — run blocking/CPU work in a thread
- `async with anyio.create_task_group() as tg: tg.start_soon(coro)` — concurrent tasks
- `await anyio.sleep(n)` — sleep

### What does NOT work under trio
- `asyncio.create_task(coro)` — no asyncio event loop under trio
- `asyncio.sleep(n)` — use `anyio.sleep(n)` instead
- `asyncio.gather(...)` — use `anyio.create_task_group()` instead
- `asyncio.get_event_loop().run_in_executor(...)` — use `anyio.to_thread.run_sync(fn)` instead

### Fire-and-forget pattern (the correct way)

All fire-and-forget work uses the session's `_tg` task group, which is opened for the lifetime of the WebSocket connection in the handler and cancelled automatically on disconnect:

```python
# From inside the WebSocket handler (has tg in scope):
tg.start_soon(my_coro, arg1, arg2)

# From a helper function (no tg in scope):
session_tg = session.get('_tg')
if session_tg:
    session_tg.start_soon(my_coro, arg1, arg2)
```

### Cancellable timers (CancelScope pattern)

The silence-flush timer uses `anyio.CancelScope` instead of `asyncio.Task.cancel()`:

```python
new_scope = anyio.CancelScope()
session['_silence_scope'] = new_scope

async def _timer():
    with new_scope:
        await anyio.sleep(TIMEOUT)
    if new_scope.cancelled_caught:
        return  # cancelled by new audio

tg.start_soon(_timer)

# To cancel when new audio arrives:
old = session.get('_silence_scope')
if old:
    old.cancel()
```

---

## Projected Timeline Architecture

### Phase 1 — Issue Extraction (TINY tier)
Extracts `{case_summary, key_legal_issues}` from both briefs.

### Phase 2 — Agenda Generation (TINY tier, parallelised)
For each of 10 **JUDICIAL_LENSES** (statutory text, precedent, agency deference, etc.), generates a 5-7 topic ordered agenda. Each lens runs independently; results become `TopicPrediction` objects.

### MCTS — Sparse Topic Sequencing
- **Generation mode** (`run_generation`, n_sims=800, **max_depth=2**): build shallow agendas from scratch during setup. Each path covers only the first 2 predicted topics; the full candidate pool (~50-70 topics) is preserved in `PredictedTopicSets.full_topic_pool`.
- **Lazy expansion**: Once any addressed topic reaches `EXPANSION_QUALITY_THRESHOLD` (0.5) quality, the session's `all_topics` is expanded from the shallow initial set to the full candidate pool. This triggers an immediate MCTS projection over the deeper set, bypassing normal debounce.
- **Projection mode** (`run_projection`, n_sims=150): live prediction of next topics during hearing, operating over whatever topics are currently in `all_topics` (shallow before expansion, full after).

MCTS runs in a thread pool via `anyio.to_thread.run_sync()` — never blocks the event loop.

Gate constants (in `domain/simulation/runtime.py`):
```python
MCTS_MIN_WORDS = 40        # don't run until advocate has spoken 40+ words
MCTS_DEBOUNCE_TURNS = 3    # only re-run every 3rd sentence flush
```

Sparse MCTS constants (in `timeline_generator.py` and `domain/simulation/runtime.py`):
```python
SPARSE_MCTS_INITIAL_DEPTH = 2         # max topics per path in initial generation
EXPANSION_QUALITY_THRESHOLD = 0.5     # quality score that triggers pool expansion
```

Gated frontier constants (in `domain/simulation/runtime.py`):
```python
FRONTIER_BATCH_SIZE = 3               # new topics released per frontier expansion
FRONTIER_QUALITY_GATE = 0.3           # min quality on current topic before expansion
FRONTIER_MIN_FLUSHES = 2              # min flushes on current topic before expansion
PROJECTION_TOP_K = 6                  # max topics passed to run_projection
PROJECTION_QUALITY_GATE = 0.85        # min quality before MCTS projection can run
AGENT_EVAL_GRACE_SECONDS = 5.0        # grace period after first "yes" for more candidates
AGENT_EVAL_MIN_CANDIDATES = 3         # cancel remaining evals once this many say "yes"
```

### Tracker (`tracker.py`)
Real-time EMA confidence + topic coverage per agenda. `update(turn)` is **synchronous** (embedding + heuristic quality). Async LLM quality refinement is scheduled separately as a background task. Use `tracker.state()` (non-mutating) when you only need to read the current state without recording a turn (e.g. after an agent question fires).

Key constants:
```python
LOW_CONFIDENCE_THRESHOLD = 0.25   # below this → regeneration_needed=True
EMA_ALPHA = 0.4                   # recency weight for confidence updates
QUALITY_WEAK_THRESHOLD = 0.4      # below this → topic is "weak"
```

---

## Argument Scoring (`judge_engine.py`)

`JudgeEngine.score_argument(session_id, speaker, utterance, ...)` scores each argument turn on configured dimensions and appends to `MootCourtContext.argument_scores`.

```python
@dataclass
class ArgumentScore:
    speaker: str                 # "appellant" | "respondent"
    utterance_preview: str       # first 120 chars
    clarity: float               # 0-10
    legal_reasoning: float       # 0-10
    responsiveness: float        # 0-10
    persuasiveness: float        # 0-10
    overall: float               # 0-10 (weighted composite computed by LLM)
    feedback: str                # one-sentence coaching note
    timestamp: float
```

- Uses **SMALL tier** (`"argument_scoring"` task)
- Scoring dimensions, weights, and system prompt are loaded dynamically from `judge_config.py` at call time — no server restart needed after config changes
- `ArgumentScore` stores the four standard fields regardless of configured dim names; `overall` is always taken from the LLM response
- REST endpoint: `GET /api/scores/{session_id}`

---

## Opponent Engine (`services/opponent_engine.py`)

Adaptive respondent (opposing counsel) that uses the opposing brief as its knowledge base and generates real-time rebuttals.

```python
@dataclass
class OpponentResponse:
    response_type: str          # "rebuttal" | "exploitation" | "affirmative"
    argument: str               # 2-4 sentence argument text
    strategy_note: str          # tactical note explaining the approach (for the student)
    topic: str                  # legal topic addressed
    strength: float             # 0-10 estimated strength
    timestamp: float
```

- Uses **SMALL tier** (`"opponent_response"` task)
- Initialised per-session when the `config` WS message includes `opposing_brief`
- Fires as a fire-and-forget background task after each sentence-buffer flush (same trigger as agent questions and scoring)
- Adapts based on: (1) advocate's latest argument, (2) judge questions asked, (3) trajectory context (weak/uncovered topics)
- Records judge questions via `record_judge_question()` so it can exploit weaknesses the panel identified
- REST endpoint: `GET /api/opponent/{session_id}`
- Per-session state evicted on WebSocket disconnect

---

## Judge Configuration (`services/judge_config.py`)

Persists judge prompt, scoring prompt template, reward dimensions, and external LLM settings to `backend/data/judge_config.json`.

```python
@dataclass
class RewardDimension:
    name: str        # e.g. "clarity"
    weight: float    # 0–1; all dims must sum to 1.0
    description: str

@dataclass
class ExternalLLMConfig:
    enabled: bool = False
    base_url: str = ""
    api_key: str = ""
    model: str = ""
    tier_override: str = "LARGE"   # "LARGE" | "SMALL" | "BOTH"

@dataclass
class JudgeConfig:
    judge_prompt: str
    scoring_prompt_template: str
    reward_dimensions: List[RewardDimension]
    external_llm: ExternalLLMConfig
```

**File I/O**: `load_config()` / `save_config()` are synchronous. REST endpoints wrap them in `anyio.to_thread.run_sync`. `save_config` uses atomic write-then-rename (`tmp.replace(path)`). `load_config` falls back to hardcoded defaults on any error so the judge engine is never blocked by a bad config file.

**REST endpoints** (all in `api/routes/config.py`):
- `GET /api/judge-config` — load from disk
- `GET /api/judge-config/default` — hardcoded defaults (no disk I/O)
- `POST /api/judge-config` — validate (weights must sum to 1.0 ± 0.01), save, apply/clear runtime model-tier overrides

**Frontend**: `JudgeConfigPanel.tsx` renders as a collapsible card in the left column of `OrchestratedAgents.tsx`, below `AgentEditor`. Three tabs: **Judge Prompt** | **Reward Function** | **External LLM**. Starts collapsed; loads config on first expand.

---

## Opponent Configuration (`services/opponent_config.py`)

Persists opponent system prompt, aggressiveness, and enabled response types to `backend/data/opponent_config.json`.

```python
@dataclass
class OpponentConfig:
    system_prompt: str
    aggressiveness: float = 0.7  # 0.0–1.0; maps to LLM temperature 0.3–1.0
    enabled_types: List[str]     # subset of ["rebuttal", "exploitation", "affirmative"]
    voice_id: str = ""           # TTS voice ID; "" = provider default
```

**File I/O**: Same synchronous `load_config()` / `save_config()` pattern as judge config. Atomic write-then-rename. Falls back to defaults on error.

**REST endpoints** (all in `api/routes/config.py`):
- `GET /api/opponent-config` — load from disk
- `GET /api/opponent-config/default` — hardcoded defaults (no disk I/O)
- `POST /api/opponent-config` — validate (aggressiveness 0–1, at least one enabled type), save

**Frontend**: `OpponentConfigPanel.tsx` renders as a collapsible card below `JudgeConfigPanel`. Two tabs: **Opponent Prompt** | **Strategy** (aggressiveness slider + response type checkboxes). Uses `ocp-*` CSS prefix. Starts collapsed; loads on first expand.

---

## Media Configuration (`services/media_config.py`)

Persists TTS and STT runtime settings to `backend/data/tts_config.json` and `backend/data/stt_config.json`.

```python
@dataclass
class TTSConfig:
    enabled: bool = True
    provider: str = "openai"   # "openai" | "groq"
    api_key: str = ""
    base_url: str = ""
    voice: str = "onyx"
    model: str = "tts-1"

@dataclass
class STTConfig:
    provider: str = "openai"          # "openai" | "groq" | "local"
    api_key: str = ""
    base_url: str = ""
    model: str = "gpt-4o-mini-audio-preview"
    whisper_model: str = "medium"     # local only
    device: str = "cuda"              # local only
    compute_type: str = "float16"     # local only
```

**TTS providers** (`services/tts_provider.py`): `OpenAITTSProvider`, `GroqTTSProvider` (rate-limit aware with cooldown), `CartesiaTTSProvider`. `FailoverTTSProvider` wraps these with Groq-specific rate-limit stickiness. Factory: `get_tts_provider(provider_name)`.

**STT providers** (`services/stt_provider.py`): Groq Whisper, OpenAI Whisper API, or local faster-whisper. Provider selected via `STT_PROVIDER` env var or STT config.

**REST endpoints** (all in `api/routes/config.py`):
- `GET/POST /api/tts-config`, `GET /api/tts-config/default`
- `GET/POST /api/stt-config`, `GET /api/stt-config/default`
- `GET/POST /api/model-config`, `GET /api/model-config/default`
- `GET /api/tts/voices` — available voices for the active TTS provider

**Frontend**: `SystemConfigPanel.tsx` renders as a collapsible card. Three tabs: **Models** | **TTS** | **STT**. Uses `system-config.css`.

---

## Multi-Agent Session State

Key fields in the per-session dict (stored in `MultiAgentConnectionManager.session_data` in `domain/simulation/runtime.py`):

```python
{
  "agents": List[Agent],
  "brief_summary": str,
  "transcript": str,
  "sentence_buffer": str,
  "phase": "RECORDING" | "SETUP",
  "questions_asked": List[dict],       # {agent_id, agent_name, question, color}
  "last_agent_interrupt_time": datetime | None,  # for cooldown check
  "_silence_scope": anyio.CancelScope, # cancelled when new audio arrives
  "_tg": anyio.TaskGroup,              # connection-lifetime task group
  "_eval_lock": anyio.Lock(),          # one evaluation cycle at a time
  "_tracker_lock": anyio.Lock(),       # serialises tracker.update() + MCTS state mutations
  "_last_active": float,               # monotonic timestamp; updated on every message (TTL eviction)
  "_pcm_buffer": bytes,                # PCM audio buffer for STT accumulation
  "tracker": TrajectoryTracker | None,
  "topic_map": Dict[str, dict],        # title → {agenda_id, agent_id, description}
  "addressed_titles": set[str],
  "projection_flush_count": int,
  "last_mcts_flush": int,
  "last_predicted_next": List[str],    # cached MCTS result
  "full_topic_pool": List[dict],       # complete candidate pool from all lenses (sparse MCTS expansion)
  "sparse_expanded": bool,             # True once all_topics has been expanded to full pool
  "path_so_far": List,                 # MCTS path tracking
  "frontier_titles": set,              # topic frontier for gated expansion
  "frontier_flush_count": int,         # frontier expansion counter
  "case_summary": str,                 # case context for agents
}
```

Session constants in `domain/simulation/runtime.py`:
```python
AGENT_INTERRUPT_COOLDOWN_SECONDS = 15
MIN_WORDS_BEFORE_INTERRUPT = 10
SENTENCE_BUFFER_FLUSH_WORDS = 25
SILENCE_FLUSH_TIMEOUT = 3.0
_SESSION_TTL = 3600.0   # 1 hour; idle sessions are evicted every 5 min
EXPANSION_QUALITY_THRESHOLD = 0.5  # sparse MCTS: expand topic pool when a topic hits this quality
```

---

## WebSocket Message Protocol

### Multi-agent endpoint (`/ws/multi-agent/{session_id}`)

**Client → Server:**

| type | payload |
|------|---------|
| `config` | `{agents, brief_summary, opposing_brief}` |
| `audio` | `{audio: base64_webm}` |
| `phase_change` | `{phase: "RECORDING"\|"SETUP"}` |
| `set_agenda` | `{predicted_topic_sets, agenda_items}` |
| `update_agents` | `{agents}` |

**Server → Client:**

| type | payload |
|------|---------|
| `transcript_update` | `{text}` |
| `config_ack` | `{status, agent_count}` |
| `agenda_set_ack` | `{tracker_ready, topics_indexed}` |
| `agenda_update` | `{best_prediction_id, agenda_confidences, last_human_matched_topic, predicted_next_topics, mcts_tree, regeneration_needed}` |
| `agent_question` | `{agent_id, agent_name, color, question, timestamp, audio, audio_format}` |
| `agents_updated` | `{agent_count}` |
| `argument_score` | `{speaker, clarity, legal_reasoning, responsiveness, persuasiveness, overall, feedback}` |
| `opponent_response` | `{response_type, argument, strategy_note, topic, strength, timestamp}` |
| `stt_error` | `{message}` |
| `phase_update` | `{phase}` |

---

## Audio Pipeline

1. Frontend records audio chunks via `MediaRecorder`
2. Sends as base64 over WebSocket
3. Backend decodes → STT provider transcribes (Groq Whisper API, OpenAI Whisper API, or local faster-whisper)
4. Fragment appended to `sentence_buffer`
5. On sentence boundary OR 25-word threshold → flush to transcript
6. Silence timer (3s): auto-flush remaining buffer if no new audio

STT is async — provider-dependent: API providers use async HTTP calls, local faster-whisper runs in a thread pool via `anyio.to_thread.run_sync`.

---

## Agent Evaluation Hot Path

For each flushed sentence:
1. **`tracker.update(turn)`** — sync inside `_tracker_lock`; returns `(state, refinement_args)` immediately
2. **`schedule_quality_refinement`** — fire-and-forget background task (LLM SMALL)
3. **MCTS gate check** — if word count ≥ 40 and flush_count - last_mcts_flush ≥ 3 (inside `_tracker_lock`):
   - `await anyio.to_thread.run_sync(run_projection, ...)` — threaded, ~200ms, runs **outside** the lock
4. **`agenda_update`** WebSocket message sent
5. **`check_multi_agent_questions`** — fire-and-forget:
   - Acquire `_eval_lock` (with `anyio.move_on_after(30)` timeout)
   - `anyio.create_task_group()` evaluates all agents concurrently (LLM SMALL)
   - First agent that says "yes" wins; others ignored for this turn
   - TTS synthesize question (LLM LARGE for audio)
   - Send `agent_question` WebSocket message
   - Call `tracker.state()` (non-mutating) to refresh agenda display — do NOT call `tracker.update(speaker="judge")` as that would skew confidence toward agent-favoured topics
   - Release `_eval_lock`
6. **`_fire_counter`** — fire-and-forget counter-argument (LLM LARGE)
7. **`score_argument`** — fire-and-forget argument scoring (LLM SMALL); result pushed as `argument_score` WS event

---

## Prompt Engineering Conventions

All prompts live in:
- `multi_agent/prompts.py` — agent + summary prompts
- `services/judge_engine.py` — single-judge prompts (inline; short, task-specific)
- `services/judge_config.py` — default judge system prompt + default scoring prompt template (editable at runtime via config panel)
- `projected_timeline/tracker.py` — quality assessment prompt (inline)
- `projected_timeline/timeline_generator.py` — issue extraction + agenda prompts (inline)

**Qwen3 thinking mode**: Always pass `extra_body={"chat_template_kwargs": {"enable_thinking": False}}` to disable `<think>` blocks on models that support it. Also strip any residual `<think>...</think>` blocks from responses:
```python
re.sub(r'<think>.*?</think>', '', raw, flags=re.DOTALL)
```

**Response parsing** for agent decisions: the code tries 4 strategies in order (ASK:/QUESTION: format → JSON → question mark detection → first-line yes/no). Always prefer the `ASK: yes\nQUESTION: ...` format in prompts; it's the most reliable.

---

## Agent Storage

- **Default agents**: `multi_agent/data/defaults/{id}.json` — never delete these files
- **Custom agents**: `multi_agent/data/custom/{id}_v{N}.json` — full version history
- `storage.py` handles all CRUD. Versioning is append-only (delete creates a new "deleted" version record)
- The `Agent` dataclass is defined in `multi_agent/models.py`; do not add fields without updating storage serialization

---

## Environment Variables

```bash
# Required
OPENAI_API_KEY=...             # API key for LLM provider (OpenRouter, OpenAI, etc.)
OPENAI_BASE_URL=...            # Base URL for LLM API (e.g. https://openrouter.ai/api/v1)

# Optional model tier overrides (all cascade: SMALL → LARGE if unset)
MODEL_LARGE=...                # model name for LARGE tier
MODEL_LARGE_URL=...            # base URL (default: OPENAI_BASE_URL)
MODEL_SMALL=...                # model name for SMALL tier
MODEL_SMALL_URL=...            # base URL (default: MODEL_LARGE_URL)
MODEL_TINY=...                 # model name for TINY tier
MODEL_TINY_URL=...             # base URL (default: MODEL_SMALL_URL)

# Groq (used for STT and/or TTS)
GROQ_API_KEY=...
GROQ_BASE_URL=https://api.groq.com/openai/v1

# STT
STT_PROVIDER=groq              # "groq" | "openai" | "local" (faster-whisper)
STT_BASE_URL=...               # custom STT endpoint (optional)
WHISPER_MODEL=medium           # tiny, base, small, medium, large-v3 (local only)
WHISPER_DEVICE=cuda            # cuda or cpu (local only)
WHISPER_COMPUTE_TYPE=float16   # float16, int8_float16, int8 (local only)

# TTS
TTS_PROVIDER=openai            # "openai" | "groq" | "cartesia"
TTS_API_KEY=...                # falls back to OPENAI_API_KEY for openai provider
TTS_BASE_URL=...
CARTESIA_API_KEY=...           # required when TTS_PROVIDER=cartesia

# Frontend (build-time)
VITE_USE_S3_ASSETS=true        # serve static assets from S3/CDN
VITE_ASSET_BASE_URL=...        # CDN base URL for assets
VITE_API_URL=...               # production backend URL
VITE_WS_URL=...                # production WebSocket URL

# CORS
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
```

---

## Development Rules

1. **Always use `uv run` and `uv sync`**, never bare `pip` or `python`.
2. **Use `anyio` APIs, not `asyncio.*`** for any new async code. The backend runs on trio.
3. **Never block the event loop.** CPU-bound work (MCTS, embedding) → `anyio.to_thread.run_sync`. File I/O → `aiofiles` or `anyio.to_thread.run_sync`.
4. **Always check model router config at startup.** `log_model_config()` is called in lifespan; add new tiers there too.
5. **Prompts are in dedicated files or config.** Don't embed multi-line prompt strings directly in service/handler code. The judge system prompt and scoring prompt are user-editable via `judge_config.json` — do not hardcode replacements in `judge_engine.py`.
6. **Agent defaults are sacred.** Never modify `data/defaults/*.json` at runtime; always write to `data/custom/`.
7. **Session state is in-process dicts** (in `domain/simulation/runtime.py`). For any new session field, document it in this file under "Multi-Agent Session State".
8. **MCTS must stay gated.** Do not remove `MCTS_MIN_WORDS` / `MCTS_DEBOUNCE_TURNS` guards — without them, MCTS runs on every audio chunk and blocks agent evaluation.
9. **Qwen3 thinking mode is disabled.** Every LLM call to a local model must pass `extra_body={"chat_template_kwargs": {"enable_thinking": False}}` and strip `<think>` blocks from responses. Skipping this causes the model to spend its entire token budget in `<think>` blocks and return empty responses.
10. **Quality refinement is background-only.** `schedule_quality_refinement` must never be awaited inline; always fire-and-forget.
11. **`_tracker_lock` protects shared state.** All mutations to `projection_flush_count`, `last_mcts_flush`, `addressed_titles`, and `tracker.update()` calls must be inside `async with session['_tracker_lock']`. MCTS and WebSocket sends run outside the lock.

---

## Known Issues

All tracked bugs have been resolved. The table below is kept for reference.

| Location | Issue | Status |
|----------|-------|--------|
| `model_router.py:get_client_and_model` | Model name didn't match client on tier fallback | **Fixed** — unified via `_resolve_effective_endpoint` |
| `model_router.py:_is_url_reachable` | Synchronous blocking I/O in async context | **Fixed** — async httpx probe at startup + 60 s TTL cache |
| `model_router.py:_unreachable_urls` | No TTL, servers never retried | **Fixed** — `_background_reachability_refresh` re-probes every 30 s |
| `runtime.py` | `asyncio.create_task()` under trio backend | **Fixed** — all fire-and-forget uses `tg.start_soon()` inside WebSocket task group |
| `mcts.py:_run_mcts_streaming` | `asyncio.sleep(0)` instead of `anyio.sleep(0)` | **Fixed** |
| `runtime.py:_eval_lock` | Boolean with no timeout; hung LLM → permanent block | **Fixed** — `anyio.Lock()` + `anyio.move_on_after(30)` |
| `runtime.py/_tracker.py:session_data` | No TTL/eviction | **Fixed** — 1 h TTL with `_last_active` timestamps; eviction runs every 5 min |
| `mcts.py:run_generation` / `run_projection` | Wrong return type annotations | **Fixed** — `tuple[list[...], dict]` |
| `tracker.py:_trigram_vector` | `List[float]` annotation on a `dict` return | **Fixed** — `Dict[str, float]` |
| `stt_provider.py` | `asyncio.get_event_loop().run_in_executor` under trio | **Fixed** — `anyio.to_thread.run_sync` |
| `runtime.py:connect()` | TOCTOU race: two concurrent connections could double-init session | **Fixed** — `setdefault()` for atomic init |
| `runtime.py:check_tracker_and_counter` | `projection_flush_count` / `addressed_titles` / `last_mcts_flush` mutated without lock across concurrent callers | **Fixed** — `_tracker_lock` (anyio.Lock) serialises all mutations |
| `runtime.py:MCTS` | Stale `last_mcts_flush` retained after MCTS exception, permanently skipping that turn | **Fixed** — reset to previous value in `except` block |
| `runtime.py:tracker guard` | `if not tracker` would misfire on future tracker falsy states | **Fixed** — explicit `if tracker is None` |
| `runtime.py:phase_change` | Silence-flush and phase-change flush could both process the same buffer | **Fixed** — silence scope cancelled before phase-change reads buffer |
| `runtime.py:post-interrupt tracker` | Agent questions recorded as `speaker="judge"` turns, skewing confidence | **Fixed** — use `tracker.state()` (non-mutating) after agent questions |
| `judge_engine.py` | Missing `extra_body` on all 5 LLM calls; model spent token budget in `<think>` blocks | **Fixed** — added to all calls + `<think>` stripping |
