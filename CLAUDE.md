# Court Hearing Simulator — CLAUDE.md

Codebase and development instructions for Claude Code. Follow these instructions exactly.

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
| LLM inference | Local llama-server (OpenAI-compatible, 3 ports) |
| STT | faster-whisper (local GPU) or OpenAI Whisper API |
| TTS | OpenAI TTS (opus format) or local compatible endpoint |
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
├── main.py                          # FastAPI app + both WebSocket endpoints + REST API
├── model_router.py                  # LARGE/SMALL/TINY tier routing + runtime overrides
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
│   ├── tts_provider.py              # TTS (OpenAI Opus, fallback empty)
│   ├── stt_provider.py              # STT (local faster-whisper or OpenAI Whisper)
│   └── case_ingestion.py            # PDF brief extraction (pypdf)
└── data/
    ├── judge_config.json            # Persisted judge config (auto-created on first save)
    └── opponent_config.json         # Persisted opponent config (auto-created on first save)

frontend/
├── src/pages/
│   ├── OrchestratedAgents.tsx       # Multi-judge panel page (main simulation)
│   ├── CourtroomPage.tsx            # Single-judge page
│   └── Home.tsx                    # Brief upload + landing
├── src/orchestrated-agents/
│   ├── AgendaPanel.tsx              # Topic coverage visualization
│   ├── CounterArgumentFeed.tsx      # Counter-argument display
│   ├── OpponentFeed.tsx             # Opposing counsel response display
│   ├── OpponentConfigPanel.tsx      # Collapsible opponent config panel (2 tabs)
│   ├── MCTSTreeViz.tsx              # Live MCTS tree animation
│   ├── JudgeConfigPanel.tsx         # Collapsible judge config panel (3 tabs)
│   ├── judge-config.css             # Styles for JudgeConfigPanel (jcp-* prefix)
│   ├── opponent-config.css          # Styles for OpponentConfigPanel (ocp-* prefix)
│   └── agenda.css                  # Styles for agenda/MCTS viz + layout (oa-* prefix)
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

Env vars: `MODEL_LARGE`, `MODEL_LARGE_URL`, `MODEL_SMALL`, `MODEL_SMALL_URL`, `MODEL_TINY`, `MODEL_TINY_URL`. All cascade: if SMALL is unset it inherits LARGE.

### Runtime overrides

`model_router._runtime_overrides` is a dict that maps `ModelTier → ModelEndpoint` and takes priority over env-var resolution and reachability fallback. Set via `apply_runtime_override(tier, base_url, model, api_key)` and cleared with `clear_runtime_override(tier)`. Used by the Judge Configuration Panel to route to external OpenAI-compatible APIs (OpenAI, Groq, OpenRouter, etc.) without restarting the server.

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

### MCTS — Topic Sequencing
- **Generation mode** (`run_generation`, n_sims=800): build agendas from scratch during setup
- **Projection mode** (`run_projection`, n_sims=150): live prediction of next topics during hearing

MCTS runs in a thread pool via `anyio.to_thread.run_sync()` — never blocks the event loop.

Gate constants (in `main.py`):
```python
MCTS_MIN_WORDS = 40        # don't run until advocate has spoken 40+ words
MCTS_DEBOUNCE_TURNS = 3    # only re-run every 3rd sentence flush
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

**REST endpoints** (all in `main.py`):
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
    aggressiveness: float       # 0.0–1.0; maps to LLM temperature 0.3–1.0
    enabled_types: List[str]    # subset of ["rebuttal", "exploitation", "affirmative"]
```

**File I/O**: Same synchronous `load_config()` / `save_config()` pattern as judge config. Atomic write-then-rename. Falls back to defaults on error.

**REST endpoints** (all in `main.py`):
- `GET /api/opponent-config` — load from disk
- `GET /api/opponent-config/default` — hardcoded defaults (no disk I/O)
- `POST /api/opponent-config` — validate (aggressiveness 0–1, at least one enabled type), save

**Frontend**: `OpponentConfigPanel.tsx` renders as a collapsible card below `JudgeConfigPanel`. Two tabs: **Opponent Prompt** | **Strategy** (aggressiveness slider + response type checkboxes). Uses `ocp-*` CSS prefix. Starts collapsed; loads on first expand.

---

## Multi-Agent Session State

Key fields in the per-session dict (stored in `_SESSIONS` in `main.py`):

```python
{
  "agents": List[Agent],
  "brief_summary": str,
  "transcript": str,
  "sentence_buffer": str,
  "phase": "RECORDING" | "SETUP",
  "questions_asked": List[dict],       # {agent_id, question, audio, timestamp, ...}
  "last_interrupt_time": float,        # for cooldown check
  "_silence_scope": anyio.CancelScope, # cancelled when new audio arrives
  "_tg": anyio.TaskGroup,              # connection-lifetime task group
  "_eval_lock": anyio.Lock(),          # one evaluation cycle at a time
  "_tracker_lock": anyio.Lock(),       # serialises tracker.update() + MCTS state mutations
  "_last_active": float,               # monotonic timestamp; updated on every message (TTL eviction)
  "tracker": TrajectoryTracker | None,
  "topic_map": Dict[str, dict],        # title → {agenda_id, agent_id, description}
  "addressed_titles": set[str],
  "projection_flush_count": int,
  "last_mcts_flush": int,
  "last_predicted_next": List[str],    # cached MCTS result
}
```

