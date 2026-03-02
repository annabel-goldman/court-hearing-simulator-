"""
STT Providers — OpenAI Whisper API & local faster-whisper (GPU).

Set STT_PROVIDER=local to use faster-whisper on the local GPU.
Set WHISPER_MODEL to choose the model size (default: "medium").
  Sizes: tiny (~75 MB), base (~140 MB), small (~460 MB),
         medium (~1.5 GB), large-v3 (~3 GB).
"""

import os
import io
import logging
import tempfile

import anyio
from abc import ABC, abstractmethod
from openai import AsyncOpenAI

logger = logging.getLogger("court-simulator.stt")


class STTProvider(ABC):
    """Base class for STT providers."""
    
    @abstractmethod
    async def transcribe(self, audio_data: bytes, format: str = "webm") -> str:
        """Transcribe audio data to text."""
        pass


class OpenAIWhisperProvider(STTProvider):
    """OpenAI Whisper STT provider."""
    
    def __init__(self):
        api_key = os.getenv("OPENAI_API_KEY", "local")
        base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
        if api_key == "local" and base_url == "https://api.openai.com/v1":
            print("WARNING: OPENAI_API_KEY not set. STT will not work.")
            self.client = None
        else:
            self.client = AsyncOpenAI(api_key=api_key, base_url=base_url)
    
    async def transcribe(self, audio_data: bytes, format: str = "webm") -> str:
        if not self.client or len(audio_data) < 4:
            return ""
        
        audio_file = io.BytesIO(audio_data)
        audio_file.name = f"audio.{format}"
        
        try:
            response = await self.client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                response_format="text"
            )
            return response
        except Exception as e:
            print(f"[STT] Whisper transcription error: {e}")
            return ""


class LocalWhisperProvider(STTProvider):
    """Local GPU-accelerated STT using faster-whisper (CTranslate2).

    Model is loaded lazily on first transcribe() call so the import
    doesn't block server startup.

    Env vars
    --------
    WHISPER_MODEL : model size — tiny / base / small / medium / large-v3
                    Default "medium" (~1.5 GB VRAM, good accuracy).
    WHISPER_DEVICE : "cuda" (default) or "cpu".
    WHISPER_COMPUTE_TYPE : "float16" (default), "int8_float16", "int8".
    """

    def __init__(self):
        self._model = None
        self._model_name = os.getenv("WHISPER_MODEL", "medium")
        self._device = os.getenv("WHISPER_DEVICE", "cuda")
        self._compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "float16")

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

        # faster-whisper needs a file path — write to a temp file.
        # Run the blocking transcription in a thread so we don't block
        # the asyncio event loop.
        def _run():
            with tempfile.NamedTemporaryFile(suffix=f".{format}", delete=True) as f:
                f.write(audio_data)
                f.flush()
                segments, info = self._model.transcribe(
                    f.name,
                    beam_size=5,
                    language="en",
                    vad_filter=True,          # skip silence
                    vad_parameters=dict(
                        min_silence_duration_ms=500,
                    ),
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
    """Return an STT provider.

    Selection priority:
      1. Explicit `provider_name` argument ("openai" or "local").
      2. STT_PROVIDER env var.
      3. Default: "local" (faster-whisper on GPU).
    """
    name = (provider_name or os.getenv("STT_PROVIDER", "local")).lower().strip()
    if name == "local":
        return LocalWhisperProvider()
    return OpenAIWhisperProvider()
