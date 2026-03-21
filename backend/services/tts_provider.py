"""
Streamlined OpenAI TTS Provider
"""

import os
import logging
import base64
import re
import time
import threading
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


_GROQ_RETRY_AFTER_RE = re.compile(r"please try again in\s+([0-9hms ]+)", re.IGNORECASE)
_GROQ_HMS_RE = re.compile(r"^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$", re.IGNORECASE)
_GROQ_RATE_LIMIT_LOCK = threading.Lock()
_GROQ_RATE_LIMIT_UNTIL_TS = 0.0


def _parse_retry_after_seconds(error_text: str) -> int:
    """Parse Groq's 'Please try again in 14h20m48s' text into seconds."""
    match = _GROQ_RETRY_AFTER_RE.search(error_text or "")
    if not match:
        return 0
    window = match.group(1).replace(" ", "")
    hms = _GROQ_HMS_RE.match(window)
    if not hms:
        return 0
    hours = int(hms.group(1) or 0)
    minutes = int(hms.group(2) or 0)
    seconds = int(hms.group(3) or 0)
    return (hours * 3600) + (minutes * 60) + seconds


def _is_rate_limit_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return (
        "rate_limit_exceeded" in text
        or "rate limit" in text
        or "error code: 429" in text
        or "status code: 429" in text
    )


def _groq_cooldown_remaining_seconds() -> int:
    global _GROQ_RATE_LIMIT_UNTIL_TS
    now = time.time()
    with _GROQ_RATE_LIMIT_LOCK:
        if now >= _GROQ_RATE_LIMIT_UNTIL_TS:
            _GROQ_RATE_LIMIT_UNTIL_TS = 0.0
            return 0
        return int(_GROQ_RATE_LIMIT_UNTIL_TS - now)


def _set_groq_cooldown(seconds: int) -> int:
    global _GROQ_RATE_LIMIT_UNTIL_TS
    ttl = max(1, int(seconds))
    with _GROQ_RATE_LIMIT_LOCK:
        _GROQ_RATE_LIMIT_UNTIL_TS = max(_GROQ_RATE_LIMIT_UNTIL_TS, time.time() + ttl)
        return int(max(0.0, _GROQ_RATE_LIMIT_UNTIL_TS - time.time()))


class FailoverTTSProvider(TTSProvider):
    """Primary+fallback wrapper with Groq rate-limit stickiness."""

    def __init__(self, primary: TTSProvider, fallback: TTSProvider | None = None, primary_name: str = "openai"):
        self.primary = primary
        self.fallback = fallback
        self.primary_name = (primary_name or "").lower().strip()
        self.audio_format = primary.audio_format

    async def _run_fallback(self, text: str, voice: str, reason: str) -> str:
        if not self.fallback:
            raise RuntimeError(reason)
        logger.warning("TTS fallback engaged: %s", reason)
        audio = await self.fallback.synthesize(text, voice=voice)
        self.audio_format = self.fallback.audio_format
        return audio

    async def synthesize(self, text: str, voice: str = "default") -> str:
        if self.primary_name == "groq":
            cooldown = _groq_cooldown_remaining_seconds()
            if cooldown > 0 and self.fallback:
                return await self._run_fallback(
                    text,
                    voice,
                    f"Groq cooldown active ({cooldown}s remaining)",
                )

        try:
            audio = await self.primary.synthesize(text, voice=voice)
            self.audio_format = self.primary.audio_format
            if audio:
                return audio
            if self.fallback:
                return await self._run_fallback(text, voice, "Primary provider returned empty audio")
            return ""
        except Exception as primary_exc:
            if self.primary_name == "groq" and _is_rate_limit_error(primary_exc):
                retry_after = _parse_retry_after_seconds(str(primary_exc))
                default_retry = int(os.getenv("TTS_GROQ_RATE_LIMIT_COOLDOWN_SECONDS", "3600"))
                cooldown = _set_groq_cooldown(retry_after or default_retry)
                if self.fallback:
                    return await self._run_fallback(
                        text,
                        voice,
                        f"Groq rate-limited; using fallback for {cooldown}s",
                    )
            if self.fallback:
                return await self._run_fallback(text, voice, f"Primary provider failed: {primary_exc}")
            raise


def _openai_fallback_provider() -> TTSProvider | None:
    enabled_raw = os.getenv("TTS_OPENAI_FALLBACK_ENABLED", "true").strip().lower()
    if enabled_raw in {"0", "false", "off", "no"}:
        return None

    api_key = (
        os.getenv("TTS_OPENAI_FALLBACK_API_KEY", "").strip()
        or os.getenv("OPENAI_API_KEY", "").strip()
    )
    if not api_key:
        logger.warning("OpenAI TTS fallback is enabled but no API key is configured")
        return None

    base_url = (
        os.getenv("TTS_OPENAI_FALLBACK_BASE_URL", "").strip()
        or os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").strip()
    )
    model = (
        os.getenv("TTS_OPENAI_FALLBACK_MODEL", "").strip()
        or os.getenv("OPENAI_TTS_MODEL", "").strip()
        or "openai/gpt-audio-mini"
    )
    voice = os.getenv("TTS_OPENAI_FALLBACK_VOICE", "onyx").strip() or "onyx"
    response_format = os.getenv("TTS_OPENAI_FALLBACK_FORMAT", "mp3").strip() or "mp3"

    return OpenAITTSProvider(
        api_key_override=api_key,
        base_url_override=base_url,
        voice_default=voice,
        model=model,
        response_format=response_format,
    )

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
            primary = OpenAITTSProvider(
                api_key_override=(cfg.api_key or os.getenv("GROQ_API_KEY") or "").strip() or None,
                base_url_override=(cfg.base_url or os.getenv("GROQ_BASE_URL") or "").strip() or None,
                voice_default=cfg.voice or None,
                model=cfg.model or None,
                response_format="wav",
                available_voices=["autumn", "diana", "hannah", "austin", "daniel", "troy"],
            )
            return FailoverTTSProvider(primary, fallback=_openai_fallback_provider(), primary_name="groq")
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
            primary = OpenAITTSProvider(
                api_key_override=os.getenv("GROQ_API_KEY") or os.getenv("TTS_API_KEY"),
                base_url_override=os.getenv("GROQ_BASE_URL") or os.getenv("TTS_BASE_URL") or "https://api.groq.com/openai/v1",
                voice_default=os.getenv("TTS_VOICE", "austin"),
                model=os.getenv("TTS_MODEL", "canopylabs/orpheus-v1-english"),
                response_format="wav",
                available_voices=["autumn", "diana", "hannah", "austin", "daniel", "troy"],
            )
            return FailoverTTSProvider(primary, fallback=_openai_fallback_provider(), primary_name="groq")
        return OpenAITTSProvider()
