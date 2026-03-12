/**
 * Unified WebSocket hook for courtroom simulation.
 * Routes to simulation backend (/ws/) or orchestrated agents backend (/ws/multi-agent/)
 * based on sessionConfig.useMultiAgentJudge.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type { SimulationPhase } from '../3d-rendering/types'
import type { SessionConfig } from '../3d-rendering/types'
import type { Agent as MultiAgentProfile } from '../multi-agent/types'
import type { SessionAgendaItem } from '../3d-rendering/types'
import { blobToBase64 } from '../features/media/utils/audioEncoding'
import { getWsBase } from '../features/socket/utils/wsBase'
import type {
  AgentScoreEntry,
  JudgeInterrupt,
  JudgeInterruptSource,
  MissedQuestionEntry,
  WebSocketSessionConfig,
} from '../types/socket'
export type {
  AgentScoreEntry,
  JudgeInterrupt,
  JudgeInterruptSource,
  MissedQuestionEntry,
  WebSocketSessionConfig,
} from '../types/socket'

const WS_BASE = getWsBase()

interface UseCourtroomSocketOptions {
  sessionId: string
  sessionConfig: SessionConfig | null
  onPhaseChange?: (phase: SimulationPhase) => void
  onJudgeInterrupt?: (interrupt: JudgeInterrupt) => void
  onTranscriptReceived?: (transcript: string) => void
  onAgentScores?: (scores: AgentScoreEntry[]) => void
  onMissedQuestion?: (entry: MissedQuestionEntry) => void
  onError?: (error: Error) => void
}

interface UseCourtroomSocketReturn {
  isConnected: boolean
  phase: SimulationPhase
  sendConfig: (config: WebSocketSessionConfig) => void
  configureOrchestrated: (
    agents: MultiAgentProfile[],
    briefSummary: string,
    opposingBrief: string,
    predictedTopicSets: unknown,
    agendaItems: SessionAgendaItem[]
  ) => void
  sendAudio: (audioBlob: Blob) => void
  sendSilenceTimeout: () => void
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
    onAgentScores,
    onMissedQuestion,
    onError,
  } = options

  const useOrchestrated = Boolean(sessionConfig?.useMultiAgentJudge)
  const [isConnected, setIsConnected] = useState(false)
  const [phase, setPhase] = useState<SimulationPhase>('OFF_RECORD')
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const configuredOrchestratedRef = useRef(false)

  const callbacksRef = useRef({
    onPhaseChange,
    onJudgeInterrupt,
    onTranscriptReceived,
    onAgentScores,
    onMissedQuestion,
    onError,
  })
  callbacksRef.current = {
    onPhaseChange,
    onJudgeInterrupt,
    onTranscriptReceived,
    onAgentScores,
    onMissedQuestion,
    onError,
  }

  const wsUrl = useOrchestrated
    ? `${WS_BASE}/ws/multi-agent/${sessionId}`
    : `${WS_BASE}/ws/${sessionId}`

  const handleMessage = useCallback((message: { type: string; data?: Record<string, unknown> }) => {
    const data = message.data ?? {}
    const cb = callbacksRef.current
    switch (message.type) {
      case 'phase_update':
        const newPhase = data.phase as SimulationPhase
        if (newPhase === 'PROCEEDING' || newPhase === 'ADJOURNED') {
          setPhase(newPhase)
          cb.onPhaseChange?.(newPhase)
        }
        break

      case 'judge_interrupt':
        cb.onJudgeInterrupt?.({
          question: (data.question as string) ?? '',
          reasoning: data.reasoning as string | undefined,
          audio: data.audio as string | undefined,
          audioFormat: (data.audio_format as string) ?? (data.audioFormat as string),
          source: data.source as JudgeInterruptSource | undefined,
        })
        break

      case 'agent_question':
        if (useOrchestrated) {
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
        }
        break

      case 'transcript_received':
      case 'transcript_update':
        cb.onTranscriptReceived?.((data.text as string) ?? '')
        break

      case 'agent_scores':
        cb.onAgentScores?.((data.scores as AgentScoreEntry[]) ?? [])
        break

      case 'missed_question':
        cb.onMissedQuestion?.(data as unknown as MissedQuestionEntry)
        break

      case 'error':
        cb.onError?.(new Error((data.message as string) ?? 'Unknown error'))
        break

      default:
        break
    }
  }, [useOrchestrated])

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

  const sendConfig = useCallback(
    (config: WebSocketSessionConfig) => {
      if (useOrchestrated) return
      sendMessage('config', config)
    },
    [useOrchestrated, sendMessage]
  )

  const configureOrchestrated = useCallback(
    (
      agents: MultiAgentProfile[],
      briefSummary: string,
      opposingBrief: string,
      predictedTopicSets: unknown,
      agendaItems: SessionAgendaItem[]
    ) => {
      if (!useOrchestrated || configuredOrchestratedRef.current) return
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
    [useOrchestrated, sendMessage]
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

  const sendSilenceTimeout = useCallback(() => {
    if (useOrchestrated) return
    sendMessage('silence_timeout', {})
  }, [useOrchestrated, sendMessage])

  const sendQuestionCutoff = useCallback(() => {
    if (useOrchestrated) {
      sendMessage('phase_change', { phase: 'FINISHED' })
    } else {
      sendMessage('question_cutoff', {})
    }
  }, [useOrchestrated, sendMessage])

  const changePhase = useCallback(
    (newPhase: SimulationPhase) => {
      const backendPhase = useOrchestrated
        ? newPhase === 'PROCEEDING'
          ? 'RECORDING'
          : newPhase === 'ADJOURNED'
            ? 'FINISHED'
            : newPhase
        : newPhase
      sendMessage('phase_change', { phase: backendPhase })
      setPhase(newPhase)
    },
    [useOrchestrated, sendMessage]
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
    sendConfig,
    configureOrchestrated,
    sendAudio,
    sendSilenceTimeout,
    sendQuestionCutoff,
    changePhase,
    disconnect,
  }
}
