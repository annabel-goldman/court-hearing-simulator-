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
├── main.py                          # FastAPI app + both WebSocket endpoints
├── model_router.py                  # LARGE/SMALL/TINY tier routing
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
└── services/
    ├── judge_engine.py              # Single-judge LLM logic
    ├── tts_provider.py              # TTS (OpenAI Opus, fallback empty)
    ├── stt_provider.py              # STT (local faster-whisper or OpenAI Whisper)
    └── case_ingestion.py            # PDF brief extraction (pypdf)

frontend/
├── src/pages/
│   ├── OrchestratedAgents.tsx       # Multi-judge panel page (main simulation)
│   ├── CourtroomPage.tsx            # Single-judge page
│   └── Home.tsx                    # Brief upload + landing
└── src/components/
    ├── AgentSimulation.tsx          # Recording controls + WebSocket wiring
    ├── AgentEditor.tsx              # Edit/create judge agents
    ├── AgendaPanel.tsx              # Topic coverage visualization
    ├── MCTSTreeViz.tsx              # Live MCTS tree animation
    └── QuestionFeed.tsx             # Agent questions feed
```

---

## Model Tier Routing (`model_router.py`)

Three tiers, each cascades to the next if unreachable:

| Tier | Default port | Default model | Used for |
|------|-------------|---------------|----------|
| LARGE | 8001 | Qwen3.5-35B | judge questions, counter-arguments, synthesize |
| SMALL | 8002 | Qwen3-4B | agent analysis, quality assessment, brief summary |
| TINY | 8003 | gemma-3-1b-it | issue extraction, agenda generation |

Task-to-tier map lives entirely in `TASK_TIER_MAP` in `model_router.py`. Always add new tasks there.

Env vars: `MODEL_LARGE`, `MODEL_LARGE_URL`, `MODEL_SMALL`, `MODEL_SMALL_URL`, `MODEL_TINY`, `MODEL_TINY_URL`. All cascade: if SMALL is unset it inherits LARGE.

### ⚠ Known Bug: `get_client_and_model` model name mismatch on fallback

In `model_router.py`, `get_client_and_model(tier)` re-resolves `endpoint = _resolve_tier(tier)` independently from `get_client(tier)`. When `get_client` silently falls back to LARGE (because SMALL/TINY is unreachable), the returned model name is still from the original tier's endpoint. This means the caller sends the wrong model name to the LARGE server. Fix: thread the fallback decision through a single resolution path.

### ⚠ Known Issue: `_is_url_reachable` is synchronous blocking I/O

`_is_url_reachable` uses `urllib.request.urlopen(..., timeout=1.5)` which blocks the thread/event loop for up to 1.5 seconds on the first call per URL. It is called from `get_client` which is called from every LLM call. The `_unreachable_urls` cache prevents repeated blocking, but the first miss per URL is a hard 1.5s block. Replace with async httpx check or run in thread pool for production.

### ⚠ Known Issue: `_unreachable_urls` never expires

Once a URL is marked unreachable, it stays unreachable for the process lifetime. If a model server restarts, the app won't use it again until restart. Add TTL-based expiry (e.g. retry after 60s).

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

### ⚠ Known Bug: `run_generation` / `run_projection` return type mismatch

Both functions return a **tuple** `(results, tree_snapshot)` but their type annotations say `List[...]`. Call sites unpack correctly today but this will cause confusing errors if the signatures are relied upon. Fix: update the annotations to `tuple[List[List[Dict]], dict]`.

### Tracker (`tracker.py`)
Real-time EMA confidence + topic coverage per agenda. `update(turn)` is **synchronous** (embedding + heuristic quality). Async LLM quality refinement is scheduled separately as a background task.

Key constants:
```python
LOW_CONFIDENCE_THRESHOLD = 0.25   # below this → regeneration_needed=True
EMA_ALPHA = 0.4                   # recency weight for confidence updates
QUALITY_WEAK_THRESHOLD = 0.4      # below this → topic is "weak"
```

The `_cosine` function does pure-Python element-wise dot product. For 384-dim SBERT vectors this is fine for small topic counts (~70 topics). If topic counts grow, switch to `numpy.dot`.

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
```

### ⚠ Known Issue: `_eval_lock` has no timeout

If any agent LLM call hangs indefinitely, `_eval_lock` is never released and all future agent evaluations for that session are permanently skipped. Add a timeout or use `anyio.move_on_after`.

### ⚠ Known Issue: `_SESSIONS` dict never expires

Both `main.py` (`_SESSIONS`) and `tracker.py` (`_SESSIONS`) accumulate session state forever. For long-running servers, add TTL-based eviction.

---

## WebSocket Message Protocol

### Multi-agent endpoint (`/ws/multi-agent/{session_id}`)

**Client → Server:**

| type | payload |
|------|---------|
| `config` | `{agents, brief_summary}` |
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

---

## Audio Pipeline

