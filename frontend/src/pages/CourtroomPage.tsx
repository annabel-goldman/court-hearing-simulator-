/**
 * CourtroomPage
 * 
 * Main courtroom simulation page that orchestrates:
 * - 3D scene rendering (via CourtroomScene)
 * - WebSocket communication for real-time judge interrupts
 * - Audio recording and transcription
 * - Ritual phase progression
 * - UI overlays (HUD, judge questions, ritual prompts)
 */

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lipsync } from 'wawa-lipsync'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

// 3D Rendering
import {
  COURTROOM_ANIMATION_STATE_OPTIONS,
  CourtroomScene,
  type AvatarAnimationStateKey,
} from '../3d-rendering/CourtroomScene'
import type { JudgeAvatarDifficulty, SpeakingRole, SimulationPhase, SessionConfig } from '../3d-rendering/types'

// UI Overlays
import { JudgeSpeechOverlay } from '../ui-overlays/JudgeSpeechOverlay'
import { StatusDashboardHUD } from '../ui-overlays/StatusDashboardHUD'
import { InterruptLogPanel } from '../ui-overlays/InterruptLogPanel'
import { AgentSentimentPanel } from '../ui-overlays/AgentSentimentPanel'

// Hooks
import {
  useCourtroomSocket,
  type JudgeInterrupt,
  type JudgeInterruptSource,
  type AgentScoreEntry,
  type MissedQuestionEntry,
} from '../hooks/useCourtroomSocket'
import { useAudioPlayer } from '../hooks/useSimulationSocket'
import { useMediaRecording } from '../hooks/useMediaRecording'
import type { Agent } from '../multi-agent/types'

// Configuration
import {
  RECORDING_SYNC_DELAY_MS,
  DEMO_SESSION_DURATION_SECONDS,
  TRANSCRIPT_DISPLAY_DURATION_MS,
  MS_PER_WORD,
  MIN_SPEAKING_TIME_MS,
  FALLBACK_QUESTION_TIMEOUT_MS,
  RITUAL_START_DELAY_MS,
  JUDGE_ENTERING_DURATION_MS,
  PROCEEDING_START_DELAY_MS,
  OPENING_STATEMENT_DURATION_MS,
  BROWSER_TTS_RATE,
  BROWSER_TTS_PITCH,
  TIMER_INTERVAL_MS,
  SILENCE_AUDIO_LEVEL_THRESHOLD,
  SILENCE_TRIGGER_MS,
  TIMER_OVERTIME_SECONDS,
} from '../config/simulationConfig'
import type {
  SessionAuditPayload,
  SessionQuestionRecord,
  MissedQuestionRecord,
  SessionTranscriptRecord,
} from '../types/sessionAudit'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const TTS_ENDPOINT = `${API_URL}/api/tts`
const ALL_RISE_AUTO_ADVANCE_MS = 1600
const SESSION_AUDIT_STORAGE_KEY = 'courtSessionAudit'
const JUDGE_DIFFICULTY_STORAGE_KEY = 'judgeAvatarDifficulty'
const DEFAULT_ANIMATION_PULSE_MS = 2200
const ONE_SHOT_ANIMATION_STATES = new Set<AvatarAnimationStateKey>(['clap', 'cheer', 'sitTransition', 'sitToStand'])

function isJudgeAvatarDifficulty(value: unknown): value is JudgeAvatarDifficulty {
  return value === 'easy' || value === 'medium' || value === 'hard'
}

function readStoredJudgeAvatarDifficulty(): JudgeAvatarDifficulty {
  if (typeof window === 'undefined') return 'medium'
  const stored = window.localStorage.getItem(JUDGE_DIFFICULTY_STORAGE_KEY)
  return isJudgeAvatarDifficulty(stored) ? stored : 'medium'
}

