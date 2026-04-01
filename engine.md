# Engine Reference — Judge, Opponent, and MCTS

Deep technical reference for the three core simulation engines. Use this to understand how the systems work before making manual improvements.

---

## Table of Contents

1. [High-Level Data Flow](#high-level-data-flow)
2. [Judge Engine](#judge-engine)
3. [Opponent Engine](#opponent-engine)
4. [MCTS Topic Sequencer](#mcts-topic-sequencer)
5. [Trajectory Tracker](#trajectory-tracker)
6. [Integration: The Hot Path](#integration-the-hot-path)
7. [Weight and Signal Reference](#weight-and-signal-reference)
8. [Tuning Guide](#tuning-guide)

---

## High-Level Data Flow

```
Student speaks
  │
  ▼
STT → sentence_buffer
  │
  ▼ (on sentence boundary or 25-word threshold or 3s silence)
Flush
  │
  ├──▶ check_tracker_and_counter()        [awaited — fast, synchronous tracker + gated MCTS]
  │      ├── tracker.update(turn)          → heuristic quality score (sync)
  │      ├── schedule_quality_refinement   → LLM quality score (fire-and-forget, SMALL tier)
  │      ├── _expand_frontier_if_ready()   → gated frontier expansion
  │      ├── MCTS projection (if gated)    → predicted next topics (thread pool)
  │      ├── agenda_update WS message
  │      └── _fire_all_counters()          → counter-arguments from all agents (fire-and-forget)
  │
  ├──▶ check_multi_agent_questions()       [fire-and-forget — heavy, LLM-bound]
  │      ├── N agents evaluated in parallel (SMALL tier)
  │      ├── _select_best_question()       → TINY tier picks winner
  │      ├── TTS synthesis (winner only)
  │      └── agent_question WS message
  │
  ├──▶ score_argument()                    [fire-and-forget — SMALL tier]
  │      └── argument_score WS message
  │
  └──▶ opponent.generate_response()        [fire-and-forget — SMALL tier]
         └── opponent_response WS message (suppressed if judge fired this turn)
```

All fire-and-forget tasks use the WebSocket connection's `_tg` task group and are auto-cancelled on disconnect.

---

## Judge Engine

**File**: `backend/services/judge_engine.py`
**Model tier**: SMALL (`"argument_scoring"` task)

### What it does

Scores every flushed utterance from the advocate on configurable dimensions (default: clarity, legal_reasoning, responsiveness, persuasiveness). Returns an `ArgumentScore` with per-dimension scores (0–10), a weighted `overall`, and a one-sentence `feedback` coaching note.

### How scoring works

1. Load `JudgeConfig` from disk (30s TTL cache via `_get_cached_judge_config()`).
2. Build a prompt from the config's `scoring_prompt_template`, dynamically inserting:
   - Dimension names + descriptions (from `reward_dimensions`)
   - Weighted average formula (e.g. `clarity×0.25 + legal_reasoning×0.35 + ...`)
   - Example JSON shape with all dimension field names
   - Case context: brief summary (first 400 chars), current topic, judge question being answered
3. Call the SMALL-tier LLM with `temperature=0.3`, `max_tokens=250`.
4. Parse JSON response — strips markdown fences, extracts first `{...}` block.
5. Store in per-session `_SessionContext.argument_scores` dict keyed by speaker.

### Scoring dimensions

Dimensions are **fully configurable** at runtime via the Judge Config Panel:

```python
@dataclass
class RewardDimension:
    name: str          # field name in JSON response
    weight: float      # 0–1, all must sum to 1.0
    description: str   # guides the LLM on what to evaluate
```

Default dimensions:
| Dimension | Weight | What it measures |
|-----------|--------|------------------|
| clarity | 0.20 | Clear, organized presentation |
| legal_reasoning | 0.35 | Quality of legal analysis and authority |
| responsiveness | 0.25 | How directly it addresses the question/topic |
| persuasiveness | 0.20 | Rhetorical force and conviction |

The `overall` score is always taken from the LLM response (which computes the weighted average itself), not calculated in Python.

### Key limitations

- **`ArgumentScore` fields are hardcoded** to `clarity`, `legal_reasoning`, `responsiveness`, `persuasiveness`. If you add a 5th dimension in the config, the LLM will score it but the Python dataclass won't store it — only `overall` and `feedback` are dynamic. The hardcoded fields fall back to 5.0 if missing from the LLM response.
- **No argument history context**: each utterance is scored independently. The LLM doesn't see previous scores or the overall trajectory.
- **Min 5 words**: utterances shorter than 5 words are silently skipped (returns `None`).
- **No opponent scoring link**: the judge engine and opponent engine don't share state. The opponent's arguments are not scored by the judge engine.

### Config caching

`_judge_cfg_cache` is a module-level dict with a 30s TTL. Changes saved via the REST endpoint are picked up within 30s without restart.

---

## Opponent Engine

**File**: `backend/services/opponent_engine.py`
**Model tier**: SMALL (`"opponent_response"` task)

### What it does

Generates adaptive opposing counsel responses. The opponent has access to the respondent's brief and adapts its strategy based on three signal sources:

1. **Advocate's latest argument** — direct rebuttal
2. **Judge questions** — exploit weaknesses the panel identified
3. **Trajectory context** — press on weak/uncovered topics from the tracker

### Response types

| Type | When used | Purpose |
|------|-----------|---------|
| `rebuttal` | Default | Directly counter what the petitioner just said |
| `exploitation` | When judge questions reveal weakness | Leverage a gap the judge probed |
| `affirmative` | When petitioner misses topics | Proactively argue a point from the brief |

Each type can be individually enabled/disabled via `OpponentConfig.enabled_types`. If the LLM generates a disabled type, the response is silently discarded.

### Per-session state (`OpponentState`)

```python
opposing_brief: str          # full opposing brief text (source of authority)
brief_summary: str           # judicial summary of both briefs
arguments_made: List         # all responses generated this session
topics_pressed: List[str]    # topics the opponent has addressed
judge_questions: List[str]   # all judge questions (for exploitation)
rebutted_topics: set         # dedup: don't rebut the same topic twice
```

### Prompt structure

The prompt (`_build_rebuttal_prompt`) concatenates:
1. **Opposing brief** (first 3000 chars) — the opponent's source of authority
2. **Case summary** (first 600 chars) — shared context
3. **Petitioner's argument** (first 800 chars) — what to counter
4. **Recent judge questions** (last 5) — weaknesses to exploit
5. **Previous arguments** (last 5, first 100 chars each) — avoid repetition
6. **Trajectory context** — weak_topics (press hard) + uncovered_topics (highlight gaps)

### Aggressiveness mapping

`OpponentConfig.aggressiveness` (0.0–1.0) maps to LLM temperature:
```
temperature = 0.3 + aggressiveness × 0.7
```
- **0.0** → temperature 0.3 (cautious, conservative responses)
- **0.5** → temperature 0.65 (moderate)
- **1.0** → temperature 1.0 (aggressive, creative arguments)

### Suppression logic

The opponent is **suppressed** when a judge question fires in the same turn cycle. The pipeline snapshots `len(questions_asked)` before generating, then re-checks after. If the count increased (a judge asked a question while the opponent was generating), the response is discarded — this prevents the opponent from talking over the bench.

### Opponent ↔ MCTS feedback loop

The opponent engine feeds back into MCTS via `_build_opponent_bonus_map()`:
1. Collects all opponent responses with their topic strings and strength scores.
2. Embeds opponent topic strings and pool topic titles.
3. For each pool topic, finds the best-matching opponent topic by cosine similarity (threshold ≥ 0.4).
4. Bonus = `0.15 × (strength / 10)` — topics the opponent pressed become hotter in MCTS projections.

This creates a dynamic loop: opponent presses a topic → MCTS prioritizes it → judges probe it → advocate must address it.

### Key limitations

- **Min 8 words**: short utterances are skipped.
- **No opponent-to-opponent memory**: the opponent doesn't track what the advocate said in *response* to its arguments — only what the advocate said in general.
- **Dedup is topic-level**: `rebutted_topics` prevents rebutting the *same topic* but not the same *argument angle* on a different topic.
- **Brief truncation at 3000 chars**: long briefs lose context.

---

## MCTS Topic Sequencer

**File**: `backend/projected_timeline/mcts.py`
**Runtime integration**: `backend/domain/simulation/runtime.py`

### Purpose

Predicts the sequence of legal topics the hearing will cover. Runs in two modes:

1. **Generation mode** — at hearing setup, builds initial agenda paths from the full topic pool
2. **Projection mode** — during the hearing, predicts what topics come next given current coverage

### Core algorithm

Standard UCB1 Monte Carlo Tree Search with epsilon-greedy rollouts:

```
repeat n_sims times:
    1. SELECT    — walk tree via UCB1 until a non-fully-expanded node
    2. EXPAND    — pop one untried topic, create child node
    3. ROLLOUT   — epsilon-greedy simulation to fill remaining path
    4. BACKPROP  — propagate score up to root
```

**UCB1 formula**:
```
ucb1 = avg_value + exploration × √(ln(parent_visits) / visits)
```
Default exploration constant: `√2`

### Node structure

Each node represents an ordered sequence of topics addressed so far:
```python
state: tuple[str, ...]   # topic titles in path order (root = empty or path_so_far)
parent: _Node | None
children: Dict[str, _Node]  # action (topic title) → child node
visits: int
value: float              # cumulative score from rollouts
_untried: List[str]       # topics not yet tried as children
```

### Value function (`_score_sequence`)

Scores an ordered sequence of topic titles. All components are embedding-based (no LLM calls during simulation):

```
score = mean_consecutive_cosine      (thematic flow between adjacent topics)
      + coverage_bonus               (fraction of total topics covered)
      + exploitability_bonus         (sum of per-topic exploitability weights)
      + opponent_bonus               (topics opponent pressed, scaled by strength)
      + initial_buff                 (one-shot bonus for first topic at hearing start)
      + lens_continuity              (bonus for consecutive same-lens topics)
      + quality_adjustments          (dynamic: uncovered bonus, weak bonus, strong penalty)
```

#### Component breakdown

| Component | Formula | Purpose |
|-----------|---------|---------|
| mean_consecutive_cosine | `Σ cosine(topic[i], topic[i+1]) / n_pairs` | Reward smooth thematic transitions |
| coverage_bonus | `0.1 × (path_length / total_topics)` | Prefer longer paths |
| exploitability | `Σ 0.08 × exploitability[topic]` | Prefer topics with higher vulnerability |
| opponent_bonus | `Σ opponent_bonus[topic]` | Prefer topics the opponent pressed |
| initial_buff | `initial_buff[topic]` (0.25 for one randomly chosen top-5 topic) | Break symmetry at hearing start |
| lens_continuity | `0.06` per consecutive same-lens pair | Reward staying within a judicial lens |
| quality: uncovered | `0.08 + 0.04 × min(covered_count, 10)` per uncovered topic | Increasingly prioritize remaining gaps |
| quality: weak (q < 0.4) | `+0.05` | Revisit weakly-argued topics |
| quality: strong (q > 0.7) | `−0.03` | Deprioritize well-covered topics |

#### Rollout policy (`_rollout`)

Epsilon-greedy with `ε = 0.25`:
- **75% of the time**: pick the topic that maximizes a composite pick score:
  ```
  pick_score = cosine(last_topic, candidate)
             + 0.12 × exploitability[candidate]
             + opponent_bonus[candidate]
             + initial_buff[candidate]
             + 0.06 if same_lens
             + quality bonus/penalty
  ```
- **25% of the time**: random pick (exploration)

The rollout extends the path until all topics are used (or `max_steps` reached), then scores the full sequence via `_score_sequence`.

### Generation mode (`run_generation`)

Called once during hearing setup:

```python
run_generation(
    topic_pool,            # all candidate topics with title/description
    n_sims=800,            # simulation count
    top_k=10,              # return this many distinct paths
    max_depth=2,           # SPARSE: limit path length (set by caller)
    exploitability_map,    # title → float from Phase 1 brief analysis
)
```

1. Embeds all topics via `_prepare_pool()` (sentence-transformers or TF-IDF fallback).
2. Runs `_run_mcts` with `max_depth=2` (shallow — only first 2 topics per path).
3. Collects all leaf nodes, sorted by average value.
4. Deduplicates and returns top-k paths.
5. Serializes tree for frontend visualization.

**Why max_depth=2**: This is the "sparse MCTS" strategy. Building full-depth agendas (~50-70 topics) with 800 sims produces garbage paths because the branching factor is too high. Depth-2 paths identify the best *starting pairs* — the full pool is preserved separately for live projection.

### Projection mode (`run_projection`)

Called during the hearing, gated by `MCTS_MIN_WORDS` and `MCTS_DEBOUNCE_TURNS`:

```python
run_projection(
    remaining,        # frontier topics (not yet addressed, within gate)
    n_sims=150,       # fewer sims — must be fast
    weights,          # MCTSWeights with all live signals
    path_so_far,      # ordered tuple of topics already addressed
    path_vecs,        # pre-computed embeddings for path topics
)
```

Key differences from generation:
- **Root is seeded** with `path_so_far` — cosine flow computes from the last addressed topic
- **No depth limit** — projection explores the full remaining frontier
- **`remaining` is focused** to `PROJECTION_TOP_K=6` topics (sorted by exploitability) to keep projections fast
- **Returns ranked topics** by visit count (most-visited child = most likely next topic)

### Gated frontier system

The full topic pool (~50-70 topics) is NOT given to MCTS all at once. Instead:

1. **Initial frontier**: top `FRONTIER_BATCH_SIZE × 2 = 6` topics by exploitability.
2. **Expansion triggers** (checked each flush inside `_tracker_lock`):
   - Current topic quality ≥ `FRONTIER_QUALITY_GATE (0.3)`, OR
   - Enough flushes spent on topic ≥ `FRONTIER_MIN_FLUSHES (2)`, OR
   - A judge agent asked a question on this topic
3. **One expansion per topic**: once a topic triggers expansion, it won't trigger again.
4. **Expansion adds** `FRONTIER_BATCH_SIZE = 3` new topics, sorted by exploitability + lens continuity with the current topic.

The frontier ensures MCTS operates on a focused set of ~6-12 topics rather than the full pool, keeping projections fast and meaningful.

### Projection quality gate

MCTS projection only runs when the current topic's quality ≥ `PROJECTION_QUALITY_GATE (0.85)`. This prevents premature predictions while the student is still mid-argument:

```python
current_topic_quality = quality_map.get(path_so_far[-1], 0.0)
topic_ready = current_topic_quality >= PROJECTION_QUALITY_GATE  # 0.85
```

### `MCTSWeights` consolidation

All weight maps are bundled in a single dataclass to avoid threading many kwargs:

```python
@dataclass
class MCTSWeights:
    exploitability: Dict[str, float]     # title → 0-1 (from brief analysis + live updates)
    quality: Dict[str, float] | None     # title → 0-1 (from tracker, addressed topics only)
    opponent_bonus: Dict[str, float]     # title → bonus (from opponent engine)
    initial_buff: Dict[str, float]       # title → 0.25 (one topic, only before any addressed)
    lens_map: Dict[str, str]             # title → lens name
    last_path_lens: str | None           # lens of last addressed topic
    covered_count: int                   # number of addressed topics (scales uncovered bonus)
```

### Dynamic weight updates (`_update_topic_weights`)

Called before each MCTS projection. Mutates `all_topics[i]["exploitability"]` in-place:

| Condition | Delta | Rationale |
|-----------|-------|-----------|
| Addressed + quality < 0.3 | +0.04 | Weak argument → judge returns to probe |
| Addressed + quality > 0.7 | −0.03 | Strong coverage → deprioritize |
| Unaddressed + opponent pressure | +opp×0.4 | Opponent pressed → hotter topic |
| Unaddressed + touched but weak (q < 0.4) | +0.03 | Underdeveloped argument |
| Completely untouched (q is None) | +0.012 | Urgency accumulates per flush |

All weights are clamped to `[0.1, 1.0]`.

### Streaming mode (`run_generation_streaming`)

Async version used by the SSE endpoint. Yields to the event loop every `yield_every=10` simulations so expansion events can be streamed to the frontend for live tree animation. Uses a stable `_seq` dict mapping `id(node) → sequential_id` so the frontend can assign consistent positions.

---

## Trajectory Tracker

**File**: `backend/projected_timeline/tracker.py`

### What it does

Real-time topic coverage tracker. Maps live speech to predicted topics using embedding similarity, maintains per-agenda confidence scores via EMA, and detects when regeneration is needed.

### Embedding backend

- **Primary**: sentence-transformers `all-MiniLM-L6-v2` (lazy-loaded, thread-safe via `_embed_lock`)
- **Fallback**: TF-IDF character trigram vectors (when sentence-transformers not installed)

All topic texts are embedded once at tracker creation (`__init__`). Utterances are embedded on each `update()` call.

### Per-agenda state (`_AgendaState`)

```python
prediction: TopicPrediction     # the agenda (lens + ordered topics)
topic_vectors: List             # pre-computed embeddings, one per topic
confidence: float               # starts at 0.5, updated via EMA
coverage: Dict[int, bool]       # order → addressed?
coverage_turn: Dict[int, int]   # order → turn when first addressed
quality: Dict[int, float]       # order → quality score 0.0–1.0 (monotonically increasing)
```

### Turn processing

**Judge turns** (`speaker="judge"`):
- Update confidence for ALL agendas using EMA:
  ```
  confidence = (1 - α) × confidence + α × max_topic_similarity
  ```
  where `max_topic_similarity` is the highest cosine similarity between the utterance and any topic in that agenda. `α = 0.4`.

**Human turns** (`speaker="petitioner"`):
1. Find the single best-matching topic across ALL agendas (highest cosine similarity).
2. If similarity > 0.1:
   - Compute heuristic quality immediately (sync — never blocks).
   - Mark topic as addressed via `mark_addressed(order, turn, quality)`.
   - Boost that agenda's confidence: `confidence += α × 0.3` (capped at 1.0).
   - Set `_last_human_matched` for the WS message.
3. Return `refinement_args` so the caller can schedule async LLM quality refinement.

### Quality scoring (two-tier)

**Tier 1 — Heuristic** (synchronous, always runs):
```
base = f(word_count)              # 0.15 / 0.3 / 0.5 / 0.65
+ keyword_bonus                   # 0.05 per topic-keyword found (max 0.15)
+ legal_signal_bonus              # 0.05 per signal phrase (max 0.20)
```
Legal signal phrases: "because", "therefore", "court held", "precedent", "under the statute", "standard of review", etc.

**Tier 2 — LLM** (async, fire-and-forget via `schedule_quality_refinement`):
- Uses SMALL tier (`"quality_assessment"` task).
- Prompt asks for a 0.0–1.0 score with rubric:
  - 0.0 = not addressed
  - 0.4 = basic mention, weak reasoning
  - 0.6 = reasonable but missing authority
  - 0.8 = strong argument with citations
  - 1.0 = compelling, complete
- Quality can only go UP — `mark_addressed` uses `max(old_quality, new_quality)`.

### Regeneration trigger

If the best agenda's confidence drops below `LOW_CONFIDENCE_THRESHOLD = 0.25`, `regeneration_needed=True` is set in the state response. The frontend can use this to trigger Phase 1+2 re-generation with updated transcript context.

### Important: `state()` vs `update()`

- `update(turn)` — advances turn counter, processes the turn, returns `(state, refinement_args)`
- `state()` — reads current state WITHOUT advancing turn counter or processing anything

After agent questions, always use `state()` (non-mutating). Recording agent questions as judge turns would skew confidence toward agent-favoured topics.

---

## Integration: The Hot Path

### Full flush cycle (`_process_ma_transcript` → `check_tracker_and_counter`)

Inside `_tracker_lock`:
1. `tracker.update()` — sync embedding + heuristic quality
2. Update `addressed_titles` + `path_so_far` if new topic matched
3. Sparse MCTS expansion check (one-time: when any quality ≥ 0.5)
4. Gated frontier expansion check
5. Build `remaining` from frontier (only frontier topics that aren't addressed)
6. MCTS gate check: `remaining ≥ 2 AND topic_ready AND (just_expanded OR word ≥ 40 AND debounce ≥ 3)`
7. If gating passes, mark `last_mcts_flush` optimistically

Outside lock:
8. Schedule quality refinement (fire-and-forget)
9. Run MCTS projection in thread pool (if gate passed)
10. Send `agenda_update` WS message
11. Fire counter-arguments (fire-and-forget)

### Agent question pipeline (`check_multi_agent_questions`)

Pre-checks (no lock):
- Phase must be RECORDING
- Word count ≥ 10
- Cooldown not active (pre-lock check avoids unnecessary lock contention)

Inside `_eval_lock` (60s timeout):
1. Re-check cooldown (another task may have fired between pre-check and lock)
2. Evaluate ALL agents in parallel via `anyio.create_task_group()`
3. Early-exit: once first agent says "yes", start 5s grace timer. Cancel remaining if 3+ say yes.
4. `_select_best_question()` via TINY model (8s timeout, falls back to random)
5. Set `last_agent_interrupt_time` inside lock

Outside lock:
6. TTS synthesis for winner
7. Send `agent_question` WS messages
8. Record question in opponent engine
9. Refresh agenda panel via `tracker.state()`

### Concurrency diagram

```
                    ┌─────────────────────────────────────┐
                    │         _tracker_lock                │
                    │  tracker.update + MCTS gate + state  │
                    └────────────┬────────────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
      quality refinement    MCTS projection    agenda_update WS
      (fire-and-forget)     (thread pool)      (after MCTS)
              │                  │
              └───── both outside lock ──────┘

                    ┌─────────────────────────────────────┐
                    │          _eval_lock                  │
                    │  agent eval + best selection + mark  │
                    └────────────┬────────────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
         TTS synthesis    agent_question WS    opponent.record_q
         (outside lock)   (outside lock)       (outside lock)
```

---

## Weight and Signal Reference

### All constants in one place

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `MCTS_MIN_WORDS` | 40 | runtime.py | Don't run MCTS until 40+ words spoken |
| `MCTS_DEBOUNCE_TURNS` | 3 | runtime.py | Re-run MCTS every 3rd flush |
| `EXPANSION_QUALITY_THRESHOLD` | 0.5 | runtime.py | Sparse → full pool expansion trigger |
| `FRONTIER_BATCH_SIZE` | 3 | runtime.py | Topics added per frontier expansion |
| `FRONTIER_QUALITY_GATE` | 0.3 | runtime.py | Min quality to expand frontier |
| `FRONTIER_MIN_FLUSHES` | 2 | runtime.py | Min flushes to expand frontier |
| `PROJECTION_TOP_K` | 6 | runtime.py | Max topics fed to MCTS projection |
| `PROJECTION_QUALITY_GATE` | 0.85 | runtime.py | Min quality before projection runs |
| `AGENT_EVAL_GRACE_SECONDS` | 5.0 | runtime.py | Grace period after first "yes" |
| `AGENT_EVAL_MIN_CANDIDATES` | 3 | runtime.py | Cancel remaining evals at this count |
| `AGENT_INTERRUPT_COOLDOWN_SECONDS` | 15 | runtime.py | Hard cooldown between interrupts |
| `MIN_WORDS_BEFORE_INTERRUPT` | 10 | runtime.py | Min words before any agent can fire |
| `SENTENCE_BUFFER_FLUSH_WORDS` | 25 | runtime.py | Force flush at this word count |
| `SILENCE_FLUSH_TIMEOUT` | 3.0 | runtime.py | Seconds of silence before auto-flush |
| `_SESSION_TTL` | 3600 | runtime.py | 1 hour idle session eviction |
| `LOW_CONFIDENCE_THRESHOLD` | 0.25 | tracker.py | Below → regeneration_needed=True |
| `EMA_ALPHA` | 0.4 | tracker.py | EMA recency weight |
| `QUALITY_WEAK_THRESHOLD` | 0.4 | tracker.py | Below → topic is "weak" |
| `_ROLLOUT_EPSILON` | 0.25 | mcts.py | Random pick probability in rollout |
| `_JUDGE_CFG_TTL` | 30 | judge_engine.py | Config reload interval (seconds) |
| `_OPP_CFG_TTL` | 30 | opponent_engine.py | Config reload interval (seconds) |

### MCTS value function weights (hardcoded in `mcts.py`)

| Signal | Magnitude | Where applied |
|--------|-----------|---------------|
| Cosine flow (consecutive topics) | mean across pairs | _score_sequence |
| Coverage bonus | 0.1 × fraction | _score_sequence |
| Exploitability per topic | 0.08 × weight | _score_sequence |
| Opponent bonus per topic | raw bonus value | _score_sequence |
| Initial buff | 0.25 for one topic | _score_sequence |
| Lens continuity | 0.06 per pair | _score_sequence |
| Uncovered topic bonus | 0.08 + 0.04 × min(covered, 10) | _score_sequence |
| Weak topic bonus (q < 0.4) | 0.05 | _score_sequence |
| Strong topic penalty (q > 0.7) | −0.03 | _score_sequence |
| Rollout exploitability pull | 0.12 × weight | _rollout |
| Rollout uncovered bonus | 0.15 + 0.06 × min(covered, 10) | _rollout |
| Rollout weak bonus (q < 0.4) | 0.08 | _rollout |

### Dynamic weight mutation (`_update_topic_weights`)

| Condition | Delta per flush | Clamp |
|-----------|-----------------|-------|
| Addressed + quality < 0.3 | +0.04 | [0.1, 1.0] |
| Addressed + quality > 0.7 | −0.03 | [0.1, 1.0] |
| Unaddressed + opponent pressure | +opp_bonus × 0.4 | [0.1, 1.0] |
| Unaddressed + touched weak (q < 0.4) | +0.03 | [0.1, 1.0] |
| Completely untouched | +0.012 | [0.1, 1.0] |

---

## Tuning Guide

### If agents interrupt too often
- Increase `AGENT_INTERRUPT_COOLDOWN_SECONDS` (currently 15)
- Increase `MIN_WORDS_BEFORE_INTERRUPT` (currently 10)
- Reduce agent temperature (currently 0.7 in `multi_agent/llm.py`)

### If agents never interrupt
- Check model availability: `get_task_client("agent_analysis")` returning None?
- Check agent prompts in `multi_agent/prompts.py` — the ASK:/QUESTION: format must be used
- Lower `AGENT_INTERRUPT_COOLDOWN_SECONDS`

### If MCTS predictions are too static
- Lower `PROJECTION_QUALITY_GATE` (0.85 is aggressive — topic must be 85% covered)
- Lower `MCTS_DEBOUNCE_TURNS` (currently 3)
- Increase `n_sims` in `run_projection` (currently 150)

### If MCTS predictions are noisy / change too rapidly
- Increase `MCTS_DEBOUNCE_TURNS`
- Increase `PROJECTION_QUALITY_GATE`
- Decrease `_ROLLOUT_EPSILON` (less random exploration)

### If quality scores feel too generous
- Edit the quality rubric in `tracker.py:_QUALITY_USER` prompt
- Adjust heuristic breakpoints in `_assess_quality_heuristic`
- The heuristic is intentionally generous (it's the fast path); LLM refinement is more calibrated

### If opponent is too passive
- Increase `OpponentConfig.aggressiveness` (0.7 → 0.9)
- Enable all response types (`["rebuttal", "exploitation", "affirmative"]`)
- Lower the 8-word minimum in `generate_response`

### If opponent is too repetitive
- The `rebutted_topics` set prevents same-topic rebuttals, but the check is exact-match on LLM-generated topic strings which can vary. Consider embedding-based dedup.

### If frontier expands too slowly
- Lower `FRONTIER_QUALITY_GATE` (currently 0.3)
- Lower `FRONTIER_MIN_FLUSHES` (currently 2)
- Increase `FRONTIER_BATCH_SIZE` (currently 3)

### If the tracker is stuck on the wrong agenda
- `EMA_ALPHA = 0.4` means recent turns dominate. If the student consistently argues off-track, confidence should drop below 0.25 and trigger regeneration.
- If regeneration isn't happening, lower `LOW_CONFIDENCE_THRESHOLD`.
