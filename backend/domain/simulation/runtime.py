"""Simulation/session runtime domain logic (WebSocket + tracker orchestration)."""

import re
import json
import time
import functools
import logging
import base64
import random
from datetime import datetime

import anyio
import anyio.to_thread

from fastapi import WebSocket, WebSocketDisconnect

from services.judge_engine import JudgeEngine
from services.opponent_engine import OpponentEngine
from services.tts_provider import get_tts_provider
from services.stt_provider import get_stt_provider, get_stt_config_validation_error
from services.opponent_config import load_config as load_opponent_config
from multi_agent import multi_agent_service, Agent
from projected_timeline.tracker import create_session
from projected_timeline.mcts import run_projection, MCTSWeights
from projected_timeline.models import PredictedTopicSets as TrackerTopicSets, HearingTurn as TrackerTurn
from model_router import (
    get_task_client,
    extract_content,
    task_extra_body,
    get_llm_config_validation_error,
)

logger = logging.getLogger("court-simulator")

# -----------------------------------------------------------------------------
# MCTS projection gate constants
# -----------------------------------------------------------------------------

# Don't run MCTS until the speaker has said at least this many words total.
# Before this threshold the remaining-topic pool is the entire agenda (70+ items)
# and MCTS would create an exponential node explosion with no useful signal.
MCTS_MIN_WORDS = 40

# Only re-run MCTS every N sentence-buffer flushes.
# Projection results change slowly; running on every flush wastes CPU
# and — because MCTS is synchronous C-extension work — blocks the event loop.
MCTS_DEBOUNCE_TURNS = 3

# Sparse MCTS: once any topic in the best agenda reaches this quality,
# expand all_topics to include the full candidate pool so future MCTS
# projections operate over the deeper topic set.
EXPANSION_QUALITY_THRESHOLD = 0.5

# Gated frontier: how many new topics to release into the MCTS frontier
# each time the progression threshold is crossed.
FRONTIER_BATCH_SIZE = 3
# Minimum quality on the current topic before the frontier can expand.
FRONTIER_QUALITY_GATE = 0.3
# Minimum flushes on the current topic before frontier expansion.
FRONTIER_MIN_FLUSHES = 2

# Max topics passed to run_projection — focuses MCTS on the most likely
# path continuation rather than the full frontier.  Keeps projections fast
# and meaningful even after the frontier has grown large.
PROJECTION_TOP_K = 6

# Minimum quality score on the current (most recent) addressed topic before
# MCTS projection is allowed to run.  Prevents premature prediction while
# the student is still mid-argument on the first topic.
PROJECTION_QUALITY_GATE = 0.85

# Evict WS sessions that have been idle for this long (network-drop guard).
_SESSION_TTL = 3600.0  # 1 hour

# Agent evaluation early-exit: once the first agent says "yes", allow this
# many more seconds for additional candidates before cancelling remaining evals.
AGENT_EVAL_GRACE_SECONDS = 5.0
# Cancel remaining agent evals immediately if this many agents already said "yes".
AGENT_EVAL_MIN_CANDIDATES = 3


# -----------------------------------------------------------------------------
# Connection Manager
# -----------------------------------------------------------------------------

global_judge_engine = JudgeEngine()
global_opponent_engine = OpponentEngine()



# -----------------------------------------------------------------------------
# Multi-Agent Connection Manager
# -----------------------------------------------------------------------------

