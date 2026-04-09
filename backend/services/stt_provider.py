"""
STT Providers — OpenAI Whisper API & local faster-whisper (GPU).

Set STT_PROVIDER=local to use faster-whisper on the local GPU.
Set WHISPER_MODEL to choose the model size (default: "medium").
  Sizes: tiny (~75 MB), base (~140 MB), small (~460 MB),
         medium (~1.5 GB), large-v3 (~3 GB).

Runtime config from media_config.py takes priority over env vars.
"""

import os
import io
import json
import logging
import queue as sync_queue
import subprocess
import tempfile
import threading

import anyio
from abc import ABC, abstractmethod
from openai import AsyncOpenAI

logger = logging.getLogger("court-simulator.stt")

# Formats accepted by the gpt-4o-audio-preview input_audio field
_CHAT_AUDIO_FORMATS = {"wav", "mp3"}

# Phrases the model emits when it can't/won't transcribe (empty/silent audio)
_REFUSAL_PHRASES = (
    "i don't have the capability",
    "i'm unable to",
    "i cannot",
    "i can't",
    "no audio",
    "no speech",
    "unable to listen",
    "unable to transcribe",
    "cannot process audio",
    "cannot listen",
    "there is no audio",
    "there's no audio",
)

# Whisper hallucinations: short phantom phrases the model emits on silence/noise
_HALLUCINATION_PHRASES = {
    "thank you", "thank you.", "thanks.", "thanks for watching",
    "thanks for watching.", "thank you for watching",
    "thank you for watching.", "thanks for listening",
    "thanks for listening.", "bye.", "bye", "goodbye.",
    "you", "you.", "the end.", "the end",
    "subtitles by", "subtitles", "subtitle",
    "please subscribe", "like and subscribe",
    "see you next time", "see you next time.",
}

import re as _re
_NON_LATIN_RE = _re.compile(r'[^\x00-\x7F]{3,}')


def _is_refusal(text: str) -> bool:
    t = text.lower()
    return any(p in t for p in _REFUSAL_PHRASES)


def _is_hallucination(text: str) -> bool:
    """Detect common Whisper hallucinations (short phantoms, non-Latin gibberish)."""
    t = text.strip()
    if not t:
        return True
    if t.lower().rstrip('.!?, ') in _HALLUCINATION_PHRASES or t.lower() in _HALLUCINATION_PHRASES:
        return True
    # Blocks of non-Latin characters (Korean, Chinese, etc.) in an English-only context
    if _NON_LATIN_RE.search(t) and len(t) < 60:
        return True
    # Single repeated word/char (e.g. "you you you you")
    words = t.lower().split()
    if len(words) >= 3 and len(set(words)) == 1:
        return True
    return False


