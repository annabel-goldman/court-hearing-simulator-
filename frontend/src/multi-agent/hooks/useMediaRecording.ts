/**
 * Media recording hook for multi-agent simulation
 * Captures audio and sends chunks for transcription only when the user is speaking.
 * Uses Voice Activity Detection (VAD) to avoid sending silence.
 */

import { useCallback, useRef, useState } from 'react';
import { blobToBase64, pickSupportedAudioMimeType } from '../../features/media/utils/audioEncoding';

const AUDIO_CHUNK_DURATION_MS = 4000;
const VAD_ENABLED = true;
const VAD_RMS_THRESHOLD = 2;
const VAD_CHECK_INTERVAL_MS = 100;
const VAD_FFT_SIZE = 2048;

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
  const audioContextRef = useRef<AudioContext | null>(null);
  const vadIntervalRef = useRef<number | null>(null);
  const chunkHadSpeechRef = useRef(true);
  const prevChunkHadSpeechRef = useRef(false);
  const peakRmsRef = useRef(0);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      if (VAD_ENABLED) {
        const audioContext = new AudioContext();
        await audioContext.resume();
        audioContextRef.current = audioContext;
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = VAD_FFT_SIZE;
        analyser.smoothingTimeConstant = 0.3;
        source.connect(analyser);
        const dataArray = new Uint8Array(analyser.fftSize);
        chunkHadSpeechRef.current = false;
        peakRmsRef.current = 0;

        vadIntervalRef.current = window.setInterval(() => {
          analyser.getByteTimeDomainData(dataArray);
          let sumSq = 0;
          for (let i = 0; i < dataArray.length; i++) {
            const v = dataArray[i] - 128;
            sumSq += v * v;
          }
          const rms = Math.sqrt(sumSq / dataArray.length);
          if (rms > peakRmsRef.current) peakRmsRef.current = rms;
          if (rms > VAD_RMS_THRESHOLD) chunkHadSpeechRef.current = true;
        }, VAD_CHECK_INTERVAL_MS);
      } else {
        chunkHadSpeechRef.current = true;
      }

      const preferWebm = pickSupportedAudioMimeType(
        ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'],
        'audio/webm'
      );
      const mediaRecorder = new MediaRecorder(stream, { mimeType: preferWebm });
      mediaRecorderRef.current = mediaRecorder;

      const chunks: Blob[] = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const hadSpeech = chunkHadSpeechRef.current;
        const prevHadSpeech = prevChunkHadSpeechRef.current;
        const shouldSend = hadSpeech || prevHadSpeech || !VAD_ENABLED;

        if (chunks.length > 0 && shouldSend) {
          const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
          blobToBase64(blob)
            .then(onAudioChunk)
            .catch((err) => console.warn('[MultiAgentRecorder] Failed to encode chunk:', err));
        } else if (chunks.length > 0 && VAD_ENABLED) {
          console.debug('[VAD] Chunk dropped — peak RMS %.1f < threshold %d', peakRmsRef.current, VAD_RMS_THRESHOLD);
        }

        prevChunkHadSpeechRef.current = hadSpeech;
        chunks.length = 0;
        if (VAD_ENABLED) {
          chunkHadSpeechRef.current = false;
          peakRmsRef.current = 0;
        }
      };

      mediaRecorder.start();
      setIsRecording(true);

      intervalRef.current = window.setInterval(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.stop();
          mediaRecorderRef.current.start();
        }
      }, AUDIO_CHUNK_DURATION_MS);

    } catch (err) {
      console.error('Failed to start recording:', err);
      setError('Failed to access microphone. Please check permissions.');
    }
  }, [onAudioChunk]);

  const stopRecording = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    mediaRecorderRef.current = null;
    prevChunkHadSpeechRef.current = false;
    setIsRecording(false);
  }, []);

  return {
    isRecording,
    startRecording,
    stopRecording,
    error,
  };
}