type AnimationDebugRole = keyof typeof COURTROOM_ANIMATION_STATE_OPTIONS
type AnimationStateOverrideMap = Partial<Record<AnimationDebugRole, AvatarAnimationStateKey | null>>
type AnimationConsoleApi = {
  states: typeof COURTROOM_ANIMATION_STATE_OPTIONS
  get: () => AnimationStateOverrideMap
  set: (role: AnimationDebugRole, state: AvatarAnimationStateKey | null) => boolean
  clear: (role?: AnimationDebugRole) => void
  pulse: (role: AnimationDebugRole, state: AvatarAnimationStateKey, durationMs?: number) => boolean
  demo: (role?: AnimationDebugRole) => void
  help: () => string
}

declare global {
  interface Window {
    courtAnim?: AnimationConsoleApi
  }
}

export default function CourtroomPage() {
  const navigate = useNavigate()

  // ========== STATE ==========
  const [speakingRole, setSpeakingRole] = useState<SpeakingRole>(null)
  const [simulationPhase, setSimulationPhase] = useState<SimulationPhase>('OFF_RECORD')
  const [sessionConfig, setSessionConfig] = useState<SessionConfig | null>(null)
  const [currentJudgeQuestion, setCurrentJudgeQuestion] = useState<string | null>(null)
  const [currentInterruptSource, setCurrentInterruptSource] = useState<JudgeInterruptSource | null>(null)
  const [recentTranscript, setRecentTranscript] = useState<string>('')
  const [timerSeconds, setTimerSeconds] = useState(DEMO_SESSION_DURATION_SECONDS)
  const [questionHistory, setQuestionHistory] = useState<SessionQuestionRecord[]>([])
  const [missedQuestions, setMissedQuestions] = useState<MissedQuestionRecord[]>([])
  const [transcriptHistory, setTranscriptHistory] = useState<SessionTranscriptRecord[]>([])
  const [agentScores, setAgentScores] = useState<Record<string, AgentScoreEntry>>({})
  const [showBenchPanels, setShowBenchPanels] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [animationStateOverrides, setAnimationStateOverrides] = useState<AnimationStateOverrideMap>({})
  const [judgeAvatarDifficulty, setJudgeAvatarDifficulty] = useState<JudgeAvatarDifficulty>(() =>
    readStoredJudgeAvatarDifficulty()
  )

  // ========== REFS ==========
  const lipsyncRef = useRef<Lipsync | null>(null)
  const orbitControlsRef = useRef<OrbitControlsImpl>(null)
  const questionTimeoutRef = useRef<number | null>(null)
  const silenceStartAtRef = useRef<number | null>(null)
  const silenceQuestionRequestedRef = useRef(false)
  const judgeQuestionActiveRef = useRef(false)
  const timerOvertimePendingRef = useRef(false)
  const questionCutoffReachedRef = useRef(false)
  const sessionStartedAtRef = useRef<number | null>(null)
  const sessionEndedAtRef = useRef<number | null>(null)
  const hasFinalizedSessionRef = useRef(false)
  const animationOverrideRef = useRef<AnimationStateOverrideMap>({})
  const animationDebugTimersRef = useRef<number[]>([])

  // Session ID
  const sessionId = useMemo(() => `session_${Date.now()}`, [])

  // Audio player for judge TTS
  const { playAudioChunk } = useAudioPlayer()

  const loadAgentsForOrchestrated = useCallback(async (): Promise<Agent[]> => {
    try {
      const response = await fetch(`${API_URL}/api/multi-agent/agents`)
      if (!response.ok) throw new Error(`Failed to load agents (${response.status})`)
      const payload = (await response.json()) as { agents?: Agent[] }
      return payload.agents ?? []
    } catch (error) {
      console.warn('[CourtroomPage] Failed to load agents; using empty panel:', error)
      return []
    }
  }, [])

  // ========== WEBSOCKET ==========
  const handleAgentScores = useCallback((scores: AgentScoreEntry[]) => {
    setAgentScores(prev => {
      const next = { ...prev }
      for (const score of scores) {
        if (score.relevance !== null || !next[score.agent_id]) {
          // Agent was evaluated this pass — full update.
          next[score.agent_id] = score
        } else {
          // Agent was not evaluated this pass — keep last relevance bar visible
          // but clear should_ask so ASKING only reflects the current pass.
          next[score.agent_id] = { ...next[score.agent_id], on_cooldown: score.on_cooldown, should_ask: false }
        }
      }
      return next
    })
  }, [])

  const handleMissedQuestion = useCallback((entry: MissedQuestionEntry) => {
    setMissedQuestions(prev => [...prev, {
      id: `missed_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      question: entry.question,
      timestamp: entry.timestamp,
      agentId: entry.agent_id,
      agentName: entry.agent_name,
      agentColor: entry.agent_color,
      relevance: entry.relevance,
      reason: entry.reason,
    }])
  }, [])

  const useOrchestrated = Boolean(sessionConfig?.useMultiAgentJudge)

  const {
    isConnected,
    sendConfig,
    configureOrchestrated,
    sendAudio,
    sendSilenceTimeout,
    sendQuestionCutoff,
    changePhase: sendPhaseChange,
    disconnect: disconnectSocket,
  } = useCourtroomSocket({
    sessionId,
    sessionConfig,
    onJudgeInterrupt: handleJudgeInterrupt,
    onAgentScores: handleAgentScores,
    onMissedQuestion: handleMissedQuestion,
    onPhaseChange: (phase) => {
      if (phase === 'PROCEEDING' || phase === 'ADJOURNED') {
        setSimulationPhase(phase)
      }
    },
    onTranscriptReceived: (transcript: string) => {
      setRecentTranscript(transcript)
      const cleanTranscript = transcript.trim()
      if (cleanTranscript.length > 0) {
        setTranscriptHistory((prev) => {
          if (prev.length > 0 && prev[prev.length - 1].text === cleanTranscript) return prev
          return [...prev, { text: cleanTranscript, timestamp: new Date().toISOString() }]
        })
      }
      setTimeout(() => setRecentTranscript(''), TRANSCRIPT_DISPLAY_DURATION_MS)
    },
    onError: (error) => console.error('[CourtroomPage] WebSocket error:', error),
  })

  // ========== MEDIA RECORDING ==========
  const {
    isCameraOn,
    isMicOn,
    isRecording,
    audioLevel,
    videoPreviewRef,
    startRecording,
    stopRecording,
    shutdownMedia,
  } = useMediaRecording({
    onAudioChunk: (blob) => {
      if (isConnected) {
        sendAudio(blob)
      } else {
        console.warn('[CourtroomPage] Audio chunk dropped — not connected to backend')
      }
    },
    onError: (error) => {
      console.error('[CourtroomPage] Media error:', error)
    }
  })

  useEffect(() => {
    animationOverrideRef.current = animationStateOverrides
  }, [animationStateOverrides])

  const clearAnimationDebugTimers = useCallback(() => {
    animationDebugTimersRef.current.forEach((timerId) => clearTimeout(timerId))
    animationDebugTimersRef.current = []
  }, [])

  const setAnimationOverride = useCallback((role: AnimationDebugRole, state: AvatarAnimationStateKey | null) => {
    setAnimationStateOverrides((prev) => ({ ...prev, [role]: state }))
  }, [])

  const clearAnimationOverride = useCallback((role?: AnimationDebugRole) => {
    if (role) {
      setAnimationStateOverrides((prev) => ({ ...prev, [role]: null }))
      return
    }
    setAnimationStateOverrides({})
  }, [])

  const handleAnimationStateFinished = useCallback(
    (role: AnimationDebugRole, state: AvatarAnimationStateKey) => {
      if (!ONE_SHOT_ANIMATION_STATES.has(state)) return
      setAnimationStateOverrides((prev) => {
        if (prev[role] !== state) return prev
        return { ...prev, [role]: null }
      })
    },
    []
  )

  const animationSpeakingRole = useMemo<SpeakingRole>(() => speakingRole, [speakingRole])

  const endJudgeSpeech = useCallback(() => {
    setCurrentJudgeQuestion(null)
    setCurrentInterruptSource(null)
    setSpeakingRole(null)
    judgeQuestionActiveRef.current = false

    if (timerOvertimePendingRef.current) {
      setTimerSeconds(() => {
        timerOvertimePendingRef.current = false
        return TIMER_OVERTIME_SECONDS
      })
    }
  }, [])

  // ========== JUDGE INTERRUPT HANDLER ==========
  function handleJudgeInterrupt(interrupt: JudgeInterrupt) {
    if (questionCutoffReachedRef.current) {
      console.log('[CourtroomPage] Ignoring judge interrupt after timer cutoff:', interrupt.question)
      return
    }

    const source = interrupt.source
    const sourceType = source?.type === 'multi_agent' ? 'multi_agent' : 'judge_engine'
    const agentName = sourceType === 'multi_agent'
      ? source?.agent_name || source?.agent_id || 'Unnamed Agent'
      : 'Judge Engine'

    setQuestionHistory(prev => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        question: interrupt.question,
        timestamp: new Date().toISOString(),
        sourceType,
        agentId: source?.agent_id,
        agentName,
        agentColor: source?.agent_color,
      },
    ])

    if (source?.type === 'multi_agent') {
      console.log(
        `[CourtroomPage] Judge interrupt from agent "${source.agent_name || source.agent_id}"`,
        {
          strategy: source.strategy,
          agentId: source.agent_id,
          agentColor: source.agent_color,
          question: interrupt.question,
        }
      )
    } else {
      console.log('[CourtroomPage] Judge interrupt from default judge engine:', interrupt.question)
    }
    
    // Clear any pending timeout
    if (questionTimeoutRef.current) {
      clearTimeout(questionTimeoutRef.current)
    }

    silenceStartAtRef.current = null
    silenceQuestionRequestedRef.current = false
    judgeQuestionActiveRef.current = true

    setCurrentJudgeQuestion(interrupt.question)
    setCurrentInterruptSource(interrupt.source ?? null)
    setSpeakingRole('judge')
    
    if (interrupt.audio && interrupt.audioFormat) {
      playAudioChunk(interrupt.audio, interrupt.audioFormat)
      const wordCount = interrupt.question.split(' ').length
      const speakingTimeMs = Math.max(wordCount * MS_PER_WORD, MIN_SPEAKING_TIME_MS)
      questionTimeoutRef.current = window.setTimeout(() => {
        endJudgeSpeech()
      }, speakingTimeMs)
    } else {
      playRitualCue(interrupt.question)
      questionTimeoutRef.current = window.setTimeout(() => {
        endJudgeSpeech()
      }, FALLBACK_QUESTION_TIMEOUT_MS)
    }
  }

  const buildSessionAudit = useCallback((): SessionAuditPayload => {
    const fallbackTimestamp = Date.now()
    const startedAt = sessionStartedAtRef.current ?? fallbackTimestamp
    const endedAt = sessionEndedAtRef.current ?? fallbackTimestamp
    const durationSeconds = Math.max(1, Math.round((endedAt - startedAt) / 1000))

    return {
      sessionId,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      durationSeconds,
      proceedingType: 'demo',
      userRole: 'attorney',
      useMultiAgentJudge: Boolean(sessionConfig?.useMultiAgentJudge),
      questions: questionHistory,
      missedQuestions,
      transcriptSegments: transcriptHistory,
    }
  }, [sessionId, sessionConfig?.useMultiAgentJudge, questionHistory, missedQuestions, transcriptHistory])

  const finalizeSession = useCallback(() => {
    if (hasFinalizedSessionRef.current) return
    hasFinalizedSessionRef.current = true
    sessionEndedAtRef.current = Date.now()

    shutdownMedia()
    disconnectSocket()

    const auditPayload = buildSessionAudit()
    sessionStorage.setItem(SESSION_AUDIT_STORAGE_KEY, JSON.stringify(auditPayload))
    sessionStorage.removeItem('courtSession')

    navigate('/session-audit', {
      state: { audit: auditPayload },
      replace: true,
    })
  }, [shutdownMedia, disconnectSocket, buildSessionAudit, navigate])

  // ========== TIMER ==========
  useEffect(() => {
    if (simulationPhase !== 'PROCEEDING' || isPaused) return
    
    const interval = setInterval(() => {
      setTimerSeconds(prev => {
        if (prev <= 1) {
          if (!questionCutoffReachedRef.current) {
            questionCutoffReachedRef.current = true
            sendQuestionCutoff()
          }
          if (timerOvertimePendingRef.current) {
            return prev
          }
          if (judgeQuestionActiveRef.current) {
            timerOvertimePendingRef.current = true
            return 0
          }
          setSimulationPhase('ADJOURNED')
          return 0
        }
        return prev - 1
      })
    }, TIMER_INTERVAL_MS)
    
    return () => clearInterval(interval)
  }, [simulationPhase, isPaused, sendQuestionCutoff])

  useEffect(() => {
    if (simulationPhase === 'PROCEEDING' && !sessionStartedAtRef.current) {
      sessionStartedAtRef.current = Date.now()
    }
    if (simulationPhase === 'ADJOURNED') {
      finalizeSession()
    }
  }, [simulationPhase, finalizeSession])

  // ========== AUTO-START RECORDING ==========
  useEffect(() => {
    if (simulationPhase === 'PROCEEDING' && !isRecording) {
      let isCancelled = false
      let timer: ReturnType<typeof setTimeout> | null = null

      const configureAndStart = async () => {
        if (!isConnected || !sessionConfig) return

        if (useOrchestrated) {
          const agents = await loadAgentsForOrchestrated()
          const briefSummary =
            sessionConfig.judicialSummary ??
            sessionConfig.materials?.map((m) => m.text.slice(0, 500)).join('\n') ??
            ''
          const userRole = sessionConfig.userPartyRole ?? 'appellant'
          const opposingBrief =
            sessionConfig.materials?.find((m) =>
              userRole === 'appellant' ? m.role === 'respondent' : m.role === 'appellant'
            )?.text ?? ''
          configureOrchestrated(
            agents,
            briefSummary,
            opposingBrief,
            sessionConfig.predictedTopicSets ?? {},
            sessionConfig.agendaItems ?? []
          )
          sendPhaseChange('PROCEEDING')
        } else {
          let customSynthesisPrompt: string | undefined
          try {
            const stored = localStorage.getItem('customJudgePrompts')
            if (stored) customSynthesisPrompt = JSON.parse(stored).synthesisPrompt
          } catch {
            /* ignore */
          }
          sendConfig({
            proceedingType: sessionConfig.proceedingType,
            userRole: sessionConfig.userRole,
            seed_questions: [],
            brief_summary:
              sessionConfig.judicialSummary ??
              sessionConfig.materials?.map((m) => m.text.slice(0, 500)).join('\n') ??
              '',
            synthesis_prompt: customSynthesisPrompt,
          })
        }

        if (isCancelled) return
        timer = setTimeout(() => {
          startRecording()
        }, RECORDING_SYNC_DELAY_MS)
      }

      configureAndStart()

      return () => {
        isCancelled = true
        if (timer) clearTimeout(timer)
      }
    } else if (simulationPhase === 'ADJOURNED' && isRecording) {
      stopRecording()
    }
  }, [
    simulationPhase,
    isRecording,
    isConnected,
    sessionConfig,
    useOrchestrated,
    sendConfig,
    configureOrchestrated,
    sendPhaseChange,
    startRecording,
    stopRecording,
    loadAgentsForOrchestrated,
  ])

  // Re-configure on reconnect (orchestrated) — connection may have dropped and recovered
  const prevConnectedRef = useRef(false)
  useEffect(() => {
    const justReconnected = isConnected && !prevConnectedRef.current
    prevConnectedRef.current = isConnected
    if (
      justReconnected &&
      simulationPhase === 'PROCEEDING' &&
      useOrchestrated &&
      sessionConfig
    ) {
      const reconfigure = async () => {
        const agents = await loadAgentsForOrchestrated()
        const briefSummary =
          sessionConfig.judicialSummary ??
          sessionConfig.materials?.map((m) => m.text.slice(0, 500)).join('\n') ??
          ''
        const userRole = sessionConfig.userPartyRole ?? 'appellant'
        const opposingBrief =
          sessionConfig.materials?.find((m) =>
            userRole === 'appellant' ? m.role === 'respondent' : m.role === 'appellant'
          )?.text ?? ''
        configureOrchestrated(
          agents,
          briefSummary,
          opposingBrief,
          sessionConfig.predictedTopicSets ?? {},
          sessionConfig.agendaItems ?? []
        )
        sendPhaseChange('PROCEEDING')
      }
      reconfigure()
    }
  }, [isConnected, simulationPhase, useOrchestrated, sessionConfig, configureOrchestrated, sendPhaseChange, loadAgentsForOrchestrated])

  // ========== SILENCE DETECTION ==========
  useEffect(() => {
    if (simulationPhase !== 'PROCEEDING' || !isRecording || !isConnected) {
      silenceStartAtRef.current = null
      silenceQuestionRequestedRef.current = false
      return
    }

    if (questionCutoffReachedRef.current) {
      silenceStartAtRef.current = null
      silenceQuestionRequestedRef.current = false
      return
    }

    if (speakingRole === 'judge') {
      silenceStartAtRef.current = null
      return
    }

    const now = Date.now()
    if (audioLevel <= SILENCE_AUDIO_LEVEL_THRESHOLD) {
      if (silenceStartAtRef.current === null) {
        silenceStartAtRef.current = now
      }

      if (
        !silenceQuestionRequestedRef.current &&
        now - silenceStartAtRef.current >= SILENCE_TRIGGER_MS
      ) {
        sendSilenceTimeout()
        silenceQuestionRequestedRef.current = true
      }
      return
    }

    silenceStartAtRef.current = null
    silenceQuestionRequestedRef.current = false
  }, [audioLevel, isConnected, isRecording, sendSilenceTimeout, simulationPhase, speakingRole])

  // ========== SESSION INITIALIZATION ==========
  useEffect(() => {
    console.log('[CourtroomPage] Initializing courtroom...')
    const stored = sessionStorage.getItem('courtSession')
    if (!stored) {
      console.log('[CourtroomPage] No session config, redirecting...')
      navigate('/')
      return
    }
    
    try {
      const config = JSON.parse(stored) as SessionConfig
      console.log('[CourtroomPage] Session loaded:', config.proceedingType)
      setSessionConfig(config)
      const configuredDifficulty = isJudgeAvatarDifficulty(config.judgeAvatarDifficulty)
        ? config.judgeAvatarDifficulty
        : readStoredJudgeAvatarDifficulty()
      setJudgeAvatarDifficulty(configuredDifficulty)
      localStorage.setItem(JUDGE_DIFFICULTY_STORAGE_KEY, configuredDifficulty)
      setTimerSeconds(config.sessionDurationSeconds ?? DEMO_SESSION_DURATION_SECONDS)
      questionCutoffReachedRef.current = false
      
      const timeoutId = window.setTimeout(() => {
        console.log('[CourtroomPage] Starting ritual: ALL_RISE')
        setSimulationPhase('ALL_RISE')
        playRitualCue('All rise. The Honorable Court is now in session.')
      }, RITUAL_START_DELAY_MS)
      
      return () => clearTimeout(timeoutId)
    } catch (e) {
      console.error('[CourtroomPage] Failed to parse session:', e)
    }
  }, [navigate])

  // ========== TTS ==========
  const playRitualCue = useCallback(async (text: string): Promise<void> => {
    console.log('[CourtroomPage] Playing TTS:', text)
    
    try {
      const response = await fetch(TTS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: 'onyx' })
      })

      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`TTS request failed (${response.status}): ${detail || response.statusText}`)
      }
      
      const data = await response.json()
      if (data.audio?.length > 0) {
        const audioBytes = Uint8Array.from(atob(data.audio), c => c.charCodeAt(0))
        const mimeType = data.format === 'opus' ? 'audio/ogg; codecs=opus' :
                         data.format === 'mp3' ? 'audio/mpeg' :
                         data.format === 'wav' ? 'audio/wav' : 'audio/ogg'
        const audioBlob = new Blob([audioBytes], { type: mimeType })
        const audioUrl = URL.createObjectURL(audioBlob)
        const audio = new Audio(audioUrl)
        audio.onended = () => URL.revokeObjectURL(audioUrl)
        await audio.play()
        return
      }

      throw new Error('TTS returned no audio bytes')
    } catch (err) {
      console.warn('[CourtroomPage] Backend TTS failed:', err)
    }
    
    // Fallback to browser TTS
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = BROWSER_TTS_RATE
      utterance.pitch = BROWSER_TTS_PITCH
      utterance.onend = () => resolve()
      utterance.onerror = () => resolve()
      
      const voices = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'))
      if (voices.length > 0) utterance.voice = voices[0]
      speechSynthesis.speak(utterance)
    })
  }, [])

  const startProceeding = useCallback(() => {
    setSimulationPhase('PROCEEDING')
    questionCutoffReachedRef.current = false
    if (!useOrchestrated) {
      sendPhaseChange('PROCEEDING')
    }
    setTimeout(() => {
      const openingText = 'Counsel for the appellant, you may proceed when ready.'
      judgeQuestionActiveRef.current = false
      setCurrentJudgeQuestion(openingText)
      setSpeakingRole('judge')
      playRitualCue(openingText)
      setTimeout(() => {
        setCurrentJudgeQuestion(null)
        setSpeakingRole(null)
      }, OPENING_STATEMENT_DURATION_MS)
    }, PROCEEDING_START_DELAY_MS)
  }, [useOrchestrated, sendPhaseChange, playRitualCue])

  // ========== AUTOMATIC RITUAL PHASES ==========
  useEffect(() => {
    if (simulationPhase === 'ALL_RISE') {
      const timeoutId = window.setTimeout(() => {
        setSimulationPhase('JUDGE_ENTERING')
      }, ALL_RISE_AUTO_ADVANCE_MS)
      return () => clearTimeout(timeoutId)
    }

    if (simulationPhase === 'JUDGE_ENTERING') {
      const timeoutId = window.setTimeout(() => {
        setSimulationPhase('JUDGE_SEATED')
        playRitualCue('You may be seated.')
      }, JUDGE_ENTERING_DURATION_MS)
      return () => clearTimeout(timeoutId)
    }

    if (simulationPhase === 'JUDGE_SEATED') {
      const timeoutId = window.setTimeout(() => {
        startProceeding()
      }, 250)
      return () => clearTimeout(timeoutId)
    }
  }, [simulationPhase, playRitualCue, startProceeding])

  // End session handler
  const endSession = useCallback(() => {
    sendPhaseChange('ADJOURNED')
    setSimulationPhase('ADJOURNED')
  }, [sendPhaseChange])

  // Initialize lipsync
  useEffect(() => {
    lipsyncRef.current = new Lipsync()
    return () => {
      if (questionTimeoutRef.current) {
        clearTimeout(questionTimeoutRef.current)
      }
      silenceStartAtRef.current = null
      silenceQuestionRequestedRef.current = false
      judgeQuestionActiveRef.current = false
      timerOvertimePendingRef.current = false
      questionCutoffReachedRef.current = false
    }
  }, [])

  // Toggle bench panels (Questions from Bench + Bench Sentiment) with Cmd/Ctrl + D
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isToggleShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd'
      if (!isToggleShortcut) return
      event.preventDefault()
      setShowBenchPanels(prev => !prev)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const isValidStateForRole = (role: AnimationDebugRole, state: AvatarAnimationStateKey | null) => {
      if (state === null) return true
      const allowedStates = COURTROOM_ANIMATION_STATE_OPTIONS[role] as readonly AvatarAnimationStateKey[]
      return allowedStates.includes(state)
    }

    const setState = (role: AnimationDebugRole, state: AvatarAnimationStateKey | null): boolean => {
      if (!isValidStateForRole(role, state)) {
        console.warn(
          `[courtAnim] "${state}" is not valid for ${role}. Allowed: ${
            COURTROOM_ANIMATION_STATE_OPTIONS[role].join(', ')
          }`
        )
        return false
      }
      setAnimationOverride(role, state)
      return true
    }

    const pulseState = (
      role: AnimationDebugRole,
      state: AvatarAnimationStateKey,
      durationMs: number = DEFAULT_ANIMATION_PULSE_MS
    ): boolean => {
      if (!setState(role, state)) return false
      const timerId = window.setTimeout(() => {
        setAnimationStateOverrides((prev) => (prev[role] === state ? { ...prev, [role]: null } : prev))
      }, Math.max(100, durationMs))
      animationDebugTimersRef.current.push(timerId)
      return true
    }

    const playDemo = (role: AnimationDebugRole = 'judge') => {
      clearAnimationDebugTimers()
      const sequence: Array<{ state: AvatarAnimationStateKey; atMs: number }> = [
        { state: 'seatedIdle', atMs: 0 },
        { state: 'seatedTalk', atMs: 900 },
        { state: 'clap', atMs: 2300 },
        { state: 'seatedTalk', atMs: 4200 },
        { state: 'seatedIdle', atMs: 5600 },
      ]
      sequence.forEach(({ state, atMs }) => {
        const timerId = window.setTimeout(() => {
          setState(role, state)
        }, atMs)
        animationDebugTimersRef.current.push(timerId)
      })
      const clearTimerId = window.setTimeout(() => {
        clearAnimationOverride(role)
      }, 7200)
      animationDebugTimersRef.current.push(clearTimerId)
    }

    const helpText = [
      'window.courtAnim API:',
      "  courtAnim.set('judge'|'counsel', stateOrNull)",
      "  courtAnim.pulse('judge'|'counsel', state, durationMs?)",
      "  courtAnim.demo('judge'|'counsel')",
      "  courtAnim.clear('judge'|'counsel'?)",
      '  courtAnim.get()',
      'Available states are in courtAnim.states',
    ].join('\n')

    const api: AnimationConsoleApi = {
      states: COURTROOM_ANIMATION_STATE_OPTIONS,
      get: () => ({ ...animationOverrideRef.current }),
      set: setState,
      clear: clearAnimationOverride,
      pulse: pulseState,
      demo: playDemo,
      help: () => helpText,
    }

    window.courtAnim = api

    return () => {
      clearAnimationDebugTimers()
      if (window.courtAnim === api) {
        delete window.courtAnim
      }
    }
  }, [clearAnimationDebugTimers, clearAnimationOverride, setAnimationOverride])

  // ========== RENDER ==========
  return (
    <div className="avatar-page courtroom-fullscreen">
      <div className={`courtroom-canvas-fullscreen ${showBenchPanels ? 'bench-panels-visible' : ''}`}>
        <CourtroomScene 
          speakingRole={speakingRole}
          animationSpeakingRole={animationSpeakingRole}
          lipsyncManager={lipsyncRef.current}
          orbitControlsRef={orbitControlsRef}
          judgeDifficulty={judgeAvatarDifficulty}
          animationStateOverrides={animationStateOverrides}
          onAnimationStateFinished={handleAnimationStateFinished}
        />
        
        <StatusDashboardHUD
          phase={simulationPhase}
          isConnected={isConnected}
          isCameraOn={isCameraOn}
          isMicOn={isMicOn}
          isRecording={isRecording}
          audioLevel={audioLevel}
          timerSeconds={timerSeconds}
          recentTranscript={recentTranscript}
          speakingRole={speakingRole}
          videoPreviewRef={videoPreviewRef}
          onEndSession={endSession}
          isPaused={isPaused}
          onTogglePause={() => setIsPaused(prev => !prev)}
        />

        <JudgeSpeechOverlay question={currentJudgeQuestion} source={currentInterruptSource} />

        <InterruptLogPanel
          questions={questionHistory}
          missedQuestions={missedQuestions}
          isVisible={simulationPhase === 'PROCEEDING' && showBenchPanels}
        />

        <AgentSentimentPanel
          scores={agentScores}
          isVisible={simulationPhase === 'PROCEEDING' && showBenchPanels}
        />
      </div>
    </div>
  )
}
