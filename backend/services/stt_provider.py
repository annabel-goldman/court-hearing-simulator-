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
import logging
import subprocess
import tempfile

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

def _is_refusal(text: str) -> bool:
    t = text.lower()
    return any(p in t for p in _REFUSAL_PHRASES)


def _convert_to_wav_sync(audio_data: bytes, src_format: str) -> bytes:
    """Convert audio bytes to 16 kHz mono WAV using ffmpeg (blocking)."""
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
                return "" if _is_refusal(result) else result
            except Exception as e:
                logger.error("[STT] Chat audio transcription error: %s", e)
                return ""
        else:
            # whisper-1, gpt-4o-transcribe, gpt-4o-mini-transcribe: standard endpoint
            audio_file = io.BytesIO(audio_data)
            audio_file.name = f"audio.{format}"
            try:
                response = await self.client.audio.transcriptions.create(
                    model=self.stt_model,
                    file=audio_file,
                    response_format="text",
                )
                return response
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


def get_stt_provider(provider_name: str | None = None) -> STTProvider:
    """Return an STT provider, applying runtime config from media_config if available."""
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
        return OpenAIWhisperProvider()
