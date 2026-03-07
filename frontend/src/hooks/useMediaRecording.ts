/**
 * useMediaRecording Hook
 * 
 * Encapsulates media stream initialization, audio recording, and chunked audio capture
 * for the courtroom simulation.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  AUDIO_CHUNK_DURATION_MS,
  RECORDING_INTERVAL_MS,
} from '../config/simulationConfig'

interface UseMediaRecordingOptions {
  onAudioChunk?: (blob: Blob) => void
  onError?: (error: Error) => void
}

interface UseMediaRecordingReturn {
  /** Whether the camera is currently active */
  isCameraOn: boolean
  /** Whether the microphone is currently active */
  isMicOn: boolean
  /** Whether we're actively recording audio chunks */
  isRecording: boolean
  /** Current audio level (0-255) for visualization */
  audioLevel: number
  /** Ref to attach to video element for preview */
  videoPreviewRef: React.RefObject<HTMLVideoElement>
  /** Start recording audio chunks */
  startRecording: () => void
  /** Stop recording */
  stopRecording: () => void
  /** Stop camera + mic tracks and tear down preview */
  shutdownMedia: () => void
}

export function useMediaRecording(options: UseMediaRecordingOptions = {}): UseMediaRecordingReturn {
  const { onAudioChunk, onError } = options

  // State
  const [isCameraOn, setIsCameraOn] = useState(false)
  const [isMicOn, setIsMicOn] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0)

  // Refs for callbacks (to avoid re-running effects when callbacks change)
  const onAudioChunkRef = useRef(onAudioChunk)
  const onErrorRef = useRef(onError)
  
  // Keep refs up to date
  onAudioChunkRef.current = onAudioChunk
  onErrorRef.current = onError

  // Refs
  const videoPreviewRef = useRef<HTMLVideoElement>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioAnalyzerRef = useRef<AnalyserNode | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const audioAccumulatorRef = useRef<Blob[]>([])
  const recordingIntervalRef = useRef<number | null>(null)
  const isInitializedRef = useRef(false)

  // Initialize media stream on mount (runs once)
  useEffect(() => {
    // Guard against React StrictMode double-mount
    if (isInitializedRef.current) {
      return
    }
    isInitializedRef.current = true

    const initMedia = async () => {
      try {
        console.log('[useMediaRecording] Requesting camera/mic access...')
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        console.log('[useMediaRecording] Media stream obtained')
        mediaStreamRef.current = stream

        // Connect video preview
        if (videoPreviewRef.current) {
          videoPreviewRef.current.srcObject = stream
        }

        // Set up audio context and analyzer
        const audioContext = new AudioContext()
        if (audioContext.state === 'suspended') {
          const resumeAudio = () => {
            audioContext.resume()
            document.removeEventListener('click', resumeAudio)
            document.removeEventListener('keydown', resumeAudio)
          }
          document.addEventListener('click', resumeAudio)
          document.addEventListener('keydown', resumeAudio)
        }

        const source = audioContext.createMediaStreamSource(stream)
        const analyzer = audioContext.createAnalyser()
        analyzer.fftSize = 256
        analyzer.smoothingTimeConstant = 0.5
        source.connect(analyzer)
        audioAnalyzerRef.current = analyzer
        audioContextRef.current = audioContext

        // Audio level monitoring
        const dataArray = new Uint8Array(analyzer.frequencyBinCount)
        let frameCount = 0
        const updateLevel = () => {
          frameCount++
          if (audioAnalyzerRef.current && audioContextRef.current?.state === 'running') {
            audioAnalyzerRef.current.getByteFrequencyData(dataArray)
            const average = dataArray.reduce((a, b) => a + b) / dataArray.length
            if (frameCount % 3 === 0) {
              setAudioLevel(average)
            }
          }
          animationFrameRef.current = requestAnimationFrame(updateLevel)
        }
        updateLevel()

        setIsCameraOn(true)
        setIsMicOn(true)
      } catch (err) {
        console.error('[useMediaRecording] Failed to access camera/mic:', err)
        onErrorRef.current?.(err instanceof Error ? err : new Error('Failed to access media devices'))
      }
    }

    initMedia()

    // Cleanup
    return () => {
      mediaStreamRef.current?.getTracks().forEach(track => track.stop())
      if (mediaRecorderRef.current?.state !== 'inactive') {
        mediaRecorderRef.current?.stop()
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current)
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close()
      }
    }
  }, []) // Empty dependency array - only run once on mount

  // Start recording audio chunks
  const startRecording = useCallback(() => {
    console.log('[useMediaRecording] Starting recording...')
    if (!mediaStreamRef.current) {
      console.warn('[useMediaRecording] No media stream available')
      return
    }

    const startNewRecorder = () => {
      const audioStream = new MediaStream(mediaStreamRef.current!.getAudioTracks())
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : 'audio/webm'
      const recorder = new MediaRecorder(audioStream, { mimeType })

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioAccumulatorRef.current.push(event.data)
        }
      }

      recorder.onstop = () => {
        if (audioAccumulatorRef.current.length > 0) {
          const blobType = recorder.mimeType || mimeType
          const completeBlob = new Blob(audioAccumulatorRef.current, { type: blobType })
          console.log('[useMediaRecording] Audio chunk ready:', completeBlob.size, 'bytes')
          onAudioChunkRef.current?.(completeBlob)
          audioAccumulatorRef.current = []
        }
      }

      recorder.start()
      mediaRecorderRef.current = recorder

      // Stop after chunk duration
      setTimeout(() => {
        if (recorder.state === 'recording') {
          recorder.stop()
        }
      }, AUDIO_CHUNK_DURATION_MS)
    }

    // Start first recording
    startNewRecorder()

    // Set up interval for subsequent recordings
    recordingIntervalRef.current = window.setInterval(() => {
      if (mediaStreamRef.current) {
        startNewRecorder()
      }
    }, RECORDING_INTERVAL_MS)

    setIsRecording(true)
  }, []) // No dependencies - uses refs for callbacks

  // Stop recording
  const stopRecording = useCallback(() => {
    console.log('[useMediaRecording] Stopping recording...')
    
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current)
      recordingIntervalRef.current = null
    }
    
    if (mediaRecorderRef.current?.state !== 'inactive') {
      mediaRecorderRef.current?.stop()
    }
    
    setIsRecording(false)
    audioAccumulatorRef.current = []
  }, [])

  // Hard-stop media stream (camera + mic)
  const shutdownMedia = useCallback(() => {
    stopRecording()

    mediaStreamRef.current?.getTracks().forEach(track => track.stop())
    mediaStreamRef.current = null

    if (videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = null
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close()
      audioContextRef.current = null
    }

    setAudioLevel(0)
    setIsCameraOn(false)
    setIsMicOn(false)
  }, [stopRecording])

  return {
    isCameraOn,
    isMicOn,
    isRecording,
    audioLevel,
    videoPreviewRef,
    startRecording,
    stopRecording,
    shutdownMedia,
  }
}