Session constants in `main.py`:
```python
AGENT_INTERRUPT_COOLDOWN_SECONDS = 15
MIN_WORDS_BEFORE_INTERRUPT = 10
SENTENCE_BUFFER_FLUSH_WORDS = 25
SILENCE_FLUSH_TIMEOUT = 3.0
_SESSION_TTL = 3600.0   # 1 hour; idle sessions are evicted every 5 min
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
| `agent_counter_argument` | `{agent_id, agent_name, color, topic, counter_argument, timestamp}` |
| `agents_updated` | `{agent_count}` |
| `argument_score` | `{speaker, clarity, legal_reasoning, responsiveness, persuasiveness, overall, feedback}` |
| `opponent_response` | `{response_type, argument, strategy_note, topic, strength, timestamp}` |

---

## Audio Pipeline

1. Frontend records WebM audio chunks via `MediaRecorder`
2. Sends as base64 over WebSocket
3. Backend decodes → writes to temp file → faster-whisper transcribes (GPU)
4. Fragment appended to `sentence_buffer`
5. On sentence boundary OR 25-word threshold → flush to transcript
6. Silence timer (3s): auto-flush remaining buffer if no new audio

STT is async — `stt_provider.transcribe(...)` runs faster-whisper in a thread pool via `anyio.to_thread.run_sync`.

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
OPENAI_API_KEY=local           # or real key; "local" signals local llama-server

# Optional model tier overrides (all cascade: SMALL → LARGE if unset)
OPENAI_BASE_URL=http://localhost:8001/v1
MODEL_LARGE=Qwen3.5-35B-A3B
MODEL_LARGE_URL=http://localhost:8001/v1
MODEL_SMALL=Qwen3-4B
MODEL_SMALL_URL=http://localhost:8002/v1
MODEL_TINY=gemma-3-1b-it
MODEL_TINY_URL=http://localhost:8003/v1

# STT
STT_PROVIDER=local             # "local" (faster-whisper) or "openai"
WHISPER_MODEL=medium           # tiny, base, small, medium, large-v3
WHISPER_DEVICE=cuda            # cuda or cpu
WHISPER_COMPUTE_TYPE=float16   # float16, int8_float16, int8

# TTS (optional override; falls back to OPENAI_API_KEY)
TTS_API_KEY=...
TTS_BASE_URL=...

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
7. **Session state is in-process dicts.** For any new session field, document it in this file under "Multi-Agent Session State".
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
| `main.py` | `asyncio.create_task()` under trio backend | **Fixed** — all fire-and-forget uses `tg.start_soon()` inside WebSocket task group |
| `mcts.py:_run_mcts_streaming` | `asyncio.sleep(0)` instead of `anyio.sleep(0)` | **Fixed** |
| `main.py:_eval_lock` | Boolean with no timeout; hung LLM → permanent block | **Fixed** — `anyio.Lock()` + `anyio.move_on_after(30)` |
| `main.py/_tracker.py:_SESSIONS` | No TTL/eviction | **Fixed** — 1 h TTL with `_last_active` timestamps; eviction runs every 5 min |
| `mcts.py:run_generation` / `run_projection` | Wrong return type annotations | **Fixed** — `tuple[list[...], dict]` |
| `tracker.py:_trigram_vector` | `List[float]` annotation on a `dict` return | **Fixed** — `Dict[str, float]` |
| `stt_provider.py` | `asyncio.get_event_loop().run_in_executor` under trio | **Fixed** — `anyio.to_thread.run_sync` |
| `main.py:connect()` | TOCTOU race: two concurrent connections could double-init session | **Fixed** — `setdefault()` for atomic init |
| `main.py:check_tracker_and_counter` | `projection_flush_count` / `addressed_titles` / `last_mcts_flush` mutated without lock across concurrent callers | **Fixed** — `_tracker_lock` (anyio.Lock) serialises all mutations |
| `main.py:MCTS` | Stale `last_mcts_flush` retained after MCTS exception, permanently skipping that turn | **Fixed** — reset to previous value in `except` block |
| `main.py:tracker guard` | `if not tracker` would misfire on future tracker falsy states | **Fixed** — explicit `if tracker is None` |
| `main.py:phase_change` | Silence-flush and phase-change flush could both process the same buffer | **Fixed** — silence scope cancelled before phase-change reads buffer |
| `main.py:post-interrupt tracker` | Agent questions recorded as `speaker="judge"` turns, skewing confidence | **Fixed** — use `tracker.state()` (non-mutating) after agent questions |
| `judge_engine.py` | Missing `extra_body` on all 5 LLM calls; model spent token budget in `<think>` blocks | **Fixed** — added to all calls + `<think>` stripping |
