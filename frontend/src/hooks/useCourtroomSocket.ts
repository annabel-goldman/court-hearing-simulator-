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

const extractSpokenQuestion = (text: string): string => {
  const cleaned = (text ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  if (!cleaned) return ''

  const lines = cleaned
    .split('\n')
    .map(line =>
      line
        .trim()
        .replace(/^\s*(?:[-*#]+|\d+\.)\s*/, '')
        .replace(/\*\*/g, '')
        .replace(/^QUESTION:\s*/i, '')
        .trim(),
    )
    .filter(Boolean)
    .filter(
      line =>
        !/^(analyze the|deconstruct|identify the|formulate|drafting|refining|adopt the persona|role:|context:|goal:|topic:|task:|style:|operating rules|input context|case summary|their argument:)/i.test(
          line,
        ),
    )

  const questionLine = [...lines].reverse().find(line => line.includes('?'))
  if (questionLine) return questionLine

  const sentence = lines.join(' ').split(/(?<=[.!?])\s+/).filter(Boolean).pop() ?? ''
  if (!sentence) return cleaned
  return /[?]$/.test(sentence) ? sentence : `${sentence.replace(/[.!]+$/, '')}?`
}

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
      case 'config_ack':
        console.log('[CourtroomSocket] Config acknowledged:', data)
        break

      case 'agenda_set_ack':
        console.log('[CourtroomSocket] Agenda acknowledged:', data)
        break

      case 'agents_updated':
        console.log('[CourtroomSocket] Agents updated:', data)
        break

      case 'phase_update': {
        const newPhase = data.phase as SimulationPhase
        if (newPhase === 'PROCEEDING' || newPhase === 'ADJOURNED') {
          setPhase(newPhase)
          cb.onPhaseChange?.(newPhase)
        }
        break
      }

      case 'agent_question':
        console.log('[CourtroomSocket] Agent question received:', {
          agent: data.agent_name,
          selected: data.selected,
          questionType: data.question_type,
          hasAudio: Boolean(data.audio),
        })
        if (data.selected === false) {
          console.log('[CourtroomSocket] Ignoring non-selected candidate response')
          break
        }
        if (data.question_type === 'counter') {
          console.log('[CourtroomSocket] Ignoring counter-argument in courtroom mode')
          break
        }
        cb.onJudgeInterrupt?.({
          question: extractSpokenQuestion((data.question as string) ?? ''),
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
        console.log('[CourtroomSocket] Transcript update received:', {
          chars: ((data.text as string) ?? '').length,
          preview: ((data.text as string) ?? '').slice(0, 80),
        })
        cb.onTranscriptReceived?.((data.text as string) ?? '')
        break

      case 'stt_error': {
        const messageText = (data.message as string) ?? 'Speech-to-text is unavailable'
        console.error('[CourtroomSocket] STT error:', messageText)
        cb.onError?.(new Error(messageText))
        break
      }

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
      console.log('[CourtroomSocket] Sending courtroom config:', {
        agentCount: agents.length,
        hasBriefSummary: Boolean(briefSummary.trim()),
        hasOpposingBrief: Boolean(opposingBrief.trim()),
        agendaItemCount: agendaItems.length,
      })
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