1. Frontend records WebM audio chunks via `MediaRecorder`
2. Sends as base64 over WebSocket
3. Backend decodes → writes to temp file → faster-whisper transcribes (GPU)
4. Fragment appended to `sentence_buffer`
5. On sentence boundary OR 25-word threshold → flush to transcript
6. Silence timer (3s): auto-flush remaining buffer if no new audio

STT is async — the transcription call is `await stt_provider.transcribe(...)` which runs faster-whisper in a thread via `asyncio.to_thread.run_in_executor` (in `stt_provider.py`). This is fine under asyncio; under trio it should use `anyio.to_thread.run_sync`.

---

## Agent Evaluation Hot Path

For each flushed sentence:
1. **`tracker.update(turn)`** — sync, returns `(state, refinement_args)` immediately
2. **`schedule_quality_refinement`** — fire-and-forget background task (LLM SMALL)
3. **MCTS gate check** — if word count ≥ 40 and flush_count - last_mcts_flush ≥ 3:
   - `await anyio.to_thread.run_sync(run_projection, ...)` — threaded, ~200ms
4. **`agenda_update`** WebSocket message sent
5. **`check_multi_agent_questions`** — fire-and-forget:
   - Acquire `_eval_lock`
   - `anyio.create_task_group()` evaluates all agents concurrently (LLM SMALL)
   - First agent that says "yes" wins; others ignored for this turn
   - TTS synthesize question (LLM LARGE for audio)
   - Send `agent_question` WebSocket message
   - Update tracker with judge turn
   - Release `_eval_lock`
6. **`_fire_counter`** — fire-and-forget counter-argument (LLM LARGE)

---

## Prompt Engineering Conventions

All prompts live in:
- `multi_agent/prompts.py` — agent + summary prompts
- `services/judge_engine.py` — judge engine prompts (inline)
- `projected_timeline/tracker.py` — quality assessment prompt (inline)
- `projected_timeline/timeline_generator.py` — issue extraction + agenda prompts (inline)

**Qwen3 thinking mode**: Always pass `extra_body={"chat_template_kwargs": {"enable_thinking": False}}` to disable `<think>` blocks on models that support it. Also add `/no_think` at the end of user prompts as a soft hint. Strip any residual `<think>...</think>` blocks from responses with:
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
3. **Never block the event loop.** CPU-bound work (MCTS, embedding) → `anyio.to_thread.run_sync`. File I/O → `aiofiles`.
4. **Always check model router config at startup.** `log_model_config()` is called in lifespan; add new tiers there too.
5. **Prompts are in dedicated files.** Don't embed multi-line prompt strings directly in service/handler code.
6. **Agent defaults are sacred.** Never modify `data/defaults/*.json` at runtime; always write to `data/custom/`.
7. **Session state is in-process dicts.** For any new session field, document it in this file under "Multi-Agent Session State".
8. **MCTS must stay gated.** Do not remove `MCTS_MIN_WORDS` / `MCTS_DEBOUNCE_TURNS` guards — without them, MCTS runs on every audio chunk and blocks agent evaluation.
9. **Qwen3 thinking mode is disabled.** Every LLM call to a local model must pass `extra_body={"chat_template_kwargs": {"enable_thinking": False}}`. Skipping this causes the model to spend its entire token budget in `<think>` blocks and return empty responses.
10. **Quality refinement is background-only.** `schedule_quality_refinement` must never be awaited inline; always fire-and-forget.

---

## Known Issues

All previously tracked bugs have been resolved. The table below is kept for reference.

| Location | Issue | Status |
|----------|-------|--------|
| `model_router.py:get_client_and_model` | Model name didn't match client on tier fallback | **Fixed** — unified via `_resolve_effective_endpoint` |
| `model_router.py:_is_url_reachable` | Synchronous blocking I/O in async context | **Fixed** — async httpx probe at startup + 60 s TTL cache |
| `model_router.py:_unreachable_urls` | No TTL, servers never retried | **Fixed** — `_background_reachability_refresh` re-probes every 30 s |
| `main.py` | `asyncio.create_task()` under trio backend | **Fixed** — all fire-and-forget uses `tg.start_soon()` inside WebSocket task group |
| `mcts.py:_run_mcts_streaming` | `asyncio.sleep(0)` instead of `anyio.sleep(0)` | **Fixed** |
| `main.py:_eval_lock` | Boolean with no timeout; hung LLM → permanent block | **Fixed** — `anyio.Lock()` + `anyio.move_on_after(30)` |
| `main.py/_tracker.py:_SESSIONS` | No TTL/eviction | **Fixed** — 1 h TTL with eviction on access |
| `mcts.py:run_generation` / `run_projection` | Wrong return type annotations | **Fixed** — `tuple[list[...], dict]` |
| `tracker.py:_trigram_vector` | `List[float]` annotation on a `dict` return | **Fixed** — `Dict[str, float]` |
| `stt_provider.py` | `asyncio.get_event_loop().run_in_executor` under trio | **Fixed** — `anyio.to_thread.run_sync` |
