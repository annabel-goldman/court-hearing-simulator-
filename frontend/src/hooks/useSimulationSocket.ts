/**
 * WebSocket hook for real-time courtroom simulation.
 * Handles connection to the backend for judge interruptions, STT, and TTS.
 */

import { useEffect, useRef, useCallback } from 'react'
import type { SimulationPhase } from '../3d-rendering/types'
import type { SessionConfig } from '../3d-rendering/types'
import type {
  AgentScoreEntry,
  JudgeInterrupt,
  JudgeInterruptSource,
  MissedQuestionEntry,
  WebSocketSessionConfig,
} from '../types/socket'
import { useCourtroomSocket } from './useCourtroomSocket'
export type {
  AgentScoreEntry,
  JudgeInterrupt,
  JudgeInterruptSource,
  MissedQuestionEntry,
  WebSocketSessionConfig,
} from '../types/socket'

interface UseSimulationSocketOptions {
  sessionId: string
  onPhaseChange?: (phase: SimulationPhase) => void
  onJudgeInterrupt?: (interrupt: JudgeInterrupt) => void
  onTranscriptReceived?: (transcript: string) => void
  onAgentScores?: (scores: AgentScoreEntry[]) => void
  onMissedQuestion?: (entry: MissedQuestionEntry) => void
  onError?: (error: Error) => void
}

interface UseSimulationSocketReturn {
  isConnected: boolean
  phase: SimulationPhase
  sendConfig: (config: WebSocketSessionConfig) => void
  sendAudio: (audioBlob: Blob) => void
  sendSilenceTimeout: () => void
  sendQuestionCutoff: () => void
  changePhase: (phase: SimulationPhase) => void
  disconnect: () => void
}

const LEGACY_SIMULATION_SESSION_CONFIG: SessionConfig = {
  proceedingType: 'demo',
  userRole: 'attorney',
  materials: [],
  useMultiAgentJudge: false,
}

export function useSimulationSocket(
  options: UseSimulationSocketOptions
): UseSimulationSocketReturn {
  const socket = useCourtroomSocket({
    sessionId: options.sessionId,
    sessionConfig: LEGACY_SIMULATION_SESSION_CONFIG,
    onPhaseChange: options.onPhaseChange,
    onJudgeInterrupt: options.onJudgeInterrupt,
    onTranscriptReceived: options.onTranscriptReceived,
    onAgentScores: options.onAgentScores,
    onMissedQuestion: options.onMissedQuestion,
    onError: options.onError,
  })

  return socket
}

/**
 * Hook for audio streaming (TTS interruptions)
 */
export function useAudioPlayer() {
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioQueueRef = useRef<AudioBuffer[]>([])
  const isPlayingRef = useRef(false)

  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
    }
    return audioContextRef.current
  }, [])

  const playAudioChunk = useCallback(async (base64Audio: string, format: string = 'opus') => {
    console.log('[AudioPlayer] Playing audio chunk, format:', format, 'length:', base64Audio?.length || 0)
    
    if (!base64Audio || base64Audio.length === 0) {
      console.warn('[AudioPlayer] Empty audio data received')
      return
    }
    
    const context = initAudioContext()
    
    // Resume context if suspended (browser autoplay policy)
    if (context.state === 'suspended') {
      console.log('[AudioPlayer] Resuming suspended AudioContext')
      await context.resume()
    }
    
    try {
      // Decode base64 to ArrayBuffer
      const binaryString = atob(base64Audio)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      
      console.log('[AudioPlayer] Decoding audio data, bytes:', bytes.length)
      
      // Decode audio data
      const audioBuffer = await context.decodeAudioData(bytes.buffer.slice(0))
      console.log('[AudioPlayer] Audio decoded, duration:', audioBuffer.duration, 's')
      
      // Play immediately or queue
      if (!isPlayingRef.current) {
        playBuffer(context, audioBuffer)
      } else {
        audioQueueRef.current.push(audioBuffer)
      }
    } catch (e) {
      console.error('[AudioPlayer] Error playing audio chunk:', e)
    }
  }, [initAudioContext])

  const playBuffer = useCallback((context: AudioContext, buffer: AudioBuffer) => {
    isPlayingRef.current = true
    
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)
    
    source.onended = () => {
      // Play next in queue or mark as not playing
      if (audioQueueRef.current.length > 0) {
        const nextBuffer = audioQueueRef.current.shift()!
        playBuffer(context, nextBuffer)
      } else {
        isPlayingRef.current = false
      }
    }
    
    source.start()
  }, [])

  const stopAll = useCallback(() => {
    audioQueueRef.current = []
    isPlayingRef.current = false
    
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAll()
    }
  }, [stopAll])

  return {
    playAudioChunk,
    stopAll,
    isPlaying: isPlayingRef.current
  }
}
