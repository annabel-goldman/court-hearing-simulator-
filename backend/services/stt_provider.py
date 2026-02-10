"""
Modular STT (Speech-to-Text) Provider System
Supports OpenAI Whisper, Deepgram, and extensible to other providers.
"""

import os
import io
import base64
from abc import ABC, abstractmethod
from typing import Optional, AsyncIterator

import httpx
from openai import AsyncOpenAI


class STTProvider(ABC):
    """Base class for STT providers."""
    
    @abstractmethod
    async def transcribe(self, audio_data: bytes, format: str = "webm") -> str:
        """
        Transcribe audio data to text.
        
        Args:
            audio_data: Raw audio bytes
            format: Audio format (webm, wav, mp3, etc.)
            
        Returns:
            Transcribed text
        """
        pass
    
    @abstractmethod
    async def stream_transcribe(self, audio_stream: AsyncIterator[bytes]) -> AsyncIterator[str]:
        """
        Stream transcription for real-time audio.
        
        Yields:
            Partial transcription strings
        """
        pass


class OpenAIWhisperProvider(STTProvider):
    """OpenAI Whisper STT provider."""
    
    def __init__(self):
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            print("WARNING: OPENAI_API_KEY not set. STT will not work.")
            self.client = None
        else:
            self.client = AsyncOpenAI(api_key=api_key)
    
    async def transcribe(self, audio_data: bytes, format: str = "webm") -> str:
        if not self.client:
            print("WARNING: OpenAI Whisper client not initialized. Cannot transcribe.")
            return ""
        
        # Check if we have valid WebM data (should start with EBML header)
        if len(audio_data) < 4:
            print(f"[STT] Audio data too small: {len(audio_data)} bytes")
            return ""
        
        # WebM files start with 0x1A45DFA3 (EBML header)
        if audio_data[:4] != b'\x1a\x45\xdf\xa3':
            print(f"[STT] Audio data does not have WebM header. First 4 bytes: {audio_data[:4].hex()}")
            # Try to transcribe anyway - OpenAI might handle it
        
        print(f"[STT] Transcribing {len(audio_data)} bytes of {format} audio...")
        
        # Create a file-like object from bytes
        audio_file = io.BytesIO(audio_data)
        audio_file.name = f"audio.{format}"
        
        try:
            response = await self.client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                response_format="text"
            )
            print(f"[STT] Transcription successful: {response[:50]}..." if len(response) > 50 else f"[STT] Transcription: {response}")
            return response
        except Exception as e:
            print(f"[STT] Whisper transcription error: {e}")
            return ""
    
    async def stream_transcribe(self, audio_stream: AsyncIterator[bytes]) -> AsyncIterator[str]:
        # Whisper doesn't support true streaming, so we batch chunks
        buffer = b""
        async for chunk in audio_stream:
            buffer += chunk
            # Transcribe every ~2 seconds of audio (assuming ~16KB/s for webm)
            if len(buffer) > 32000:
                result = await self.transcribe(buffer)
                if result:
                    yield result
                buffer = b""
        
        # Transcribe any remaining audio
        if buffer:
            result = await self.transcribe(buffer)
            if result:
                yield result


class DeepgramProvider(STTProvider):
    """Deepgram STT provider for real-time streaming."""
    
    def __init__(self):
        self.api_key = os.getenv("DEEPGRAM_API_KEY")
        self.base_url = "https://api.deepgram.com/v1"
    
    async def transcribe(self, audio_data: bytes, format: str = "webm") -> str:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/listen",
                headers={
                    "Authorization": f"Token {self.api_key}",
                    "Content-Type": f"audio/{format}"
                },
                content=audio_data,
                params={
                    "model": "nova-2",
                    "smart_format": "true",
                    "punctuate": "true"
                }
            )
            
            if response.status_code != 200:
                print(f"Deepgram error: {response.text}")
                return ""
            
            result = response.json()
            transcript = result.get("results", {}).get("channels", [{}])[0].get("alternatives", [{}])[0].get("transcript", "")
            return transcript
    
    async def stream_transcribe(self, audio_stream: AsyncIterator[bytes]) -> AsyncIterator[str]:
        # For true streaming, use Deepgram's WebSocket API
        # This is a simplified batch implementation
        buffer = b""
        async for chunk in audio_stream:
            buffer += chunk
            if len(buffer) > 16000:  # ~1 second of audio
                result = await self.transcribe(buffer)
                if result:
                    yield result
                buffer = b""
        
        if buffer:
            result = await self.transcribe(buffer)
            if result:
                yield result


class BrowserSTTProvider(STTProvider):
    """
    Placeholder for browser-based STT.
    Returns instructions for the frontend to use Web Speech API.
    """
    
    async def transcribe(self, audio_data: bytes, format: str = "webm") -> str:
        # Browser handles STT client-side
        return ""
    
    async def stream_transcribe(self, audio_stream: AsyncIterator[bytes]) -> AsyncIterator[str]:
        # Not applicable for browser-based STT
        yield ""


# Provider factory
_providers = {
    "openai": OpenAIWhisperProvider,
    "deepgram": DeepgramProvider,
    "browser": BrowserSTTProvider,
}


def get_stt_provider(provider_name: str = "openai") -> STTProvider:
    """Get an STT provider by name."""
    provider_class = _providers.get(provider_name.lower())
    if not provider_class:
        raise ValueError(f"Unknown STT provider: {provider_name}")
    return provider_class()


def register_stt_provider(name: str, provider_class: type):
    """Register a custom STT provider."""
    _providers[name.lower()] = provider_class
