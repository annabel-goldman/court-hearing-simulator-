"""
Streamlined OpenAI TTS Provider
"""

import os
import base64
from abc import ABC, abstractmethod
from openai import AsyncOpenAI


class TTSProvider(ABC):
    """Base class for TTS providers."""
    
    audio_format: str = "mp3"
    
    @abstractmethod
    async def synthesize(self, text: str, voice: str = "default") -> str:
        """Convert text to speech."""
        pass


class OpenAITTSProvider(TTSProvider):
    """OpenAI TTS provider using the tts-1 model."""
    
    audio_format = "opus"
    
    def __init__(self):
        api_key = os.getenv("OPENAI_API_KEY")
        self.model = os.getenv("OPENAI_TTS_MODEL", "tts-1")
        if not api_key:
            print("WARNING: OPENAI_API_KEY not set. TTS will not work.")
            self.client = None
        else:
            self.client = AsyncOpenAI(
                api_key=api_key,
                base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
            )
        self.available_voices = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"]
    
    async def synthesize(self, text: str, voice: str = "onyx") -> str:
        if not self.client:
            raise RuntimeError("OPENAI_API_KEY not configured for TTS")
        
        if voice not in self.available_voices:
            voice = "onyx"
        
        response = await self.client.audio.speech.create(
            model=self.model,
            voice=voice,
            input=text,
            response_format="opus"
        )
        
        audio_bytes = response.read()
        if not audio_bytes:
            raise RuntimeError(f"OpenAI TTS returned empty audio for model {self.model}")
        return base64.b64encode(audio_bytes).decode('utf-8')


def get_tts_provider(provider_name: str = "openai") -> TTSProvider:
    """Get the default OpenAI TTS provider."""
    return OpenAITTSProvider()
