/**
 * Media recording hook for multi-agent simulation
 * Captures audio and sends chunks for transcription.
 *
 * Strategy: every AUDIO_CHUNK_DURATION_MS we stop the MediaRecorder, collect
 * the recorded blob (which is a complete, self-contained WebM/MP4 file),
 * send it as base64, then immediately start a fresh recording on the same
 * stream.  This guarantees every chunk the backend receives is a valid audio
 * file that Whisper can transcribe.
 */

import { useCallback, useRef, useState } from 'react';

const AUDIO_CHUNK_DURATION_MS = 3000;

interface UseMediaRecordingProps {
  onAudioChunk: (audioBase64: string) => void;
}

interface UseMediaRecordingReturn {
  isRecording: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  error: string | null;
}

export function useMediaRecording({ onAudioChunk }: UseMediaRecordingProps): UseMediaRecordingReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>('audio/webm');
  /** Guard: true while we're in the stop→flush→restart cycle */
  const cyclingRef = useRef(false);

  /** Flush accumulated chunks as a single complete audio blob. */
  const flushChunks = useCallback(() => {
    const chunks = chunksRef.current;
    if (chunks.length === 0) return;
    chunksRef.current = [];

    const blob = new Blob(chunks, { type: mimeRef.current });
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      if (base64) {
        onAudioChunk(base64);
      }
    };
    reader.readAsDataURL(blob);
  }, [onAudioChunk]);

  /** Create and start a new MediaRecorder on the current stream. */
  const createRecorder = useCallback((stream: MediaStream) => {
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/mp4';
    mimeRef.current = mime;

    const recorder = new MediaRecorder(stream, { mimeType: mime });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };
    mediaRecorderRef.current = recorder;
    recorder.start();       // no timeslice — we control stopping ourselves
  }, []);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      createRecorder(stream);
      setIsRecording(true);

      // Every AUDIO_CHUNK_DURATION_MS: stop → flush → restart
      intervalRef.current = window.setInterval(() => {
        const recorder = mediaRecorderRef.current;
        const stream = streamRef.current;
        if (!recorder || !stream || cyclingRef.current) return;

        if (recorder.state === 'recording') {
          cyclingRef.current = true;
          recorder.onstop = () => {
            flushChunks();
            // Start a brand-new recorder on the same mic stream
            if (streamRef.current) {
              createRecorder(streamRef.current);
            }
            cyclingRef.current = false;
          };
          recorder.stop();
        }
      }, AUDIO_CHUNK_DURATION_MS);
    } catch (err) {
      console.error('Failed to start recording:', err);
      setError('Failed to access microphone. Please check permissions.');
      throw err;
    }
  }, [onAudioChunk, createRecorder, flushChunks]);

  const stopRecording = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'recording') {
      recorder.onstop = () => {
        flushChunks();         // send the final partial chunk
      };
      recorder.stop();
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    mediaRecorderRef.current = null;
    cyclingRef.current = false;
    setIsRecording(false);
  }, [flushChunks]);

  return {
    isRecording,
    startRecording,
    stopRecording,
    error,
  };
}