def _wrap_pcm_as_wav(pcm: bytes, sample_rate: int = 16000, channels: int = 1, bits: int = 16) -> bytes:
    """Wrap raw signed-16-bit-LE PCM bytes in a valid WAV header (no ffmpeg needed)."""
    import struct
    byte_rate = sample_rate * channels * (bits // 8)
    block_align = channels * (bits // 8)
    data_size = len(pcm)
    header = struct.pack(
        '<4sI4s4sIHHIIHH4sI',
        b'RIFF', 36 + data_size, b'WAVE',
        b'fmt ', 16, 1, channels,
        sample_rate, byte_rate, block_align, bits,
        b'data', data_size,
    )
    return header + pcm


def _convert_to_wav_sync(audio_data: bytes, src_format: str) -> bytes:
    """Convert audio bytes to 16 kHz mono WAV using ffmpeg (blocking)."""
    if src_format == "pcm":
        return _wrap_pcm_as_wav(audio_data)

    with tempfile.NamedTemporaryFile(suffix=f".{src_format}", delete=False) as inp:
        inp.write(audio_data)
        inp_path = inp.name
    out_path = inp_path[: -len(src_format)] + "wav"
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", inp_path, "-ar", "16000", "-ac", "1", out_path],
            capture_output=True,
            check=True,
            timeout=10,
        )
        with open(out_path, "rb") as f:
            return f.read()
    finally:
        os.unlink(inp_path)
        if os.path.exists(out_path):
            os.unlink(out_path)


class STTProvider(ABC):
    """Base class for STT providers."""

    @abstractmethod
    async def transcribe(self, audio_data: bytes, format: str = "webm") -> str:
        """Transcribe audio data to text."""
        pass


class OpenAIWhisperProvider(STTProvider):
    """OpenAI STT provider.

    Model routing:
    - "audio-preview" models (e.g. gpt-4o-mini-audio-preview): chat completions API
      with input_audio content type.
    - All other models (whisper-1, gpt-4o-transcribe, gpt-4o-mini-transcribe, etc.):
      standard /audio/transcriptions endpoint.
    """

    def __init__(
        self,
        api_key_override: str | None = None,
        base_url_override: str | None = None,
        model_override: str | None = None,
    ):
        api_key  = (api_key_override  or "").strip() or os.getenv("OPENAI_API_KEY", "local")
        base_url = (base_url_override or "").strip() or os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
        self.stt_model = (model_override or "").strip() or "openai/gpt-audio-mini"

        if api_key == "local" and base_url == "https://api.openai.com/v1":
            print("WARNING: OPENAI_API_KEY not set. STT will not work.")
            self.client = None
        else:
            self.client = AsyncOpenAI(api_key=api_key, base_url=base_url)

    @staticmethod
    def _is_chat_audio_model(model: str) -> bool:
        """True for models that require the chat completions API for audio (not /audio/transcriptions)."""
        m = model.lower()
        return "audio-preview" in m or "gpt-audio" in m

    async def transcribe(self, audio_data: bytes, format: str = "webm") -> str:
        if not self.client or len(audio_data) < 4:
            return ""

        if self._is_chat_audio_model(self.stt_model):
            import base64
            # gpt-4o-audio models only accept wav or mp3; convert anything else
            send_format = format if format in _CHAT_AUDIO_FORMATS else "wav"
            if send_format != format:
                audio_data = await anyio.to_thread.run_sync(
                    lambda: _convert_to_wav_sync(audio_data, format)
                )
            audio_b64 = base64.b64encode(audio_data).decode()
            try:
                stream = await self.client.chat.completions.create(
                    model=self.stt_model,
                    stream=True,
                    messages=[
                        {
                            "role": "system",
                            "content": (
                                "You are a transcription engine. "
                                "Output ONLY the verbatim spoken words from the audio. "
                                "No commentary, no punctuation corrections, no explanations. "
                                "If the audio is silent or contains no speech, output nothing."
                            ),
                        },
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "input_audio",
                                    "input_audio": {"data": audio_b64, "format": send_format},
                                },
                                {"type": "text", "text": "Transcribe."},
                            ],
                        },
                    ],
                    modalities=["text"],
                )
                parts: list[str] = []
                async for chunk in stream:
                    delta = chunk.choices[0].delta.content if chunk.choices else None
                    if delta:
                        parts.append(delta)
                result = "".join(parts).strip()
                if _is_refusal(result) or _is_hallucination(result):
                    return ""
                return result
            except Exception as e:
                logger.error("[STT] Chat audio transcription error: %s", e)
                return ""
        else:
            # whisper-style models via the standard /audio/transcriptions endpoint.
            # Very short or empty chunks are skipped to avoid 400s from providers.
            if len(audio_data) < 100:
                return ""

            # Some providers (including Groq) are picky about container/codec, so
            # normalise everything to 16 kHz mono WAV before upload when possible.
            # If ffmpeg fails for a particular chunk, fall back to the original
            # bytes instead of failing the whole transcription call.
            if format != "wav":
                try:
                    audio_data = await anyio.to_thread.run_sync(
                        lambda: _convert_to_wav_sync(audio_data, format)
                    )
                    format = "wav"
                except Exception as e:
                    logger.warning(
                        "[STT] WAV normalisation failed for format=%s; sending original bytes: %s",
                        format, e,
                    )

            audio_file = io.BytesIO(audio_data)
            audio_file.name = f"audio.{format}"
            try:
                response = await self.client.audio.transcriptions.create(
                    model=self.stt_model,
                    file=audio_file,
                    response_format="text",
                    language="en",
                )
                text = response.strip() if isinstance(response, str) else str(response).strip()
                if _is_hallucination(text):
                    logger.debug("[STT] Filtered hallucination: %r", text)
                    return ""
                return text
            except Exception as e:
                logger.error("[STT] Whisper transcription error: %s", e)
                return ""