class MultiAgentConnectionManager:
    # Minimum seconds between agent audio interruptions (matches courtroom page cooldown)
    AGENT_INTERRUPT_COOLDOWN_SECONDS = 15
    # Minimum word count before any agent can interrupt
    MIN_WORDS_BEFORE_INTERRUPT = 10

    # Sentence buffer: flush threshold (words) when no punctuation boundary found
    SENTENCE_BUFFER_FLUSH_WORDS = 25

    # Seconds of silence before auto-flushing the sentence buffer
    SILENCE_FLUSH_TIMEOUT = 3.0

    # Regex: split on sentence-ending punctuation followed by whitespace or end-of-string
    _SENTENCE_BOUNDARY_RE = re.compile(r'(?<=[.!?])\s+')

    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}
        self.session_data: dict[str, dict] = {}
    
    async def connect(self, session_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[session_id] = websocket
        # setdefault is atomic in CPython — safe against rapid reconnects.
        self.session_data.setdefault(session_id, {
            'transcript': '',
            'sentence_buffer': '',    # accumulates STT text until sentence boundary
            '_silence_scope': None,   # anyio.CancelScope for the active silence-flush task
            '_tg': None,              # anyio TaskGroup for the WebSocket connection lifetime
            'questions_asked': [],    # List of {agent_id, agent_name, question, color}
            'agents': [],
            'brief_summary': '',
            'phase': 'SETUP',
            'last_agent_interrupt_time': None,  # datetime of last TTS interrupt
            '_last_active': time.monotonic(),   # for TTL eviction (network-drop guard)
            # PCM audio buffer: accumulate small chunks before sending to STT
            '_pcm_buffer': b'',
            # MCTS projection state
            'projection_flush_count': 0,   # total sentence-buffer flushes processed
            'last_mcts_flush': 0,          # flush count when MCTS last ran
            'last_predicted_next': [],     # cached MCTS result between runs
            # anyio.Lock — acquired for the duration of agent evaluation so
            # only one evaluation cycle runs at a time.  move_on_after(30)
            # at the call site prevents a hung LLM call from permanently
            # blocking future evaluations.
            '_eval_lock': anyio.Lock(),
            # anyio.Lock — serialises concurrent calls to check_tracker_and_counter
            # from the receive loop and the silence-flush background task.
            '_tracker_lock': anyio.Lock(),
        })
    
    def touch(self, session_id: str) -> None:
        sess = self.session_data.get(session_id)
        if sess is not None:
            sess['_last_active'] = time.monotonic()

    def evict_stale(self) -> None:
        from services.stt_provider import GladiaLiveProvider
        now = time.monotonic()
        stale = [
            sid for sid, s in self.session_data.items()
            if now - s.get('_last_active', now) > _SESSION_TTL
            and sid not in self.active_connections
        ]
        for sid in stale:
            # Release the Gladia concurrent session slot before dropping state
            stt = self.session_data[sid].get('_stt_provider')
            if isinstance(stt, GladiaLiveProvider):
                stt.stop_session(sid)
            del self.session_data[sid]
            logger.info("Evicted stale multi-agent session %s", sid)

    def disconnect(self, session_id: str):
        # The anyio task group (stored as '_tg') cancels all child tasks
        # (silence flush, agent eval, counter-args) automatically when the
        # WebSocket handler exits.  No manual task cancellation needed here.
        if session_id in self.active_connections:
            del self.active_connections[session_id]
        if session_id in self.session_data:
            del self.session_data[session_id]

    async def send_json(self, session_id: str, data: dict):
        if session_id in self.active_connections:
            try:
                await self.active_connections[session_id].send_json(data)
            except Exception as e:
                logger.debug("send_json failed for %s (client disconnected): %s", session_id, e)
                self.disconnect(session_id)

multi_agent_manager = MultiAgentConnectionManager()

_STT_HALLUCINATION_RE = re.compile(
    r"^\s*[\.\,\!\?\;\:\-\…]+\s*$"          # bare punctuation: "." "..." "," etc.
    r"|^\s*\[.*?\]\s*$"                        # bracketed noise: "[silence]" "[Music]" "[BLANK_AUDIO]"
    r"|^\s*\(.*?\)\s*$"                        # parenthesised noise: "(silence)" "(inaudible)"
    r"|^\s*(?:uh+|um+|hmm+|mm+)\s*\.?\s*$",  # filler-only: "uh" "umm" "hmm."
    re.IGNORECASE,
)

def _is_stt_hallucination(text: str) -> bool:
    """Return True if *text* looks like a Whisper silence/noise hallucination."""
    stripped = text.strip()
    if not stripped:
        return True
    # Single token that is entirely punctuation characters
    if len(stripped) <= 3 and all(c in '.,!?;:…-–—\'"' for c in stripped):
        return True
    return bool(_STT_HALLUCINATION_RE.match(stripped))


async def _process_ma_transcript(sid: str, transcript: str) -> None:
    """Process a new STT transcript through the multi-agent pipeline.

    Called by the audio handler (local Whisper path) and the Gladia live
    transcript-drain task so the pipeline logic only lives in one place.
    """
    s = multi_agent_manager.session_data.get(sid)
    if s is None:
        return
    tg = s.get('_tg')

    s['transcript'] = s.get('transcript', '') + ' ' + transcript
    await multi_agent_manager.send_json(sid, {
        "type": "transcript_update",
        "data": {"text": transcript},
    })

    buf = s.get('sentence_buffer', '') + ' ' + transcript
    s['sentence_buffer'] = buf.lstrip()

    # Cancel any pending sentence-silence scope — new words just arrived
    old_scope: anyio.CancelScope | None = s.get('_silence_scope')
    if old_scope is not None:
        old_scope.cancel()

    parts = multi_agent_manager._SENTENCE_BOUNDARY_RE.split(s['sentence_buffer'])
    complete_sentences: list[str] = []
    if len(parts) > 1:
        complete_sentences = parts[:-1]
        s['sentence_buffer'] = parts[-1]
    elif len(s['sentence_buffer'].split()) >= multi_agent_manager.SENTENCE_BUFFER_FLUSH_WORDS:
        complete_sentences = [s['sentence_buffer']]
        s['sentence_buffer'] = ''

    if complete_sentences and tg:
        flushed = ' '.join(complete_sentences)
        logger.info("[MultiAgent] Sentence buffer flushed (%d words): %s…",
                    len(flushed.split()), flushed[:80])
        tracker_state, predicted_next = await check_tracker_and_counter(sid, flushed)

        async def _fire_questions(ts=tracker_state, pn=predicted_next):
            await check_multi_agent_questions(sid, tracker_state=ts, predicted_next=pn)
        tg.start_soon(_fire_questions)

        async def _fire_score(text=flushed):
            s2 = multi_agent_manager.session_data.get(sid, {})
            brief = (s2.get('brief_summary') or '').strip() or None
            last_q_obj = ((s2.get('questions_asked') or []) + [None])[-1]
            last_q_text = last_q_obj.get('question') if last_q_obj else None
            score = await global_judge_engine.score_argument(
                sid, 'appellant', text,
                brief_summary=brief,
                judge_question_answered=last_q_text,
            )
            if score:
                await multi_agent_manager.send_json(sid, {
                    "type": "argument_score",
                    "data": {
                        "speaker": score.speaker,
                        "clarity": round(score.clarity, 1),
                        "legal_reasoning": round(score.legal_reasoning, 1),
                        "responsiveness": round(score.responsiveness, 1),
                        "persuasiveness": round(score.persuasiveness, 1),
                        "overall": round(score.overall, 1),
                        "feedback": score.feedback,
                    },
                })
        tg.start_soon(_fire_score)

        async def _fire_opponent(text=flushed, ts=tracker_state, pn=predicted_next):
            # Snapshot the number of judge questions asked before we start generating.
            # If that count increases by the time we're ready to send, a judge fired
            # this turn — the opponent must stay silent so it doesn't talk over the bench.
            s_pre = multi_agent_manager.session_data.get(sid, {})
            questions_before = len(s_pre.get('questions_asked', []))

            traj_ctx = _build_trajectory_context(ts, pn or []) if ts else None
            opp = await global_opponent_engine.generate_response(
                sid, text, trajectory_context=traj_ctx,
            )
            if opp:
                # Re-check: if a judge question fired while we were generating, skip.
                s_post = multi_agent_manager.session_data.get(sid, {})
                if len(s_post.get('questions_asked', [])) > questions_before:
                    logger.debug("[MultiAgent] Opponent suppressed — judge asked a question this turn")
                    return

                tts_p = get_tts_provider()
                opp_cfg = await anyio.to_thread.run_sync(load_opponent_config)
                audio_b64 = await tts_p.synthesize(opp.argument, voice=opp_cfg.voice_id or "default")
                await multi_agent_manager.send_json(sid, {
                    "type": "opponent_response",
                    "data": {
                        "response_type": opp.response_type,
                        "argument": opp.argument,
                        "strategy_note": opp.strategy_note,
                        "topic": opp.topic,
                        "strength": round(opp.strength, 1),
                        "timestamp": datetime.now().isoformat(),
                        "audio": audio_b64 or None,
                        "audio_format": tts_p.audio_format if audio_b64 else None,
                    },
                })
        tg.start_soon(_fire_opponent)

    # Sentence-silence timer: flush the remaining buffer if no new text arrives
    if s.get('sentence_buffer', '').strip() and tg:
        new_scope = anyio.CancelScope()
        s['_silence_scope'] = new_scope

        async def _silence_flush(_scope=new_scope):
            with _scope:
                await anyio.sleep(multi_agent_manager.SILENCE_FLUSH_TIMEOUT)
            if _scope.cancelled_caught:
                return
            s2 = multi_agent_manager.session_data.get(sid, {})
            remaining = s2.get('sentence_buffer', '').strip()
            if remaining and s2.get('phase') == 'RECORDING':
                logger.info("[MultiAgent] Silence timeout — flushing buffer (%d words): %s…",
                            len(remaining.split()), remaining[:80])
                s2['sentence_buffer'] = ''
                try:
                    ts, pn = await check_tracker_and_counter(sid, remaining)
                    inner_tg = s2.get('_tg')
                    if inner_tg:
                        async def _fire_silence_questions(ts=ts, pn=pn):
                            await check_multi_agent_questions(
                                sid, tracker_state=ts, predicted_next=pn,
                            )
                        inner_tg.start_soon(_fire_silence_questions)
                except Exception as exc:
                    logger.warning("[MultiAgent] Silence flush failed: %s", exc)

        tg.start_soon(_silence_flush)


# -----------------------------------------------------------------------------
# Multi-Agent WebSocket
# -----------------------------------------------------------------------------

async def multi_agent_websocket(websocket: WebSocket, session_id: str):
    """WebSocket endpoint for multi-agent simulation."""
    await multi_agent_manager.connect(session_id, websocket)
    stt_provider = get_stt_provider()
    # Store provider in session so evict_stale can clean up Gladia sessions
    multi_agent_manager.session_data[session_id]['_stt_provider'] = stt_provider
    stt_config_error = get_stt_config_validation_error()
    if stt_config_error:
        logger.error("[MultiAgent] STT config error for %s: %s", session_id, stt_config_error)
        await multi_agent_manager.send_json(session_id, {
            "type": "stt_error",
            "data": {"message": stt_config_error},
        })
    llm_config_error = get_llm_config_validation_error()
    if llm_config_error:
        logger.error("[MultiAgent] LLM config error for %s: %s", session_id, llm_config_error)
        await multi_agent_manager.send_json(session_id, {
            "type": "error",
            "data": {"message": llm_config_error},
        })

    try:
        # Open a task group for the lifetime of this WebSocket connection.
        # All fire-and-forget work (agent eval, silence flush, counter-args,
        # quality refinement) is started via tg.start_soon() so it runs
        # concurrently and is automatically cancelled on disconnect.
        async with anyio.create_task_group() as tg:
            multi_agent_manager.session_data[session_id]['_tg'] = tg
            while True:
                message = await websocket.receive()
                # Hypercorn (trio backend) returns a disconnect dict instead of raising
                # WebSocketDisconnect when the client closes the connection.
                if message.get("type") == "websocket.disconnect":
                    break
                multi_agent_manager.touch(session_id)   # keep TTL alive
                if "text" in message:
                    data = json.loads(message["text"])
                    msg_type, payload = data.get("type"), data.get("data", {})

                    if msg_type == "config":
                        # Initialize session with agents and brief summary
                        agents_data = payload.get('agents', [])
                        agents = [Agent.from_dict(a) for a in agents_data]
                        brief_summary = payload.get('brief_summary', '')
                        opposing_brief = payload.get('opposing_brief', '')
                        multi_agent_manager.session_data[session_id].update({
                            'agents': agents,
                            'brief_summary': brief_summary,
                            'opposing_brief': opposing_brief,
                            'phase': 'READY',
                            'mode': payload.get('mode', 'courtroom'),
                        })
                        # Initialise opponent engine with the opposing brief
                        if opposing_brief:
                            global_opponent_engine.init_session(
                                session_id, opposing_brief, brief_summary,
                            )
                        await multi_agent_manager.send_json(session_id, {
                            "type": "config_ack",
                            "data": {"status": "ready", "agent_count": len(agents)}
                        })

                    elif msg_type == "audio":
                        audio_bytes = base64.b64decode(payload.get("audio", ""))
                        logger.info("[MultiAgent] Audio received: %d bytes", len(audio_bytes) if audio_bytes else 0)
                        if audio_bytes and len(audio_bytes) > 10:
                            from services.stt_provider import GladiaLiveProvider
                            if isinstance(stt_provider, GladiaLiveProvider):
                                stt_provider.send_audio(session_id, audio_bytes)
                            else:
                                # Frontend sends WebM (Chrome/Firefox) or MP4 (Safari) from MediaRecorder.
                                # Detect format; transcribe each chunk directly. Do NOT treat as PCM.
                                _WEBM_MAGIC = b'\x1a\x45\xdf\xa3'
                                _MP4_FTYP = b'ftyp'  # at bytes 4-7 in MP4
                                audio_format = None
                                if audio_bytes[:4] == _WEBM_MAGIC:
                                    audio_format = "webm"
                                elif len(audio_bytes) >= 8 and audio_bytes[4:8] == _MP4_FTYP:
                                    audio_format = "mp4"
                                if audio_format:
                                    transcript = await stt_provider.transcribe(audio_bytes, audio_format)
                                    if _is_stt_hallucination(transcript):
                                        logger.debug("[MultiAgent] STT hallucination dropped (%s, %d bytes): %r", audio_format, len(audio_bytes), transcript[:40])
                                    else:
                                        logger.info("[MultiAgent] STT (%s, %d bytes) → %r", audio_format, len(audio_bytes), transcript[:80])
                                        await _process_ma_transcript(session_id, transcript.strip())
                                else:
                                    logger.warning(
                                        "[MultiAgent] Unrecognized audio format (first bytes: %r); "
                                        "expected WebM or MP4 from MediaRecorder",
                                        audio_bytes[:12] if len(audio_bytes) >= 12 else audio_bytes[:len(audio_bytes)],
                                    )

                    elif msg_type == "phase_change":
                        new_phase = payload.get("phase")
                        sess = multi_agent_manager.session_data[session_id]

                        # When entering RECORDING with Gladia live: start the live session
                        # and a background task that drains transcript results into the pipeline.
                        if new_phase == 'RECORDING':
                            from services.stt_provider import GladiaLiveProvider
                            if isinstance(stt_provider, GladiaLiveProvider):
                                gladia_ok = await stt_provider.start_session(session_id)

                                if gladia_ok:
                                    async def _drain_gladia(sid: str = session_id):
                                        """Poll Gladia for final transcripts and feed them to the pipeline."""
                                        from services.stt_provider import GladiaLiveProvider as _GLP
                                        try:
                                            while True:
                                                await anyio.sleep(0.1)
                                                s = multi_agent_manager.session_data.get(sid, {})
                                                if s.get('phase') not in ('RECORDING',):
                                                    break
                                                if not isinstance(stt_provider, _GLP):
                                                    break
                                                tx = stt_provider.get_transcript(sid)
                                                if tx:
                                                    await _process_ma_transcript(sid, tx)
                                        except Exception as exc:
                                            logger.error("[GladiaLive] Drain task error for %s: %s", sid, exc, exc_info=True)

                                    tg.start_soon(_drain_gladia)
                                else:
                                    logger.error("[MultiAgent] Gladia live session failed to start for %s — STT unavailable", session_id)
                                    await multi_agent_manager.send_json(session_id, {
                                        "type": "stt_error",
                                        "data": {
                                            "message": "Speech-to-text is temporarily unavailable (rate limit). Please wait ~30 seconds and try again.",
                                        },
                                    })

                        # Flush any remaining sentence buffer when leaving RECORDING.
                        # Cancel the silence-flush scope first so it doesn't also
                        # process the same buffer content concurrently.
                        if sess.get('phase') == 'RECORDING' and new_phase != 'RECORDING':
                            old_scope: anyio.CancelScope | None = sess.get('_silence_scope')
                            if old_scope is not None:
                                old_scope.cancel()
                            # Stop Gladia live session if active
                            from services.stt_provider import GladiaLiveProvider
                            if isinstance(stt_provider, GladiaLiveProvider):
                                stt_provider.stop_session(session_id)
                            # Drain any buffered PCM before flushing the text buffer
                            leftover_pcm = sess.get('_pcm_buffer', b'')
                            if leftover_pcm and len(leftover_pcm) > 1000:
                                sess['_pcm_buffer'] = b''
                                try:
                                    tail_text = await stt_provider.transcribe(leftover_pcm, "pcm")
                                    if not _is_stt_hallucination(tail_text):
                                        await _process_ma_transcript(session_id, tail_text.strip())
                                except Exception as exc:
                                    logger.warning("[MultiAgent] PCM drain on phase change failed: %s", exc)
                            else:
                                sess['_pcm_buffer'] = b''
                            remaining = sess.get('sentence_buffer', '').strip()
                            if remaining:
                                logger.info("[MultiAgent] Phase→%s: flushing remaining buffer (%d words)",
                                            new_phase, len(remaining.split()))
                                sess['sentence_buffer'] = ''
                                tracker_state, predicted_next = await check_tracker_and_counter(session_id, remaining)
                                async def _fire_phase_questions(ts=tracker_state, pn=predicted_next):
                                    await check_multi_agent_questions(
                                        session_id, tracker_state=ts, predicted_next=pn,
                                    )
                                tg.start_soon(_fire_phase_questions)

                        sess['phase'] = new_phase
                        await multi_agent_manager.send_json(session_id, {
                            "type": "phase_update",
                            "data": {"phase": new_phase}
                        })

                    elif msg_type == "set_agenda":
                        pts_raw      = payload.get("predicted_topic_sets")
                        agenda_items = payload.get("agenda_items", [])

                        # Build topic_map from agenda_items (used for agent question context).
                        topic_map: dict = {}
                        for item in agenda_items:
                            for t in item.get("topics", []):
                                topic_map[t["title"]] = {
                                    "agenda_id":   item["id"],
                                    "agent_id":    item.get("agentId"),
                                    "description": t.get("description", ""),
                                }

                        # Initialize all_topics from the full scored pool when available.
                        # This lets MCTS projection traverse beyond the initial depth-2
                        # paths immediately — the frontier gates which topics are active.
                        full_pool_raw = pts_raw.get("full_topic_pool", []) if pts_raw else []
                        already_fully_expanded = bool(full_pool_raw)

                        if full_pool_raw:
                            full_topic_pool = [
                                {
                                    "title":         t["title"],
                                    "description":   t.get("description", ""),
                                    "exploitability": t.get("exploitability", 0.5),
                                    "lens":          t.get("lens", ""),
                                }
                                for t in full_pool_raw
                            ]
                            # all_topics = entire pool; weights already scored by Phase 1
                            all_topics = list(full_topic_pool)
                            # Populate topic_map for pool topics not in agenda_items
                            for t in full_topic_pool:
                                if t["title"] not in topic_map:
                                    topic_map[t["title"]] = {
                                        "agenda_id":   None,
                                        "agent_id":    None,
                                        "description": t.get("description", ""),
                                    }
                        else:
                            # Fallback: no pool available — build from agenda_items only
                            all_topics = []
                            for item in agenda_items:
                                for t in item.get("topics", []):
                                    all_topics.append({
                                        "title":          t["title"],
                                        "description":    t.get("description", ""),
                                        "exploitability": 0.5,
                                        "lens":           "",
                                    })
                            full_topic_pool = [{**t} for t in all_topics]

                        # Pick the initial random buff topic (one of top 5 by exploitability)
                        sorted_by_exploit = sorted(
                            all_topics, key=lambda x: x.get("exploitability", 0.5), reverse=True,
                        )
                        top5 = sorted_by_exploit[:min(5, len(sorted_by_exploit))]
                        initial_buff_topic = random.choice(top5)["title"] if top5 else None

                        tracker = None
                        if pts_raw:
                            try:
                                tracker = create_session(TrackerTopicSets(**pts_raw))
                            except Exception as e:
                                logger.warning("Tracker init failed: %s", e)

                        # Initial frontier: start with the top FRONTIER_BATCH_SIZE * 2
                        # topics by exploitability (gated expansion adds more later).
                        initial_frontier_size = FRONTIER_BATCH_SIZE * 2
                        frontier_titles = {
                            t["title"] for t in sorted_by_exploit[:initial_frontier_size]
                        }

                        multi_agent_manager.session_data[session_id].update({
                            "tracker":              tracker,
                            "topic_map":            topic_map,
                            "all_topics":           all_topics,
                            "addressed_titles":     set(),
                            "path_so_far":          [],
                            "frontier_titles":      frontier_titles,
                            "initial_buff_topic":   initial_buff_topic,
                            "frontier_flush_count": 0,
                            "case_summary":         pts_raw.get("case_summary", "") if pts_raw else "",
                            "full_topic_pool":      full_topic_pool,
                            "sparse_expanded":      already_fully_expanded,
                        })
                        logger.info(
                            "[MultiAgent] set_agenda: tracker_ready=%s, topics_indexed=%d, "
                            "full_pool=%d, frontier=%d, initial_buff=%s",
                            tracker is not None, len(topic_map), len(full_topic_pool),
                            len(frontier_titles), initial_buff_topic,
                        )
                        await multi_agent_manager.send_json(session_id, {
                            "type": "agenda_set_ack",
                            "data": {"tracker_ready": tracker is not None, "topics_indexed": len(topic_map)},
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
        pass
    except BaseException as e:
        logger.error("Multi-agent WebSocket error: %s", e, exc_info=True)
    finally:
        # Release the Gladia concurrent session slot on any disconnect so the
        # next session start doesn't hit the 429 concurrent-session limit.
        from services.stt_provider import GladiaLiveProvider
        if isinstance(stt_provider, GladiaLiveProvider):
            stt_provider.stop_session(session_id)
        multi_agent_manager.disconnect(session_id)
        global_opponent_engine.evict_session(session_id)


async def generate_counter_argument(
    agent,
    topic_title: str,
    topic_description: str,
    recent_utterance: str,
    brief_summary: str,
) -> str:
    """Generate a 1-2 sentence counter-argument from an agent's perspective."""
    client, model = get_task_client("counter_argument")
    if not client:
        return ""

    def _extract_spoken_counter(text: str) -> str:
        """Strip visible chain-of-thought / draft scaffolding from counter text."""
        cleaned = (text or "").strip()
        if not cleaned:
            return ""

        if cleaned.startswith("```"):
            lines = cleaned.splitlines()
            cleaned = "\n".join(lines[1:-1]).strip() if len(lines) > 2 else cleaned

        # Prefer the last substantive question line when the model drafted options.
        question_lines = []
        prose_lines = []
        for raw_line in cleaned.splitlines():
            line = raw_line.strip().strip('"')
            if not line:
                continue
            if line.startswith(("*", "-", "#")):
                continue
            if re.match(r"^\d+\.\s+", line):
                continue
            prose_lines.append(line)
            if "?" in line and len(line) >= 20:
                question_lines.append(line)

        if question_lines:
            return question_lines[-1]

        if prose_lines:
            merged = " ".join(prose_lines).strip()
            # If the model produced multiple draft labels followed by prose,
            # keep the last sentence-like span.
            sentences = re.split(r"(?<=[.!?])\s+", merged)
            substantive = [s.strip() for s in sentences if len(s.strip()) >= 20]
            if substantive:
                return substantive[-1]
            return merged

        return cleaned

    prompt = (
        f"You are {agent.name}. {agent.description}\n"
        f"The speaker just addressed the topic: \"{topic_title}\"\n"
        f"Topic context: {topic_description}\n"
        f"Their argument: \"{recent_utterance}\"\n\n"
        f"Case summary: {brief_summary}\n\n"
        "Provide a sharp 1-2 sentence counter-argument or probing follow-up "
        "from your perspective. Be direct and specific to the topic.\n"
        "Return ONLY the spoken counter-argument or question itself.\n"
        "Do not include analysis, bullet points, numbered lists, draft options, "
        "or reasoning notes."
    )
    resp = await client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.7,
        max_tokens=500,
        extra_body=task_extra_body("counter_argument"),
    )
    return _extract_spoken_counter(extract_content(resp))


def _format_agenda_confidences(state) -> list:
    """Serialise TrackerStateResponse.agenda_confidences to a JSON-safe list."""
    return [
        {
            "prediction_id": ac.prediction_id,
            "lens": ac.lens,
            "confidence": ac.confidence,
            "topics_coverage": [
                {
                    "order": tc.order,
                    "title": tc.title,
                    "addressed": tc.addressed,
                    "address_turn": tc.address_turn,
                    "quality": tc.quality,
                }
                for tc in ac.topics_coverage
            ],
            "uncovered_titles": ac.uncovered_titles,
            "weak_titles": ac.weak_titles,
        }
        for ac in state.agenda_confidences
    ]


def _build_quality_map(state) -> dict[str, float]:
    """Extract title→quality mapping from the best-matching agenda.

    Used to feed live quality scores into MCTS projection so the tree
    gravitates toward topics the advocate argued weakly or hasn't addressed.
    """
    best = next(
        (ac for ac in state.agenda_confidences
         if ac.prediction_id == state.best_prediction_id),
        None,
    )
    if not best:
        return {}
    return {
        tc.title: tc.quality
        for tc in best.topics_coverage
        if tc.addressed   # only include addressed topics; unaddressed = absent → urgency
    }


def _build_trajectory_context(state, predicted_next: list) -> dict | None:
    """Build the trajectory_context dict passed to agent question prompts."""
    best = next(
        (ac for ac in state.agenda_confidences
         if ac.prediction_id == state.best_prediction_id),
        None,
    )
    if not best:
        return None
    return {
        "current_lens":    best.lens,
        "uncovered_topics": best.uncovered_titles,
        "weak_topics":     best.weak_titles,
        "predicted_next":   predicted_next,
    }


def _build_exploitability_map(session: dict) -> dict[str, float]:
    """Build title→exploitability from session's all_topics / full_topic_pool."""
    all_topics = session.get("all_topics", [])
    return {t["title"]: t.get("exploitability", 0.5) for t in all_topics}


def _build_opponent_bonus_map(session_id: str, all_topics: list) -> dict[str, float]:
    """Build title→bonus from opponent engine's recent arguments.

    The opponent only has their own brief so topic strings may differ.
    Uses embedding similarity to match opponent topics to our pool titles.
    """
    from projected_timeline.tracker import _embed, _cosine

    if not global_opponent_engine.has_session(session_id):
        return {}

    summary = global_opponent_engine.get_session_summary(session_id)
    responses = summary.get("arguments", [])
    if not responses:
        return {}

    # Collect opponent topic→max_strength
    opp_topics: dict[str, float] = {}
    for r in responses:
        topic = r.get("topic", "")
        strength = r.get("strength", 0.0)
        if topic:
            opp_topics[topic] = max(opp_topics.get(topic, 0.0), strength)

    if not opp_topics:
        return {}

    opp_texts = list(opp_topics.keys())
    opp_strengths = [opp_topics[t] for t in opp_texts]
    pool_titles = [t["title"] for t in all_topics]

    if not pool_titles:
        return {}

    opp_vecs = _embed(opp_texts)
    pool_vecs = _embed([f"{t['title']}. {t.get('description', '')}" for t in all_topics])

    bonus_map: dict[str, float] = {}
    for i, title in enumerate(pool_titles):
        pvec = pool_vecs[i] if i < len(pool_vecs) else None
        if pvec is None:
            continue
        best_bonus = 0.0
        for j, ovec in enumerate(opp_vecs):
            if ovec is None:
                continue
            sim = _cosine(pvec, ovec)
            if sim >= 0.4:
                strength_norm = opp_strengths[j] / 10.0
                best_bonus = max(best_bonus, 0.15 * strength_norm)
        if best_bonus > 0:
            bonus_map[title] = best_bonus

    return bonus_map


def _update_topic_weights(
    session: dict,
    quality_map: dict,
    opponent_bonus_map: dict,
) -> None:
    """Dynamically adjust per-topic exploitability weights from live hearing signals.

    Called before each MCTS projection so weights reflect the current state of
    the hearing rather than the static Phase-1 brief scores.

    Signals applied (all clamped to [0.1, 1.0]):
    - Addressed + poorly argued (q < 0.3) → boost (+0.04): judge probes again.
    - Addressed + well covered (q > 0.7) → decay (−0.03): panel moves on.
    - Unaddressed + opponent pressure → boost proportional to strength.
    - Unaddressed + partially touched (0 < q < 0.4) → small boost (+0.03).
    - Completely untouched (q is None) → tiny urgency boost (+0.012 per flush).
    """
    addressed = session.get("addressed_titles", set())
    for t in session.get("all_topics", []):
        title = t["title"]
        current = t.get("exploitability", 0.5)
        delta = 0.0
        q = quality_map.get(title)

        if title in addressed:
            if q is not None:
                if q < 0.3:
                    delta += 0.04   # weak argument → judge returns to probe
                elif q > 0.7:
                    delta -= 0.03   # strong coverage → deprioritize
        else:
            opp = opponent_bonus_map.get(title, 0.0)
            if opp > 0:
                delta += opp * 0.4  # opponent pressure → hotter topic
            if q is not None and q < 0.4:
                delta += 0.03       # touched but underdeveloped
            if q is None:
                delta += 0.012      # urgency: untouched topics accumulate weight

        t["exploitability"] = max(0.1, min(1.0, current + delta))


def _build_mcts_weights(
    session: dict,
    session_id: str,
    quality_map: dict,
    opponent_bonus: dict | None = None,
) -> MCTSWeights:
    """Assemble the full MCTSWeights for a live MCTS projection."""
    all_topics = session.get("all_topics", [])
    addressed = session.get("addressed_titles", set())
    path_so_far = session.get("path_so_far", [])

    exploitability_map = _build_exploitability_map(session)
    if opponent_bonus is None:
        opponent_bonus = _build_opponent_bonus_map(session_id, all_topics)

    # Initial buff: only when no topics have been addressed yet
    initial_buff: dict[str, float] = {}
    buff_topic = session.get("initial_buff_topic")
    if buff_topic and not addressed:
        initial_buff[buff_topic] = 0.25

    # Lens map from all_topics
    lens_map = {t["title"]: t.get("lens", "") for t in all_topics}

    # Last path lens for lens-continuity
    last_lens = None
    if path_so_far:
        last_lens = lens_map.get(path_so_far[-1])

    return MCTSWeights(
        exploitability=exploitability_map,
        quality=quality_map if quality_map else None,
        opponent_bonus=opponent_bonus,
        initial_buff=initial_buff,
        lens_map=lens_map,
        last_path_lens=last_lens,
        covered_count=len(addressed),
    )


def _expand_frontier_if_ready(session: dict, quality_map: dict) -> bool:
    """Check progression signals and expand the frontier if appropriate.

    Returns True if the frontier was expanded.
    """
    frontier = session.get("frontier_titles", set())
    all_topics = session.get("all_topics", [])
    path_so_far = session.get("path_so_far", [])
    frontier_flush = session.get("frontier_flush_count", 0)

    if not path_so_far:
        return False

    current_topic = path_so_far[-1]

    # One expansion per topic — once we've expanded for this topic, don't
    # re-expand on every subsequent flush (the old per-flush cooldown was
    # insufficient: frontier_flush increments each flush, so the gate
    # re-opened on every flush after FRONTIER_MIN_FLUSHES was reached).
    if session.get("_last_frontier_expand_topic") == current_topic:
        return False

    current_quality = quality_map.get(current_topic, 0.0)

    # Check if the current topic meets any progression threshold:
    #   1. Quality threshold crossed (student made a real attempt), OR
    #   2. Enough flushes spent on this topic, OR
    #   3. An agent question was asked on this topic (judge has probed it)
    last_path_flush = session.get("_last_path_update_flush", 0)
    flushes_on_topic = frontier_flush - last_path_flush
    question_probed = any(
        q.get("path_topic") == current_topic
        for q in session.get("questions_asked", [])
    )
    if current_quality < FRONTIER_QUALITY_GATE and flushes_on_topic < FRONTIER_MIN_FLUSHES and not question_probed:
        return False

    # Expand: add next batch of topics sorted by exploitability + lens continuity
    current_lens = None
    for t in all_topics:
        if t["title"] == current_topic:
            current_lens = t.get("lens", "")
            break

    candidates = [
        t for t in all_topics
        if t["title"] not in frontier and t["title"] not in session.get("addressed_titles", set())
    ]
    if not candidates:
        return False

    def _expansion_score(t):
        exploit = t.get("exploitability", 0.5)
        lens_bonus = 0.1 if t.get("lens") == current_lens else 0.0
        return exploit + lens_bonus

    candidates.sort(key=_expansion_score, reverse=True)
    new_titles = [t["title"] for t in candidates[:FRONTIER_BATCH_SIZE]]
    frontier.update(new_titles)
    session["frontier_titles"] = frontier
    session["_last_frontier_expand_topic"] = current_topic  # one expansion per topic

    logger.info(
        "[Frontier] Expanded by %d topics (current=%s, quality=%.2f): %s",
        len(new_titles), current_topic, current_quality, new_titles,
    )
    return True


async def check_tracker_and_counter(session_id: str, utterance: str):
    """Update the trajectory tracker, conditionally run MCTS re-projection, and fire counter-arguments.

    Key optimisations vs. the original:
    - tracker.update() is now synchronous (embedding + heuristic quality only).
    - LLM quality refinement is scheduled as a fire-and-forget background task.
    - MCTS projection runs in a thread pool (anyio.to_thread.run_sync) so it
      never blocks the asyncio event loop.
    - MCTS is gated behind MCTS_MIN_WORDS and debounced every MCTS_DEBOUNCE_TURNS
      flushes; stale results are reused between runs.

    Returns (tracker_state, predicted_next).
    """
    session = multi_agent_manager.session_data.get(session_id, {})
    tracker = session.get("tracker")
    # Fix #4: explicit None check — a falsy but non-None tracker object would
    # previously skip the update silently.
    if tracker is None or not utterance.strip():
        return None, session.get("last_predicted_next", [])

    # ── Serialise concurrent tracker/MCTS-gate mutations ─────────────────
    # Both the receive loop and the silence-flush background task can call
    # check_tracker_and_counter concurrently.  The _tracker_lock ensures the
    # fast synchronous mutations (flush_count, addressed_titles, last_mcts_flush)
    # are performed by exactly one task at a time; MCTS and send_json run outside.
    tracker_lock: anyio.Lock = session.get('_tracker_lock') or anyio.Lock()
    state = None
    refinement_args = ()
    addressed = set()
    remaining = []
    root_label = ""
    quality_map: dict = {}
    flush_count = 0
    last_mcts_flush_prev = 0
    run_mcts = False
    predicted_next = session.get("last_predicted_next", [])
    path_so_far_list: list = session.get("path_so_far", [])
    all_topics: list = session.get("all_topics", [])

    with anyio.move_on_after(5) as lock_scope:
        async with tracker_lock:
            # ── Tracker update (synchronous — no LLM call inside) ─────────
            state, refinement_args = tracker.update(
                TrackerTurn(speaker="petitioner", utterance=utterance)
            )

            # ── Update addressed-topic set + path_so_far ─────────────────
            addressed = session.get("addressed_titles", set())
            path_so_far_list = list(session.get("path_so_far", []))
            if state.last_human_matched_topic:
                if state.last_human_matched_topic not in addressed:
                    path_so_far_list.append(state.last_human_matched_topic)
                    session["path_so_far"] = path_so_far_list
                    session["_last_path_update_flush"] = session.get("projection_flush_count", 0) + 1
                addressed.add(state.last_human_matched_topic)
                session["addressed_titles"] = addressed

            all_topics = session.get("all_topics", [])
            root_label = session.get("case_summary", "")
            quality_map = _build_quality_map(state)

            # ── Sparse MCTS expansion ─────────────────────────────────────
            if not session.get("sparse_expanded", False) and quality_map:
                max_quality = max(quality_map.values()) if quality_map else 0.0
                if max_quality >= EXPANSION_QUALITY_THRESHOLD:
                    full_pool = session.get("full_topic_pool", [])
                    if full_pool and len(full_pool) > len(all_topics):
                        existing_titles = {t["title"] for t in all_topics}
                        new_topics = [t for t in full_pool if t["title"] not in existing_titles]
                        all_topics = all_topics + new_topics
                        session["all_topics"] = all_topics
                        topic_map = session.get("topic_map", {})
                        for t in new_topics:
                            if t["title"] not in topic_map:
                                topic_map[t["title"]] = {
                                    "agenda_id": None,
                                    "agent_id": None,
                                    "description": t.get("description", ""),
                                }
                        session["topic_map"] = topic_map
                        session["sparse_expanded"] = True
                        session["_just_expanded"] = True
                        logger.info(
                            "[SparseMCTS] Expansion triggered (max_quality=%.2f ≥ %.2f): "
                            "%d → %d topics",
                            max_quality, EXPANSION_QUALITY_THRESHOLD,
                            len(all_topics) - len(new_topics), len(all_topics),
                        )

            # ── Gated frontier expansion ──────────────────────────────────
            session["frontier_flush_count"] = session.get("frontier_flush_count", 0) + 1
            _expand_frontier_if_ready(session, quality_map)

            # ── Build remaining from frontier (gated) ─────────────────────
            frontier = session.get("frontier_titles", set())
            remaining = [
                t for t in all_topics
                if t["title"] not in addressed and t["title"] in frontier
            ]

            # ── MCTS gate ──────────────────────────────────────────────────
            just_expanded       = session.pop("_just_expanded", False)
            word_count          = len(session.get("transcript", "").split())
            flush_count         = session.get("projection_flush_count", 0) + 1
            session["projection_flush_count"] = flush_count
            last_mcts_flush_prev = session.get("last_mcts_flush", -MCTS_DEBOUNCE_TURNS)
            since_last_mcts      = flush_count - last_mcts_flush_prev

            # Only project once the student has substantially addressed the
            # current topic.  No addressed topic → no projection yet.
            current_topic_quality = (
                quality_map.get(path_so_far_list[-1], 0.0)
                if path_so_far_list else 0.0
            )
            topic_ready = current_topic_quality >= PROJECTION_QUALITY_GATE

            run_mcts = (
                len(remaining) >= 2
                and topic_ready
                and (
                    just_expanded
                    or (word_count >= MCTS_MIN_WORDS and since_last_mcts >= MCTS_DEBOUNCE_TURNS)
                )
            )
            if run_mcts:
                # Mark the flush optimistically inside the lock so a concurrent
                # task skips MCTS rather than launching a second projection.
                session["last_mcts_flush"] = flush_count

            predicted_next = session.get("last_predicted_next", [])

    if lock_scope.cancelled_caught:
        logger.warning("[Tracker] Skipping update for %s — tracker lock timed out", session_id)
        return None, session.get("last_predicted_next", [])

    # state must be set if we reach here (lock was acquired)
    assert state is not None

    # Schedule LLM quality refinement outside the lock — it's slow and fire-and-forget.
    if refinement_args:
        session_tg = session.get('_tg')
        if session_tg:
            session_tg.start_soon(tracker.schedule_quality_refinement, *refinement_args)

    mcts_tree: dict | None = None

    if run_mcts:
        try:
            # Update per-topic exploitability weights from live signals before projection.
            opp_bonus = _build_opponent_bonus_map(session_id, all_topics)
            _update_topic_weights(session, quality_map, opp_bonus)

            # Build consolidated weights, reusing the opponent bonus already computed.
            mcts_weights = _build_mcts_weights(session, session_id, quality_map, opponent_bonus=opp_bonus)

            # Embed path topics so cosine flow works from the last path topic.
            path_vecs: dict[str, list] = {}
            if path_so_far_list:
                from projected_timeline.tracker import _embed
                last_title = path_so_far_list[-1]
                # Find description for the last path topic
                last_desc = ""
                for t in all_topics:
                    if t["title"] == last_title:
                        last_desc = t.get("description", "")
                        break
                vecs = _embed([f"{last_title}. {last_desc}"])
                if vecs and vecs[0] is not None:
                    path_vecs[last_title] = vecs[0]

            path_tuple = tuple(path_so_far_list)

            # Focus projection on the most likely path continuation —
            # top PROJECTION_TOP_K topics by current exploitability weight.
            # After _update_topic_weights, weights reflect live hearing signals.
            focused = remaining if len(remaining) <= PROJECTION_TOP_K else sorted(
                remaining, key=lambda t: t.get("exploitability", 0.5), reverse=True
            )[:PROJECTION_TOP_K]

            proj_fn = functools.partial(
                run_projection,
                focused,
                root_label=root_label,
                weights=mcts_weights,
                path_so_far=path_tuple,
                path_vecs=path_vecs,
            )
            predicted_next, mcts_tree = await anyio.to_thread.run_sync(proj_fn)
            session["last_predicted_next"] = predicted_next
            logger.info(
                "[MCTS] Projection ran (words=%d, flush=%d, remaining=%d) → %d topics",
                word_count, flush_count, len(remaining), len(predicted_next),
            )
        except Exception as e:
            logger.warning("MCTS projection failed: %s", e)
            # Fix #3: reset last_mcts_flush so the next flush retries rather than
            # reusing a stale result for another full debounce cycle.
            session["last_mcts_flush"] = last_mcts_flush_prev
    else:
        if not topic_ready:
            reason = (
                f"quality gate: topic={path_so_far_list[-1]!r} "
                f"q={current_topic_quality:.2f}<{PROJECTION_QUALITY_GATE}"
                if path_so_far_list
                else "no topic addressed yet"
            )
        elif word_count < MCTS_MIN_WORDS:
            reason = f"words={word_count}<{MCTS_MIN_WORDS}"
        else:
            reason = f"debounce ({since_last_mcts}/{MCTS_DEBOUNCE_TURNS} flushes)"
        logger.debug("[MCTS] Skipped projection (%s), reusing cached %d topics", reason, len(predicted_next))

    # ── Send agenda update to frontend ────────────────────────────────────
    await multi_agent_manager.send_json(session_id, {
        "type": "agenda_update",
        "data": {
            "best_prediction_id":       state.best_prediction_id,
            "agenda_confidences":       _format_agenda_confidences(state),
            "last_human_matched_topic": state.last_human_matched_topic,
            "predicted_next_topics":    predicted_next,
            "mcts_tree":                mcts_tree,
            "regeneration_needed":      state.regeneration_needed,
        },
    })

    # ── Counter-argument: ALL agents concurrently, select a winner ──────
    # Mirrors the agent-question pipeline: every agent generates a counter,
    # all appear in the per-agent QuestionFeed grid (question_type="counter"),
    # and a TINY-model selector picks the single best response to speak aloud.
    matched = state.last_human_matched_topic
    if matched:
        async def _fire_all_counters(sid, matched_topic, topic_info, agents, utt, brief_summary):
            try:
                # Suppress counter-arguments if a judge question fired recently —
                # playing both back-to-back sounds like two simultaneous interrupts.
                s_pre = multi_agent_manager.session_data.get(sid, {})
                _ca_last = s_pre.get('last_agent_interrupt_time')
                if _ca_last is not None:
                    _ca_elapsed = (datetime.now() - _ca_last).total_seconds()
                    if _ca_elapsed < multi_agent_manager.AGENT_INTERRUPT_COOLDOWN_SECONDS:
                        logger.debug("[Counter] Suppressed — judge question fired %.1fs ago", _ca_elapsed)
                        return

                topic_desc = topic_info.get("description", "") if topic_info else ""
                results: list = [None] * len(agents)

                async def _gen(idx, agent):
                    try:
                        text = await generate_counter_argument(
                            agent=agent,
                            topic_title=matched_topic,
                            topic_description=topic_desc,
                            recent_utterance=utt,
                            brief_summary=brief_summary,
                        )
                        if text:
                            results[idx] = (agent, text)
                    except Exception as e:
                        logger.error("Counter-arg gen failed for %s: %s", agent.name, e)

                async with anyio.create_task_group() as gen_tg:
                    for i, agent in enumerate(agents):
                        gen_tg.start_soon(_gen, i, agent)

                candidates = [r for r in results if r is not None]
                if not candidates:
                    return

                winner_agent, winner_text = await _select_best_question(
                    candidates, utt, brief_summary,
                )

                # Re-check: a judge question may have fired while LLMs were running.
                # Skip TTS (and audio in the WS payload) so the counter-argument
                # doesn't play on top of or immediately after the judge's question.
                s_post2 = multi_agent_manager.session_data.get(sid, {})
                _ca_last2 = s_post2.get('last_agent_interrupt_time')
                if _ca_last2 is not None:
                    _ca_elapsed2 = (datetime.now() - _ca_last2).total_seconds()
                    if _ca_elapsed2 < multi_agent_manager.AGENT_INTERRUPT_COOLDOWN_SECONDS:
                        logger.debug("[Counter] Suppressed TTS — judge question fired %.1fs ago", _ca_elapsed2)
                        return

                audio_b64 = ""
                audio_format = "opus"
                if winner_agent:
                    try:
                        tts = get_tts_provider()
                        audio_b64 = await tts.synthesize(winner_text)
                        audio_format = tts.audio_format
                    except Exception as e:
                        logger.warning("[Counter] TTS failed for %s: %s", winner_agent.name, e)

                now_iso = datetime.now().isoformat()
                for agent, text in candidates:
                    is_winner = winner_agent and agent.id == winner_agent.id
                    q_data = {
                        "agent_id":      agent.id,
                        "agent_name":    agent.name,
                        "color":         agent.color,
                        "question":      text,
                        "timestamp":     now_iso,
                        "selected":      bool(is_winner),
                        "question_type": "counter",
                        "topic":         matched_topic,
                        "audio":         audio_b64 if is_winner else "",
                        "audio_format":  audio_format if is_winner else "",
                    }
                    if is_winner:
                        session.get("questions_asked", []).append(q_data)
                    await multi_agent_manager.send_json(sid, {
                        "type": "agent_question",
                        "data": q_data,
                    })

                if winner_agent:
                    logger.info("[Counter] %s selected (of %d): %s…",
                                winner_agent.name, len(candidates), winner_text[:60])
            except Exception as e:
                logger.error("Counter-argument pipeline failed: %s", e)

        agents_list = session.get("agents", [])
        topic_info = session.get("topic_map", {}).get(matched)
        if agents_list:
            session_tg = session.get('_tg')
            if session_tg:
                session_tg.start_soon(
                    _fire_all_counters,
                    session_id, matched, topic_info, agents_list, utterance,
                    session.get("brief_summary", ""),
                )

    return state, predicted_next


async def _select_best_question(
    candidates: list,
    transcript: str,
    brief_summary: str,
) -> tuple:
    """Use the TINY model to pick the best question from agent candidates.

    Parameters
    ----------
    candidates : list of (Agent, question_str)
    transcript : recent advocate speech
    brief_summary : judicial summary for context

    Returns (agent, question) — the selected winner.  Falls back to
    random.choice if the TINY model is unavailable or parsing fails.
    """
    if not candidates:
        return (None, None)
    if len(candidates) <= 2:
        return random.choice(candidates)

    client, model = get_task_client("question_selection")
    if not client:
        return random.choice(candidates)

    q_list = "\n".join(
        f"{i + 1}. [{agent.name}]: {question}"
        for i, (agent, question) in enumerate(candidates)
    )

    prompt = (
        "You are selecting the single best judicial question to ask during "
        "a moot-court hearing.\n\n"
        f"RECENT TRANSCRIPT:\n{transcript[-800:]}\n\n"
        f"CASE SUMMARY:\n{brief_summary[:400]}\n\n"
        f"CANDIDATE QUESTIONS:\n{q_list}\n\n"
        "Pick the question that is most:\n"
        "1. Relevant to what the advocate just argued\n"
        "2. Substantive and probing\n"
        "3. Not redundant with recent discussion\n\n"
        "Respond with ONLY the number (e.g. '1' or '2'). Nothing else."
    )

    SELECTION_TIMEOUT = 8  # seconds — fall back to random if TINY is slow

    try:
        result = [None]

        async def _call_llm():
            result[0] = await client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=10,
                extra_body=task_extra_body("question_selection"),
            )

        with anyio.CancelScope() as scope:
            scope.deadline = anyio.current_time() + SELECTION_TIMEOUT
            await _call_llm()

        if scope.cancelled_caught:
            logger.warning(
                "[QuestionSelect] TINY selection timed out after %ds — falling back to random",
                SELECTION_TIMEOUT,
            )
            return random.choice(candidates)

        content = extract_content(result[0])
        match = re.search(r"(\d+)", content)
        if match:
            idx = int(match.group(1)) - 1
            if 0 <= idx < len(candidates):
                logger.info(
                    "[QuestionSelect] TINY chose candidate %d/%d (%s)",
                    idx + 1, len(candidates), candidates[idx][0].name,
                )
                return candidates[idx]
    except Exception as e:
        logger.warning("[QuestionSelect] TINY selection failed: %s — falling back to random", e)

    return random.choice(candidates)


async def check_multi_agent_questions(session_id: str, tracker_state=None, predicted_next=None):
    """Check each agent to see if they want to ask a question.

    When tracker_state is supplied (from check_tracker_and_counter), agents
    receive trajectory context so they can probe uncovered topics and align
    with the dominant judicial lens.  After each agent question the tracker is
    updated as a judge turn, keeping confidence scores and MCTS projections
    consistent with what the simulated panel is actually asking.

    Interruption logic (mirrors courtroom page):
    - Hard cooldown: no agent can interrupt within AGENT_INTERRUPT_COOLDOWN_SECONDS
      of the last agent interrupt.
    - Minimum speech: at least MIN_WORDS_BEFORE_INTERRUPT words must be in the
      transcript before any agent fires.
    - One-per-cycle: a random agent that wants to ask fires (prevents
      overlapping TTS and adds variety).  The winning agent's question is
      synthesized to TTS audio and sent alongside the text.
    """
    session = multi_agent_manager.session_data.get(session_id, {})

    # ── Quick pre-checks (no lock needed) ─────────────────────────────────
    phase = session.get('phase')
    if phase != 'RECORDING':
        logger.debug("[MultiAgent] Skip interrupt check — phase=%s (need RECORDING)", phase)
        return

    transcript = session.get('transcript', '')
    word_count = len(transcript.strip().split())
    if word_count < multi_agent_manager.MIN_WORDS_BEFORE_INTERRUPT:
        logger.debug("[MultiAgent] Skip interrupt — only %d words (need %d)",
                     word_count, multi_agent_manager.MIN_WORDS_BEFORE_INTERRUPT)
        return

    # ── Pre-lock cooldown check ───────────────────────────────────────────
    # Bail out before even touching the lock if the cooldown is still active.
    # This prevents the silence-flush and sentence-boundary flush from both
    # queuing up for the lock when a question just fired, causing a full
    # N-agent LLM evaluation before the in-lock re-check can reject it.
    _pre_last = session.get('last_agent_interrupt_time')
    if _pre_last is not None:
        _pre_elapsed = (datetime.now() - _pre_last).total_seconds()
        if _pre_elapsed < multi_agent_manager.AGENT_INTERRUPT_COOLDOWN_SECONDS:
            logger.debug("[MultiAgent] Skip interrupt — cooldown %.1fs / %ds (pre-lock check)",
                         _pre_elapsed, multi_agent_manager.AGENT_INTERRUPT_COOLDOWN_SECONDS)
            return

    # ── Concurrency guard: anyio.Lock with timeout ────────────────────────
    # Only one evaluation cycle runs at a time — prevents a silence-flush
    # and a sentence-boundary flush from firing 2×N simultaneous LLM calls.
    # N agents × OpenRouter latency can exceed 30s; use 60s to avoid timeouts.
    _EVAL_LOCK_TIMEOUT = 60
    lock: anyio.Lock = session.get('_eval_lock') or anyio.Lock()

    # Outputs captured inside the lock, consumed after release.
    winner_agent    = None
    winner_question = None
    candidates      = []
    now_iso         = None

    with anyio.move_on_after(_EVAL_LOCK_TIMEOUT) as lock_scope:
        async with lock:
            # ── Re-check cooldown INSIDE the lock ─────────────────────────
            # A concurrent call might have fired an agent question between our
            # initial pre-check and acquiring this lock, so we must re-verify.
            last_interrupt = session.get('last_agent_interrupt_time')
            if last_interrupt is not None:
                elapsed = (datetime.now() - last_interrupt).total_seconds()
                if elapsed < multi_agent_manager.AGENT_INTERRUPT_COOLDOWN_SECONDS:
                    logger.debug("[MultiAgent] Skip interrupt — cooldown %.1fs / %ds (re-checked inside lock)",
                                 elapsed, multi_agent_manager.AGENT_INTERRUPT_COOLDOWN_SECONDS)
                    return

            agents        = session.get('agents', [])
            brief_summary = session.get('brief_summary', '')
            asked_texts   = [q.get('question', '') for q in session.get('questions_asked', [])]

            trajectory_context = (
                _build_trajectory_context(tracker_state, predicted_next or [])
                if tracker_state else None
            )

            logger.info("[MultiAgent] Evaluating %d agents (phase=%s, words=%d, grace=%.0fs)",
                        len(agents), phase, word_count, AGENT_EVAL_GRACE_SECONDS)

            results: list = [(a, False, None) for a in agents]
            eval_early_exit = anyio.CancelScope()
            _first_yes_time = [None]

            async def _eval_agent(idx: int, agent) -> None:
                try:
                    should_ask, question = await multi_agent_service.analyze_agent_question(
                        agent=agent,
                        transcript=transcript,
                        brief_summary=brief_summary,
                        questions_already_asked=asked_texts,
                        trajectory_context=trajectory_context,
                    )
                    logger.info("[MultiAgent] Agent '%s' → should_ask=%s, question=%s",
                                agent.name, should_ask, (question[:60] + '…') if question else None)
                    results[idx] = (agent, should_ask, question)
                    if should_ask and question:
                        if _first_yes_time[0] is None:
                            _first_yes_time[0] = anyio.current_time()
                            eval_early_exit.deadline = (
                                _first_yes_time[0] + AGENT_EVAL_GRACE_SECONDS
                            )
                        if sum(1 for _, sa, q in results if sa and q) >= AGENT_EVAL_MIN_CANDIDATES:
                            eval_early_exit.cancel()
                except Exception as e:
                    logger.error("Error checking agent %s: %s", agent.name, e)

            with eval_early_exit:
                async with anyio.create_task_group() as eval_tg:
                    for i, agent in enumerate(agents):
                        eval_tg.start_soon(_eval_agent, i, agent)

            if eval_early_exit.cancelled_caught:
                _n = sum(1 for _, sa, q in results if sa and q)
                logger.info("[MultiAgent] Early exit: %d candidates from %d agents", _n, len(agents))

            # Use TINY model to select the best question from candidates —
            # adds intelligent selection so the court hears the most relevant
            # question rather than a random pick.
            candidates = [(agent, question) for agent, should_ask, question in results
                          if should_ask and question]
            # In playground mode, also collect non-winner questions for display.
            if session.get('mode') == 'playground':
                all_with_question = [(agent, question) for agent, should_ask, question in results if question]
            if candidates:
                winner_agent, winner_question = await _select_best_question(
                    candidates, transcript, brief_summary,
                )
                # Mark interrupt time NOW (inside the lock) so any concurrent
                # caller that acquires the lock next sees the cooldown and exits
                # without running another full evaluation cycle.
                session['last_agent_interrupt_time'] = datetime.now()
                now_iso = datetime.now().isoformat()

    if lock_scope.cancelled_caught:
        logger.warning("[MultiAgent] Skip interrupt — eval lock timed out (hung LLM call?)")
        return

    # ── Post-lock: TTS synthesis + WS sends ───────────────────────────────
    # The eval lock is now RELEASED.  TTS and network I/O run here so they
    # never block the next evaluation cycle from starting.
    if candidates and winner_agent and winner_question:
        # Synthesize TTS audio only for the selected winner
        audio_b64 = ""
        audio_format = "opus"
        try:
            tts = get_tts_provider()
            audio_b64 = await tts.synthesize(winner_question)
            audio_format = tts.audio_format
        except Exception as e:
            logger.warning("[MultiAgent] TTS synthesis failed for %s: %s", winner_agent.name, e)

        path_topic = session.get("path_so_far", [])[-1] if session.get("path_so_far") else ""
        if session.get('mode') == 'playground':
            # Playground: send every agent's question so the grid shows what each judge was thinking.
            for agent, question in all_with_question:
                is_winner = (agent.id == winner_agent.id)
                q_data = {
                    "agent_id":     agent.id,
                    "agent_name":   agent.name,
                    "color":        agent.color,
                    "question":     question,
                    "timestamp":    now_iso,
                    "selected":     is_winner,
                    "question_type": "question",
                    "audio":        audio_b64 if is_winner else "",
                    "audio_format": audio_format if is_winner else "",
                    "path_topic":   path_topic,
                }
                if is_winner:
                    session['questions_asked'].append(q_data)
                await multi_agent_manager.send_json(session_id, {
                    "type": "agent_question",
                    "data": q_data,
                })
        else:
            # Courtroom: send only the winner's question.
            question_data = {
                "agent_id":     winner_agent.id,
                "agent_name":   winner_agent.name,
                "color":        winner_agent.color,
                "question":     winner_question,
                "timestamp":    now_iso,
                "selected":     True,
                "question_type": "question",
                "audio":        audio_b64,
                "audio_format": audio_format,
                "path_topic":   path_topic,
            }
            session['questions_asked'].append(question_data)
            await multi_agent_manager.send_json(session_id, {
                "type": "agent_question",
                "data": question_data,
            })

        # Record the winner's question into the opponent engine so it can
        # exploit weaknesses that the panel has identified.
        global_opponent_engine.record_judge_question(session_id, winner_question)
        logger.info("[MultiAgent] %s selected (of %d candidates): %s…",
                    winner_agent.name, len(candidates), winner_question[:60])

        # Refresh the agenda panel after the agent interrupts.
        # We do NOT feed the agent question to the tracker as a "judge" turn —
        # agent questions are simulated advocate probes, not judicial direction,
        # and skewing the confidence scores toward agent-favoured topics would
        # corrupt the predicted trajectory.  Use the last known tracker state
        # from the human's own speech instead.
        tracker = session.get("tracker")
        if tracker is not None:
            try:
                last_state = tracker.state()  # current state without advancing turn count
                new_predicted = session.get("last_predicted_next", [])
                await multi_agent_manager.send_json(session_id, {
                    "type": "agenda_update",
                    "data": {
                        "best_prediction_id":       last_state.best_prediction_id,
                        "agenda_confidences":       _format_agenda_confidences(last_state),
                        "last_human_matched_topic": last_state.last_human_matched_topic,
                        "predicted_next_topics":    new_predicted,
                        "mcts_tree":                None,
                        "triggered_by":             f"agent:{winner_agent.id}",
                        "regeneration_needed":      last_state.regeneration_needed,
                    },
                })
            except Exception as e:
                logger.warning("Agenda refresh after agent question failed: %s", e)
