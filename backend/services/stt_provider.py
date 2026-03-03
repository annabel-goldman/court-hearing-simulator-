"""
Streamlined OpenAI STT (Whisper) Provider
"""

import os
import io
from abc import ABC, abstractmethod
from openai import AsyncOpenAI


class STTProvider(ABC):
    """Base class for STT providers."""
    
    @abstractmethod
    async def transcribe(self, audio_data: bytes, format: str = "webm") -> str:
        """Transcribe audio data to text."""
        pass


class OpenAIWhisperProvider(STTProvider):
    """OpenAI Whisper STT provider."""
    
    def __init__(self):
        api_key = os.getenv("OPENAI_API_KEY")
        self.model = os.getenv("OPENAI_STT_MODEL", "whisper-1")
        if not api_key:
            print("WARNING: OPENAI_API_KEY not set. STT will not work.")
            self.client = None
        else:
            self.client = AsyncOpenAI(api_key=api_key)
    
    async def transcribe(self, audio_data: bytes, format: str = "webm") -> str:
        if not self.client or len(audio_data) < 4:
            return ""
        
        audio_file = io.BytesIO(audio_data)
        audio_file.name = f"audio.{format}"
        
        try:
            response = await self.client.audio.transcriptions.create(
                model=self.model,
                file=audio_file,
                response_format="text"
            )
            if isinstance(response, str):
                return response.strip()
            # Some SDK/model combinations return a structured object.
            text = getattr(response, "text", "")
            if isinstance(text, str):
                return text.strip()
            return str(text or "").strip()
        except Exception as e:
            print(f"[STT] Transcription error with model {self.model}: {e}")
            return ""


def get_stt_provider(provider_name: str = "openai") -> STTProvider:
    """Get the default OpenAI STT provider."""
    return OpenAIWhisperProvider()
