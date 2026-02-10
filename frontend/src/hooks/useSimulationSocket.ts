/**
 * WebSocket hook for real-time courtroom simulation.
 * Handles connection to the backend for judge interruptions, STT, and TTS.
 */

import { useState, useEffect, useRef, useCallback } from 'react'

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws'

export type SimulationPhase = 
  | 'OFF_RECORD'
  | 'ALL_RISE'
  | 'JUDGE_ENTERING'
  | 'JUDGE_SEATED'
  | 'PROCEEDING'
  | 'ADJOURNED'

export interface JudgeInterrupt {
  question: string
  reasoning?: string
  audio?: string  // Base64-encoded audio
  audioFormat?: string  // 'opus', 'mp3', etc.
}

export interface SessionConfig {
  proceedingType: 'appellate' | 'demo'
  userRole: 'attorney' | 'self-represented'
  judgePersonality?: string
  interruptionFrequency?: string
}

interface UseSimulationSocketOptions {
  sessionId: string
  onPhaseChange?: (phase: SimulationPhase) => void
  onJudgeInterrupt?: (interrupt: JudgeInterrupt) => void
  onTranscriptReceived?: (transcript: string) => void
  onError?: (error: Error) => void
}

interface UseSimulationSocketReturn {
  isConnected: boolean
  phase: SimulationPhase
  sendConfig: (config: SessionConfig & { seed_questions?: any[]; brief_summary?: string }) => void
  sendTranscript: (text: string) => void
  sendAudio: (audioBlob: Blob) => void
  requestInterrupt: () => void
  changePhase: (phase: SimulationPhase) => void
  disconnect: () => void
}

export function useSimulationSocket(
  options: UseSimulationSocketOptions
): UseSimulationSocketReturn {
  const { 
    sessionId, 
    onPhaseChange, 
    onJudgeInterrupt, 
    onTranscriptReceived,
    onError 
  } = options

  const [isConnected, setIsConnected] = useState(false)
  const [phase, setPhase] = useState<SimulationPhase>('OFF_RECORD')
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('[WS] Already connected')
      return
    }

    const wsUrl = `${WS_URL}/${sessionId}`
    console.log('[WS] Connecting to:', wsUrl)
    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      console.log('[WS] Connected successfully')
      setIsConnected(true)
    }

    ws.onclose = (event) => {
      console.log('[WS] Disconnected. Code:', event.code, 'Reason:', event.reason)
      setIsConnected(false)
      
      // Attempt to reconnect after 3 seconds
      reconnectTimeoutRef.current = window.setTimeout(() => {
        console.log('[WS] Attempting to reconnect...')
        connect()
      }, 3000)
    }

    ws.onerror = () => {
      console.error('[WS] Connection error. Is the backend running at', WS_URL, '?')
      onError?.(new Error('WebSocket connection error'))
    }

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
        console.log('[WS] Message received:', message.type, message.data)
        handleMessage(message)
      } catch (e) {
        console.error('[WS] Failed to parse message:', e)
      }
    }

    wsRef.current = ws
  }, [sessionId])

  // Handle incoming messages
  const handleMessage = useCallback((message: { type: string; data: any }) => {
    switch (message.type) {
      case 'phase_update':
        // Only accept phase updates from backend for PROCEEDING and ADJOURNED
        // Ritual phases (ALL_RISE, JUDGE_ENTERING, JUDGE_SEATED) are controlled by frontend
        const newPhase = message.data.phase as SimulationPhase
        if (newPhase === 'PROCEEDING' || newPhase === 'ADJOURNED') {
          console.log('[WS] Accepting phase update from backend:', newPhase)
          setPhase(newPhase)
          onPhaseChange?.(newPhase)
        } else {
          console.log('[WS] Ignoring ritual phase update from backend:', newPhase, '(frontend controls ritual)')
        }
        break

      case 'judge_interrupt':
        onJudgeInterrupt?.({
          question: message.data.question,
          reasoning: message.data.reasoning,
          audio: message.data.audio,
          audioFormat: message.data.audio_format
        })
        break

      case 'transcript_received':
        onTranscriptReceived?.(message.data.text || '')
        break
      
      case 'transcript_update':
        onTranscriptReceived?.(message.data.text || '')
        break

      case 'error':
        onError?.(new Error(message.data.message || 'Unknown error'))
        break

      default:
        console.log('Unknown message type:', message.type)
    }
  }, [onPhaseChange, onJudgeInterrupt, onTranscriptReceived, onError])

  // Send message helper
  const sendMessage = useCallback((type: string, data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, data }))
    } else {
      console.warn('WebSocket not connected, cannot send message')
    }
  }, [])

  // Public API
  const sendConfig = useCallback((config: SessionConfig) => {
    sendMessage('config', config)
  }, [sendMessage])

  const sendTranscript = useCallback((text: string) => {
    sendMessage('transcript', { text })
  }, [sendMessage])

  const sendAudio = useCallback(async (audioBlob: Blob) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      console.warn('[WS] Not connected, cannot send audio')
      return
    }
    
    console.log('[WS] Converting audio blob to base64, size:', audioBlob.size)
    // Convert blob to base64
    const reader = new FileReader()
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1]
      console.log('[WS] Sending audio, base64 length:', base64?.length || 0)
      sendMessage('audio', { audio: base64 })
    }
    reader.readAsDataURL(audioBlob)
  }, [sendMessage])

  const requestInterrupt = useCallback(() => {
    sendMessage('request_interrupt', {})
  }, [sendMessage])

  const changePhase = useCallback((newPhase: SimulationPhase) => {
    sendMessage('phase_change', { phase: newPhase })
    setPhase(newPhase)
  }, [sendMessage])

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
    }
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setIsConnected(false)
  }, [])

  // Connect on mount (with cleanup handling for React StrictMode double-mount)
  useEffect(() => {
    // Small delay to avoid React StrictMode double-mount race condition
    const connectTimer = setTimeout(() => {
      connect()
    }, 50)
    
    return () => {
      clearTimeout(connectTimer)
      disconnect()
    }
  }, [connect, disconnect])

  return {
    isConnected,
    phase,
    sendConfig,
    sendTranscript,
    sendAudio,
    requestInterrupt,
    changePhase,
    disconnect
  }
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