class LocalWhisperProvider(STTProvider):
    """Local GPU-accelerated STT using faster-whisper (CTranslate2).

    Model is loaded lazily on first transcribe() call so the import
    doesn't block server startup.

    Env vars (used as fallback when no runtime config is set)
    --------
    WHISPER_MODEL : model size — tiny / base / small / medium / large-v3
                    Default "medium" (~1.5 GB VRAM, good accuracy).
    WHISPER_DEVICE : "cuda" (default) or "cpu".
    WHISPER_COMPUTE_TYPE : "float16" (default), "int8_float16", "int8".
    """

    def __init__(
        self,
        model_name: str | None = None,
        device: str | None = None,
        compute_type: str | None = None,
    ):
        self._model = None
        self._model_name   = (model_name   or "").strip() or os.getenv("WHISPER_MODEL",        "medium")
        self._device       = (device       or "").strip() or os.getenv("WHISPER_DEVICE",       "cuda")
        self._compute_type = (compute_type or "").strip() or os.getenv("WHISPER_COMPUTE_TYPE", "float16")

    def _ensure_model(self):
        if self._model is not None:
            return
        try:
            from faster_whisper import WhisperModel
            logger.info(
                "[STT] Loading faster-whisper model=%s device=%s compute=%s",
                self._model_name, self._device, self._compute_type,
            )
            self._model = WhisperModel(
                self._model_name,
                device=self._device,
                compute_type=self._compute_type,
            )
            logger.info("[STT] faster-whisper model loaded successfully")
        except ImportError:
            raise RuntimeError(
                "faster-whisper is not installed. "
                "Run: pip install faster-whisper"
            )

    async def transcribe(self, audio_data: bytes, format: str = "webm") -> str:
        if len(audio_data) < 100:
            return ""

        self._ensure_model()

        if format == "pcm":
            audio_data = _wrap_pcm_as_wav(audio_data)
            format = "wav"

        def _run():
            with tempfile.NamedTemporaryFile(suffix=f".{format}", delete=True) as f:
                f.write(audio_data)
                f.flush()
                segments, info = self._model.transcribe(
                    f.name,
                    beam_size=5,
                    language="en",
                    vad_filter=True,
                    vad_parameters=dict(min_silence_duration_ms=500),
                )
                text = " ".join(seg.text.strip() for seg in segments)
            return text.strip()

        try:
            result = await anyio.to_thread.run_sync(_run)
            return result
        except Exception as e:
            logger.error("[STT] Local whisper transcription error: %s", e)
            return ""


