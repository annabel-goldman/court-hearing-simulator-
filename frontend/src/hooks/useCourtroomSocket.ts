/**
 * WebSocket hook for courtroom simulation.
 * Connects to the multi-agent backend (/ws/multi-agent/).
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type { SimulationPhase } from '../3d-rendering/types'
import type { SessionConfig } from '../3d-rendering/types'
import type { Agent as MultiAgentProfile } from '../multi-agent/types'
import type { SessionAgendaItem } from '../3d-rendering/types'
import { blobToBase64 } from '../features/media/utils/audioEncoding'
import { getWsBase } from '../features/socket/utils/wsBase'
import type {
  JudgeInterrupt,
} from '../types/socket'

const WS_BASE = getWsBase()

interface UseCourtroomSocketOptions {
  sessionId: string
  sessionConfig: SessionConfig | null
  onPhaseChange?: (phase: SimulationPhase) => void
  onJudgeInterrupt?: (interrupt: JudgeInterrupt) => void
  onTranscriptReceived?: (transcript: string) => void
  onError?: (error: Error) => void
}

interface UseCourtroomSocketReturn {
  isConnected: boolean
  phase: SimulationPhase
  configureOrchestrated: (
    agents: MultiAgentProfile[],
    briefSummary: string,
    opposingBrief: string,
    predictedTopicSets: unknown,
    agendaItems: SessionAgendaItem[]
  ) => void
  sendAudio: (audioBlob: Blob) => void
  sendQuestionCutoff: () => void
  changePhase: (phase: SimulationPhase) => void
  disconnect: () => void
}

export function useCourtroomSocket(
  options: UseCourtroomSocketOptions
): UseCourtroomSocketReturn {
  const {
    sessionId,
    sessionConfig,
    onPhaseChange,
    onJudgeInterrupt,
    onTranscriptReceived,
    onError,
  } = options

  const [isConnected, setIsConnected] = useState(false)
  const [phase, setPhase] = useState<SimulationPhase>('OFF_RECORD')
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const configuredOrchestratedRef = useRef(false)

  const callbacksRef = useRef({
    onPhaseChange,
    onJudgeInterrupt,
    onTranscriptReceived,
    onError,
  })
  callbacksRef.current = {
    onPhaseChange,
    onJudgeInterrupt,
    onTranscriptReceived,
    onError,
  }

  const wsUrl = `${WS_BASE}/ws/multi-agent/${sessionId}`

  const handleMessage = useCallback((message: { type: string; data?: Record<string, unknown> }) => {
    const data = message.data ?? {}
    const cb = callbacksRef.current
    switch (message.type) {
      case 'phase_update': {
        const newPhase = data.phase as SimulationPhase
        if (newPhase === 'PROCEEDING' || newPhase === 'ADJOURNED') {
          setPhase(newPhase)
          cb.onPhaseChange?.(newPhase)
        }
        break
      }

      case 'agent_question':
        cb.onJudgeInterrupt?.({
          question: (data.question as string) ?? '',
          audio: data.audio as string | undefined,
          audioFormat: (data.audio_format as string) ?? 'opus',
          source: {
            type: 'multi_agent',
            agent_id: data.agent_id as string | undefined,
            agent_name: (data.agent_name as string) ?? 'Judge',
            agent_color: (data.color as string) ?? '#f0c040',
          },
        })
        break

      case 'transcript_update':
        cb.onTranscriptReceived?.((data.text as string) ?? '')
        break

      case 'error':
        cb.onError?.(new Error((data.message as string) ?? 'Unknown error'))
        break

      default:
        break
    }
  }, [])

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    console.log('[CourtroomSocket] Connecting to:', wsUrl)
    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      console.log('[CourtroomSocket] Connected')
      setIsConnected(true)
    }

    ws.onclose = (event) => {
      console.log('[CourtroomSocket] Disconnected:', event.code, event.reason)
      setIsConnected(false)
      wsRef.current = null
      configuredOrchestratedRef.current = false
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connect()
      }, 3000)
    }

    ws.onerror = () => {
      console.error('[CourtroomSocket] Connection error')
      callbacksRef.current.onError?.(new Error('WebSocket connection error'))
    }

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
        handleMessage(message)
      } catch (e) {
        console.error('[CourtroomSocket] Parse error:', e)
      }
    }

    wsRef.current = ws
  }, [wsUrl, handleMessage])

  const sendMessage = useCallback((type: string, payload: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, data: payload }))
    }
  }, [])

  const configureOrchestrated = useCallback(
    (
      agents: MultiAgentProfile[],
      briefSummary: string,
      opposingBrief: string,
      predictedTopicSets: unknown,
      agendaItems: SessionAgendaItem[]
    ) => {
      if (configuredOrchestratedRef.current) return
      configuredOrchestratedRef.current = true
      sendMessage('config', {
        agents,
        brief_summary: briefSummary,
        opposing_brief: opposingBrief,
        mode: 'courtroom',
      })
      if (predictedTopicSets && agendaItems.length > 0) {
        sendMessage('set_agenda', {
          predicted_topic_sets: predictedTopicSets,
          agenda_items: agendaItems,
        })
      }
    },
    [sendMessage]
  )

  const sendAudio = useCallback(
    async (audioBlob: Blob) => {
      try {
        const base64 = await blobToBase64(audioBlob)
        sendMessage('audio', { audio: base64 })
      } catch (error) {
        console.warn('[CourtroomSocket] Failed to encode audio chunk:', error)
      }
    },
    [sendMessage]
  )

  const sendQuestionCutoff = useCallback(() => {
    sendMessage('phase_change', { phase: 'FINISHED' })
  }, [sendMessage])

  const changePhase = useCallback(
    (newPhase: SimulationPhase) => {
      const backendPhase =
        newPhase === 'PROCEEDING'
          ? 'RECORDING'
          : newPhase === 'ADJOURNED'
            ? 'FINISHED'
            : newPhase
      sendMessage('phase_change', { phase: backendPhase })
      setPhase(newPhase)
    },
    [sendMessage]
  )

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setIsConnected(false)
    configuredOrchestratedRef.current = false
  }, [])

  useEffect(() => {
    if (!sessionConfig) return
    const timer = setTimeout(connect, 150)
    return () => {
      clearTimeout(timer)
      disconnect()
    }
  }, [sessionConfig, connect, disconnect])

  return {
    isConnected,
    phase,
    configureOrchestrated,
    sendAudio,
    sendQuestionCutoff,
    changePhase,
    disconnect,
  }
}
