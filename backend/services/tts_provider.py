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


class OpenAITTSProvider(TTSProvider):
    """OpenAI TTS provider using the tts-1 model.

    Requires a real OpenAI API key and the official OpenAI endpoint.
    When TTS_API_KEY / TTS_BASE_URL are set they override the defaults,
    allowing TTS to use the cloud API while LLM inference runs locally.

    If no valid cloud endpoint is available, synthesize() returns "" and
    the caller falls back to text-only delivery.
    """
    
    audio_format = "opus"
    
    def __init__(self):
        # TTS-specific overrides (preferred)
        tts_key  = os.getenv("TTS_API_KEY", "").strip()
        tts_url  = os.getenv("TTS_BASE_URL", "").strip()

        # Fall back to the general OpenAI env vars
        api_key  = tts_key or os.getenv("OPENAI_API_KEY", "")
        base_url = tts_url or os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")

        # Detect local-only setup: key is "local" or URL points to a local server
        is_local = (
            api_key.lower() in ("local", "dummy", "")
            or "localhost" in base_url
            or "127.0.0.1" in base_url
        )

        if is_local and not tts_key:
            # No dedicated TTS key and running against a local LLM server
            logger.info("TTS disabled — local LLM server does not support /audio/speech. "
                        "Set TTS_API_KEY + TTS_BASE_URL to enable cloud TTS.")
            self.client = None
        else:
            self.client = AsyncOpenAI(api_key=api_key, base_url=base_url)
            logger.info("TTS enabled — using %s", base_url)

        self.available_voices = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"]
    
    async def synthesize(self, text: str, voice: str = "onyx") -> str:
        if not self.client:
            return ""
        
        if voice not in self.available_voices:
            voice = "onyx"
        
        response = await self.client.audio.speech.create(
            model="tts-1",
            voice=voice,
            input=text,
            response_format="opus"
        )
        
        audio_bytes = response.read()
        return base64.b64encode(audio_bytes).decode('utf-8')


def get_tts_provider(provider_name: str = "openai") -> TTSProvider:
    """Get the default OpenAI TTS provider."""
    return OpenAITTSProvider()