class _GladiaLiveSession:
    """Runs a Gladia live v2 transcription session in a background thread.

    The thread owns its own asyncio event loop and a websockets connection.
    Communication with the trio backend is via two thread-safe queues:
      - _pcm_q  : bytes pushed from trio → consumed by asyncio send loop
      - _tx_q   : final transcript strings produced by asyncio → drained by trio
    """

    _GLADIA_API = "https://api.gladia.io"
    _SAMPLE_RATE = 16000

    def __init__(self, api_key: str, ws_url: str) -> None:
        self._api_key = api_key
        self._ws_url  = ws_url
        self._pcm_q: sync_queue.Queue[bytes | None] = sync_queue.Queue()
        self._tx_q:  sync_queue.Queue[str]          = sync_queue.Queue()
        self._loop   = None
        self._thread = threading.Thread(target=self._run, daemon=True, name="gladia-live")

    def start(self) -> None:
        self._thread.start()

    def send_pcm(self, pcm: bytes) -> None:
        """Thread-safe: enqueue PCM bytes to be sent to Gladia."""
        self._pcm_q.put_nowait(pcm)

    def stop(self) -> None:
        """Signal the asyncio loop to send stop_recording and close."""
        self._pcm_q.put_nowait(None)

    def get_transcript(self) -> str | None:
        """Non-blocking: return the next final transcript or None."""
        try:
            return self._tx_q.get_nowait()
        except sync_queue.Empty:
            return None

    # ── Internal asyncio side ────────────────────────────────────────────────

    def _run(self) -> None:
        import asyncio
        loop = asyncio.new_event_loop()
        self._loop = loop
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(self._session())
        except Exception as e:
            logger.error("[GladiaLive] Session error: %s", e)
        finally:
            loop.close()

    async def _session(self) -> None:
        import asyncio
        import websockets

        try:
            async with websockets.connect(self._ws_url) as ws:
                send_t = asyncio.create_task(self._send_loop(ws))
                recv_t = asyncio.create_task(self._recv_loop(ws))
                done, pending = await asyncio.wait(
                    [send_t, recv_t],
                    return_when=asyncio.FIRST_COMPLETED,
                )
                for t in pending:
                    t.cancel()
        except Exception as e:
            logger.error("[GladiaLive] WebSocket error: %s", e)

    async def _send_loop(self, ws) -> None:
        import asyncio
        while True:
            try:
                pcm = self._pcm_q.get_nowait()
            except sync_queue.Empty:
                await asyncio.sleep(0.02)
                continue
            if pcm is None:
                try:
                    await ws.send(json.dumps({"type": "stop_recording"}))
                except Exception:
                    pass
                return
            await ws.send(pcm)

    async def _recv_loop(self, ws) -> None:
        async for raw in ws:
            try:
                data = json.loads(raw)
                if data.get("type") == "transcript":
                    d = data.get("data", {})
                    if d.get("is_final"):
                        text = (d.get("utterance") or {}).get("text", "").strip()
                        if text:
                            self._tx_q.put_nowait(text)
            except Exception:
                pass


