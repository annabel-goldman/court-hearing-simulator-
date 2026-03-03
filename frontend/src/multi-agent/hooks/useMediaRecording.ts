/**
 * Media recording hook — raw PCM capture for Gladia live STT.
 *
 * Uses AudioContext + ScriptProcessorNode to capture 16 kHz, 16-bit, mono PCM
 * audio in ~256 ms chunks and send them as base64 over WebSocket.
 * This format matches what Gladia live v2 expects (wav/pcm, 16000 Hz, 16-bit, 1ch).
 */

import { useCallback, useRef, useState } from 'react';

const SAMPLE_RATE   = 16000;
const BUFFER_SIZE   = 4096;   // samples — ~256 ms at 16 kHz

interface UseMediaRecordingProps {
  onAudioChunk: (audioBase64: string) => void;
}

interface UseMediaRecordingReturn {
  isRecording: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  error: string | null;
}

function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
  }
  return int16;
}

function int16ToBase64(int16: Int16Array): string {
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  // Use chunks to avoid call-stack overflow on large buffers
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function useMediaRecording({ onAudioChunk }: UseMediaRecordingProps): UseMediaRecordingReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError]             = useState<string | null>(null);

  const ctxRef       = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef    = useRef<MediaStream | null>(null);

  const startRecording = useCallback(async () => {
    try {
      setError(null);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      ctxRef.current = ctx;

      const source    = ctx.createMediaStreamSource(stream);
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const processor = ctx.createScriptProcessor(BUFFER_SIZE, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (event) => {
        const float32 = event.inputBuffer.getChannelData(0);
        const int16   = float32ToInt16(float32);
        const b64     = int16ToBase64(int16);
        onAudioChunk(b64);
      };

      source.connect(processor);
      processor.connect(ctx.destination);

      setIsRecording(true);
    } catch (err) {
      console.error('Failed to start recording:', err);
      setError('Failed to access microphone. Please check permissions.');
      throw err;
    }
  }, [onAudioChunk]);

  const stopRecording = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.onaudioprocess = null;
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (ctxRef.current) {
      ctxRef.current.close();
      ctxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsRecording(false);
  }, []);

  return { isRecording, startRecording, stopRecording, error };
}
