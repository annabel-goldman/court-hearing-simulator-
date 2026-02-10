"""
Modular TTS Provider System
Supports OpenAI, ElevenLabs, and extensible to other providers.
"""

import os
import io
import base64
from abc import ABC, abstractmethod
from typing import Optional

import httpx
from openai import AsyncOpenAI


class TTSProvider(ABC):
    """Base class for TTS providers."""
    
    audio_format: str = "mp3"
    
    @abstractmethod
    async def synthesize(self, text: str, voice: str = "default") -> str:
        """
        Convert text to speech.
        
        Args:
            text: The text to synthesize
            voice: Voice identifier
            
        Returns:
            Base64-encoded audio data
        """
        pass
    
    @abstractmethod
    async def stream(self, text: str, voice: str = "default"):
        """
        Stream audio chunks for low-latency playback.
        
        Yields:
            Audio chunks as bytes
        """
        pass


class OpenAITTSProvider(TTSProvider):
    """OpenAI TTS provider using the tts-1 model."""
    
    audio_format = "opus"
    
    def __init__(self):
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            print("WARNING: OPENAI_API_KEY not set. TTS will not work.")
            self.client = None
        else:
            self.client = AsyncOpenAI(api_key=api_key)
        self.available_voices = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"]
    
    async def synthesize(self, text: str, voice: str = "onyx") -> str:
        if not self.client:
            print("WARNING: OpenAI TTS client not initialized. Returning empty audio.")
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
    
    async def stream(self, text: str, voice: str = "onyx"):
        if not self.client:
            print("WARNING: OpenAI TTS client not initialized. Cannot stream audio.")
            return
        
        if voice not in self.available_voices:
            voice = "onyx"
        
        response = await self.client.audio.speech.create(
            model="tts-1",
            voice=voice,
            input=text,
            response_format="opus"
        )
        
        async for chunk in response.iter_bytes(chunk_size=4096):
            yield chunk


class ElevenLabsTTSProvider(TTSProvider):
    """ElevenLabs TTS provider for high-quality voices."""
    
    audio_format = "mp3"
    
    def __init__(self):
        self.api_key = os.getenv("ELEVENLABS_API_KEY")
        self.base_url = "https://api.elevenlabs.io/v1"
        # Default voice IDs for ElevenLabs
        self.default_voice = "21m00Tcm4TlvDq8ikWAM"  # Rachel
    
    async def synthesize(self, text: str, voice: str = None) -> str:
        voice_id = voice or self.default_voice
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/text-to-speech/{voice_id}",
                headers={
                    "xi-api-key": self.api_key,
                    "Content-Type": "application/json"
                },
                json={
                    "text": text,
                    "model_id": "eleven_monolingual_v1",
                    "voice_settings": {
                        "stability": 0.5,
                        "similarity_boost": 0.75
                    }
                }
            )
            
            if response.status_code != 200:
                raise Exception(f"ElevenLabs API error: {response.text}")
            
            return base64.b64encode(response.content).decode('utf-8')
    
    async def stream(self, text: str, voice: str = None):
        voice_id = voice or self.default_voice
        
        async with httpx.AsyncClient() as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/text-to-speech/{voice_id}/stream",
                headers={
                    "xi-api-key": self.api_key,
                    "Content-Type": "application/json"
                },
                json={
                    "text": text,
                    "model_id": "eleven_monolingual_v1",
                    "voice_settings": {
                        "stability": 0.5,
                        "similarity_boost": 0.75
                    }
                }
            ) as response:
                async for chunk in response.aiter_bytes(chunk_size=1024):
                    yield chunk


class BrowserTTSProvider(TTSProvider):
    """
    Placeholder for browser-based TTS.
    Returns instructions for the frontend to use Web Speech API.
    """
    
    audio_format = "browser"
    
    async def synthesize(self, text: str, voice: str = "default") -> str:
        # Return the text for browser to synthesize
        return base64.b64encode(text.encode('utf-8')).decode('utf-8')
    
    async def stream(self, text: str, voice: str = "default"):
        yield text.encode('utf-8')


# Provider factory
_providers = {
    "openai": OpenAITTSProvider,
    "elevenlabs": ElevenLabsTTSProvider,
    "browser": BrowserTTSProvider,
}


def get_tts_provider(provider_name: str = "openai") -> TTSProvider:
    """Get a TTS provider by name."""
    provider_class = _providers.get(provider_name.lower())
    if not provider_class:
        raise ValueError(f"Unknown TTS provider: {provider_name}")
    return provider_class()


def register_tts_provider(name: str, provider_class: type):
    """Register a custom TTS provider."""
    _providers[name.lower()] = provider_class