class GladiaLiveProvider(STTProvider):
    """Gladia live v2 real-time STT provider.

    Opens one persistent WebSocket session per recording session.
    Audio must be raw 16-bit mono PCM at 16 kHz (from the frontend AudioContext).

    Session lifecycle (called from main.py):
      await provider.start_session(session_id)    # when RECORDING begins
      provider.send_audio(session_id, pcm_bytes)  # for each audio chunk
      transcript = provider.get_transcript(sid)   # poll (non-blocking) for results
      provider.stop_session(session_id)           # when RECORDING ends

    Orphan recovery: active WebSocket URLs are persisted to
    backend/data/gladia_sessions.json so they can be gracefully closed on the
    next start_session call even after a backend crash/restart — preventing the
    429 concurrent-session limit error.
    """

    _GLADIA_API = "https://api.gladia.io"
    _STATE_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "gladia_sessions.json")

    def __init__(self, api_key: str | None = None) -> None:
        self._api_key = (api_key or "").strip() or os.getenv("GLADIA_API_KEY", os.getenv("STT_API_KEY", ""))
        self._sessions: dict[str, _GladiaLiveSession] = {}
        if not self._api_key:
            logger.warning("[STT] GladiaLiveProvider: GLADIA_API_KEY not set.")

    # ── Persistent state helpers ─────────────────────────────────────────────

    def _load_ws_urls(self) -> dict:
        """Read persisted {session_id: ws_url} map from disk."""
        try:
            with open(self._STATE_FILE) as f:
                return json.load(f)
        except Exception:
            return {}

    def _save_ws_urls(self, state: dict) -> None:
        try:
            os.makedirs(os.path.dirname(self._STATE_FILE), exist_ok=True)
            with open(self._STATE_FILE, "w") as f:
                json.dump(state, f)
        except Exception as e:
            logger.warning("[GladiaLive] Could not persist session state: %s", e)

    async def _close_orphaned_sessions(self) -> None:
        """Close any Gladia WebSocket sessions saved from a previous backend run.

        Connects to each persisted ws_url via a background-thread asyncio loop
        and sends stop_recording so Gladia releases the concurrent-session slot
        before we try to open a new one.  Runs in a thread because the websockets
        library's asyncio client cannot be used directly in the trio event loop.
        Clears the state file regardless of outcome so we don't retry forever.
        """
        state = self._load_ws_urls()
        if not state:
            return

        def _close_all_sync(urls: dict) -> None:
            import asyncio as _asyncio
            import websockets as _ws

            async def _close_one(sid: str, url: str) -> None:
                try:
                    async with _ws.connect(url, open_timeout=5) as conn:
                        await conn.send(json.dumps({"type": "stop_recording"}))
                    logger.info("[GladiaLive] Closed orphaned session %s from previous run", sid)
                except Exception as exc:
                    logger.warning(
                        "[GladiaLive] Could not close orphaned session %s (%s) — may have already expired",
                        sid, exc,
                    )

            async def _close_all(urls: dict) -> None:
                for sid, url in urls.items():
                    await _close_one(sid, url)

            loop = _asyncio.new_event_loop()
            try:
                loop.run_until_complete(_close_all(urls))
            finally:
                loop.close()

        try:
            await anyio.to_thread.run_sync(lambda: _close_all_sync(state))
        except Exception as exc:
            logger.warning("[GladiaLive] Orphaned session cleanup failed: %s", exc)

        self._save_ws_urls({})

    async def start_session(self, session_id: str) -> bool:
        """Init a Gladia live session via HTTP, then open WebSocket in a background thread.

        Cleans up orphaned sessions from previous backend runs before attempting
        to create a new session (prevents 429 concurrent-session limit errors).
        Retries on 429 with exponential backoff covering Gladia's ~30 s auto-close
        window for inactive sessions.

        Returns True if the session was established, False otherwise.
        """
        if session_id in self._sessions:
            logger.warning("[GladiaLive] Session %s already running — skipping", session_id)
            return True

        await self._close_orphaned_sessions()

        import httpx

        # Delays cover Gladia's ~30 s inactive-session auto-close window:
        # attempt 0 (immediate) → 1 (5 s) → 2 (10 s) → 3 (20 s) = 35 s total
        retry_delays = [5, 10, 20]
        ws_url: str | None = None

        for attempt in range(len(retry_delays) + 1):
            if attempt > 0:
                delay = retry_delays[attempt - 1]
                logger.warning(
                    "[GladiaLive] 429 rate limit on session %s — retrying in %ds (attempt %d/%d)",
                    session_id, delay, attempt, len(retry_delays),
                )
                await anyio.sleep(delay)

            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    resp = await client.post(
                        f"{self._GLADIA_API}/v2/live",
                        headers={"X-Gladia-Key": self._api_key, "Content-Type": "application/json"},
                        json={
                            "model": "solaria-1",
                            "encoding": "wav/pcm",
                            "sample_rate": 16000,
                            "bit_depth": 16,
                            "channels": 1,
                            "language_config": {"languages": ["en"], "code_switching": False},
                            "messages_config": {"receive_partial_transcripts": False},
                        },
                    )
                if resp.status_code == 429:
                    if attempt < len(retry_delays):
                        retry_after = resp.headers.get("Retry-After")
                        if retry_after:
                            try:
                                retry_delays[attempt] = max(int(retry_after), 1)
                            except ValueError:
                                pass
                        continue
                    logger.error(
                        "[GladiaLive] Session %s: 429 rate limit persists after %d retries — giving up",
                        session_id, len(retry_delays),
                    )
                    return False
                resp.raise_for_status()
                ws_url = resp.json()["url"]
                break
            except Exception as e:
                logger.error("[GladiaLive] Failed to create session %s: %s", session_id, e)
                return False

        if not ws_url:
            return False

        # Persist the ws_url so it can be closed even if the backend crashes
        # before stop_session is called.
        state = self._load_ws_urls()
        state[session_id] = ws_url
        self._save_ws_urls(state)

        sess = _GladiaLiveSession(self._api_key, ws_url)
        self._sessions[session_id] = sess
        sess.start()
        logger.info("[GladiaLive] Session %s started → %s", session_id, ws_url)
        return True

    def send_audio(self, session_id: str, pcm_bytes: bytes) -> None:
        """Forward PCM audio bytes to the live session (thread-safe, non-blocking)."""
        sess = self._sessions.get(session_id)
        if sess:
            sess.send_pcm(pcm_bytes)

    def get_transcript(self, session_id: str) -> str | None:
        """Non-blocking: return next final transcript or None."""
        sess = self._sessions.get(session_id)
        return sess.get_transcript() if sess else None

    def stop_session(self, session_id: str) -> None:
        """Signal the Gladia session to close and remove it."""
        sess = self._sessions.pop(session_id, None)
        if sess:
            sess.stop()
            # Remove from persistent state so it's not treated as orphaned
            state = self._load_ws_urls()
            state.pop(session_id, None)
            self._save_ws_urls(state)
            logger.info("[GladiaLive] Session %s stopped", session_id)

    async def transcribe(self, _audio_data: bytes, _format: str = "webm") -> str:
        """Not used in live mode — kept for interface compatibility."""
        return ""


