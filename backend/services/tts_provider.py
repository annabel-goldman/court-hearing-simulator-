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
    """OpenAI TTS provider.

    Accepts optional runtime overrides (from media_config) that take priority
    over env vars.  Falls back to text-only delivery when no valid cloud
    endpoint is available.

    Model routing:
    - "audio-preview" models (e.g. gpt-4o-mini-audio-preview): chat completions API
      with modalities=["audio","text"]; returns mp3.
    - All other models (tts-1, tts-1-hd, gpt-4o-mini-tts, etc.): /audio/speech API;
      returns opus.
    """

    # Set dynamically in __init__ based on model
    audio_format: str = "opus"

    def __init__(
        self,
        api_key_override: str | None = None,
        base_url_override: str | None = None,
        voice_default: str | None = None,
        model: str | None = None,
    ):
        # Runtime overrides take priority; then TTS-specific env vars; then global env vars
        tts_key  = (api_key_override  or "").strip() or os.getenv("TTS_API_KEY",  "").strip()
        tts_url  = (base_url_override or "").strip() or os.getenv("TTS_BASE_URL", "").strip()

        api_key  = tts_key or os.getenv("OPENAI_API_KEY", "")
        base_url = tts_url or os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")

        self.tts_model      = (model or "").strip() or "openai/gpt-audio-mini"
        self._voice_default = (voice_default or "").strip() or "onyx"

        # Chat-completions audio models return mp3; speech-API models return opus
        self.audio_format = "mp3" if self._is_chat_audio_model(self.tts_model) else "opus"

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

        self.available_voices = ["alloy", "ash", "coral", "echo", "fable", "onyx", "nova", "shimmer", "verse"]

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
            # tts-1, tts-1-hd, gpt-4o-mini-tts: standard /audio/speech endpoint
            response = await self.client.audio.speech.create(
                model=self.tts_model,
                voice=resolved_voice,
                input=text,
                response_format="opus",
            )
            audio_bytes = response.read()
            return base64.b64encode(audio_bytes).decode("utf-8")


class CartesiaTTSProvider(TTSProvider):
    """Cartesia TTS provider using the /tts/bytes endpoint.

    Env vars:
      CARTESIA_API_KEY  — required
      CARTESIA_VOICE_ID — voice UUID (find one at app.cartesia.ai/voices)
                          defaults to a0e99841-438c-4a64-b679-ae501e7d6091
      TTS_MODEL         — Cartesia model ID (default: sonic-2)
    """

    audio_format: str = "mp3"
    _API_URL = "https://api.cartesia.ai/tts/bytes"
    _CARTESIA_VERSION = "2024-06-10"
    _DEFAULT_VOICE = "a0e99841-438c-4a64-b679-ae501e7d6091"
    _DEFAULT_MODEL = "sonic-2"

    def __init__(
        self,
        api_key: str | None = None,
        voice_id: str | None = None,
        model: str | None = None,
    ):
        self._api_key  = (api_key  or "").strip() or os.getenv("CARTESIA_API_KEY", "")
        self._voice_id = (voice_id or "").strip() or os.getenv("CARTESIA_VOICE_ID", self._DEFAULT_VOICE)
        self._model    = (model    or "").strip() or os.getenv("TTS_MODEL", self._DEFAULT_MODEL)

        if not self._api_key:
            logger.warning("CartesiaTTSProvider: CARTESIA_API_KEY not set — TTS will return empty.")
        else:
            logger.info("TTS enabled — Cartesia (model=%s, voice=%s)", self._model, self._voice_id)

    async def synthesize(self, text: str, voice: str = "default") -> str:
        if not self._api_key or not text.strip():
            return ""

        import httpx
        import base64

        # `voice` arg here is an override; for Cartesia it must be a UUID
        resolved_voice = voice if (voice != "default" and len(voice) > 8) else self._voice_id

        payload = {
            "model_id": self._model,
            "transcript": text,
            "voice": {"mode": "id", "id": resolved_voice},
            "output_format": {"container": "mp3", "sample_rate": 24000, "bit_rate": 128000},
            "language": "en",
        }
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Cartesia-Version": self._CARTESIA_VERSION,
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(self._API_URL, json=payload, headers=headers)
                resp.raise_for_status()
                return base64.b64encode(resp.content).decode("utf-8")
        except Exception as e:
            logger.error("[TTS] Cartesia synthesis failed: %s", e)
            return ""


def get_tts_provider(provider_name: str = "openai") -> TTSProvider:
    """Return a TTS provider, applying runtime config from media_config if available."""
    try:
        from services.media_config import load_tts_config
        cfg = load_tts_config()
        if not cfg.enabled:
            return _DisabledTTSProvider()
        provider = getattr(cfg, "provider", "openai").lower().strip()
        if provider == "cartesia":
            return CartesiaTTSProvider(
                api_key=cfg.api_key or None,
                voice_id=cfg.voice or None,
                model=cfg.model or None,
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
        if name == "cartesia":
            return CartesiaTTSProvider()
        return OpenAITTSProvider()
