"""
Streamlined OpenAI TTS Provider
"""

import os
import logging
import base64
from abc import ABC, abstractmethod
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)


class TTSProvider(ABC):
    """Base class for TTS providers."""

    audio_format: str = "mp3"

    @abstractmethod
    async def synthesize(self, text: str, voice: str = "default") -> str:
        """Convert text to speech. Returns base64-encoded audio or empty string."""
        pass


class _DisabledTTSProvider(TTSProvider):
    """No-op provider used when TTS is disabled in media_config."""
    audio_format = "mp3"

    async def synthesize(self, text: str, voice: str = "default") -> str:
        return ""


class OpenAITTSProvider(TTSProvider):
    """OpenAI-compatible TTS provider (OpenAI, Groq, etc.).

    Accepts optional runtime overrides (from media_config) that take priority
    over env vars.  Falls back to text-only delivery when no valid cloud
    endpoint is available.

    Model routing:
    - "audio-preview" models (e.g. gpt-4o-mini-audio-preview): chat completions API
      with modalities=["audio","text"]; returns mp3.
    - All other models (tts-1, tts-1-hd, gpt-4o-mini-tts, canopylabs/orpheus-*, etc.):
      /audio/speech API; returns opus or wav depending on response_format param.
    """

    # Set dynamically in __init__ based on model and response_format
    audio_format: str = "opus"

    def __init__(
        self,
        api_key_override: str | None = None,
        base_url_override: str | None = None,
        voice_default: str | None = None,
        model: str | None = None,
        response_format: str | None = None,
        available_voices: list[str] | None = None,
    ):
        # Runtime overrides take priority; then TTS-specific env vars; then global env vars
        tts_key  = (api_key_override  or "").strip() or os.getenv("TTS_API_KEY",  "").strip()
        tts_url  = (base_url_override or "").strip() or os.getenv("TTS_BASE_URL", "").strip()

        api_key  = tts_key or os.getenv("OPENAI_API_KEY", "")
        base_url = tts_url or os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")

        self.tts_model      = (model or "").strip() or "openai/gpt-audio-mini"
        self._voice_default = (voice_default or "").strip() or "onyx"
        self._response_format = (response_format or "").strip() or None
        self.available_voices = available_voices or ["alloy", "ash", "coral", "echo", "fable", "onyx", "nova", "shimmer", "verse"]

        # Chat-completions audio models return mp3; speech-API models use response_format or opus
        if self._is_chat_audio_model(self.tts_model):
            self.audio_format = "mp3"
        elif self._response_format:
            self.audio_format = self._response_format
        else:
            self.audio_format = "opus"

        # Detect local-only setup
        is_local = (
            api_key.lower() in ("local", "dummy", "")
            or "localhost" in base_url
            or "127.0.0.1" in base_url
        )

        if is_local and not tts_key:
            logger.info("TTS disabled — local LLM server does not support audio. "
                        "Set TTS_API_KEY + TTS_BASE_URL to enable cloud TTS.")
            self.client = None
        else:
            self.client = AsyncOpenAI(api_key=api_key, base_url=base_url)
            logger.info("TTS enabled — using %s (model=%s, format=%s)",
                        base_url, self.tts_model, self.audio_format)

    @staticmethod
    def _is_chat_audio_model(model: str) -> bool:
        """True for models that require the chat completions API for audio (not /audio/speech)."""
        m = model.lower()
        return "audio-preview" in m or "gpt-audio" in m

    async def synthesize(self, text: str, voice: str = "default") -> str:
        if not self.client:
            return ""

        resolved_voice = voice if voice in self.available_voices else self._voice_default

        if self._is_chat_audio_model(self.tts_model):
            # gpt-4o-mini-audio-preview / gpt-4o-audio-preview: chat completions with audio output
            response = await self.client.chat.completions.create(
                model=self.tts_model,
                modalities=["text", "audio"],
                audio={"voice": resolved_voice, "format": "mp3"},
                messages=[{"role": "user", "content": text}],
            )
            audio_obj = response.choices[0].message.audio
            if audio_obj and audio_obj.data:
                return audio_obj.data  # already base64-encoded
            return ""
        else:
            # tts-1, tts-1-hd, gpt-4o-mini-tts, canopylabs/orpheus-*: standard /audio/speech endpoint
            fmt = self._response_format or "opus"
            response = await self.client.audio.speech.create(
                model=self.tts_model,
                voice=resolved_voice,
                input=text,
                response_format=fmt,
            )
            audio_bytes = response.read()
            return base64.b64encode(audio_bytes).decode("utf-8")


def get_tts_provider(provider_name: str = "openai") -> TTSProvider:
    """Return a TTS provider, applying runtime config from media_config if available."""
    try:
        from services.media_config import load_tts_config
        cfg = load_tts_config()
        # `enabled` flag from the config is intentionally ignored here — TTS
        # is always attempted when a valid endpoint is reachable.  The provider
        # itself silently returns "" when no real API key is available, so
        # disabling via config is unnecessary and caused silent failures.
        provider = getattr(cfg, "provider", "openai").lower().strip()
        if provider == "groq":
            return OpenAITTSProvider(
                api_key_override=(cfg.api_key or os.getenv("GROQ_API_KEY") or "").strip() or None,
                base_url_override=(cfg.base_url or os.getenv("GROQ_BASE_URL") or "").strip() or None,
                voice_default=cfg.voice or None,
                model=cfg.model or None,
                response_format="wav",
                available_voices=["autumn", "diana", "hannah", "austin", "daniel", "troy"],
            )
        return OpenAITTSProvider(
            api_key_override=cfg.api_key or None,
            base_url_override=cfg.base_url or None,
            voice_default=cfg.voice or None,
            model=cfg.model or None,
        )
    except Exception as exc:
        logger.warning("Could not load TTS runtime config (%s), using env-var defaults", exc)
        name = (provider_name or os.getenv("TTS_PROVIDER", "openai")).lower().strip()
        if name == "groq":
            return OpenAITTSProvider(
                api_key_override=os.getenv("GROQ_API_KEY") or os.getenv("TTS_API_KEY"),
                base_url_override=os.getenv("GROQ_BASE_URL") or os.getenv("TTS_BASE_URL") or "https://api.groq.com/openai/v1",
                voice_default=os.getenv("TTS_VOICE", "austin"),
                model=os.getenv("TTS_MODEL", "canopylabs/orpheus-v1-english"),
                response_format="wav",
                available_voices=["autumn", "diana", "hannah", "austin", "daniel", "troy"],
            )
        return OpenAITTSProvider()