# Module-level singleton for GladiaLiveProvider.
# GladiaLiveProvider tracks live sessions in an in-memory dict; creating a new
# instance per WebSocket connection loses that registry.  A singleton ensures
# the session registry survives across reconnects within the same backend process.
_gladia_singleton: "GladiaLiveProvider | None" = None


def get_stt_config_validation_error() -> str | None:
    """Return a user-facing configuration error if STT is misconfigured."""
    try:
        from services.media_config import load_stt_config

        cfg = load_stt_config()
        provider = (cfg.provider or "").lower().strip()
        api_key = (cfg.api_key or "").strip()
        base_url = (cfg.base_url or "").strip().lower()

        if provider == "groq":
            if not api_key:
                return "Speech-to-text is configured for Groq, but no GROQ_API_KEY or STT_API_KEY is set."
            if "api.groq.com" in base_url and not api_key.startswith("gsk_"):
                return "Speech-to-text is configured for Groq, but the configured API key does not look like a Groq key."

        if provider == "openai" and not api_key:
            return "Speech-to-text is configured for OpenAI, but no OPENAI_API_KEY or STT_API_KEY is set."

        if provider == "gladia" and not api_key:
            return "Speech-to-text is configured for Gladia, but no GLADIA_API_KEY or STT_API_KEY is set."

        return None
    except Exception as exc:
        logger.warning("[STT] Could not validate runtime config: %s", exc)
        return None


def get_stt_provider(provider_name: str | None = None) -> STTProvider:
    """Return an STT provider, applying runtime config from media_config if available."""
    global _gladia_singleton
    try:
        from services.media_config import load_stt_config
        cfg = load_stt_config()
        name = cfg.provider.lower().strip()
        if name == "local":
            return LocalWhisperProvider(
                model_name=cfg.whisper_model or None,
                device=cfg.device or None,
                compute_type=cfg.compute_type or None,
            )
        if name == "gladia":
            if _gladia_singleton is None:
                _gladia_singleton = GladiaLiveProvider(api_key=cfg.api_key or None)
            return _gladia_singleton
        return OpenAIWhisperProvider(
            api_key_override=cfg.api_key or None,
            base_url_override=cfg.base_url or None,
            model_override=getattr(cfg, "model", None) or None,
        )
    except Exception as exc:
        logger.warning("Could not load STT runtime config (%s), using env-var defaults", exc)
        name = (provider_name or os.getenv("STT_PROVIDER", "local")).lower().strip()
        if name == "local":
            return LocalWhisperProvider()
        if name == "gladia":
            if _gladia_singleton is None:
                _gladia_singleton = GladiaLiveProvider()
            return _gladia_singleton
        return OpenAIWhisperProvider()
