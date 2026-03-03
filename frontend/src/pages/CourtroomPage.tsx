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
import { CourtroomScene } from '../3d-rendering/CourtroomScene'
import type { SpeakingRole, SimulationPhase, SessionConfig } from '../3d-rendering/types'

// UI Overlays
import { JudgeSpeechOverlay } from '../ui-overlays/JudgeSpeechOverlay'
import { StatusDashboardHUD } from '../ui-overlays/StatusDashboardHUD'
import { InterruptLogPanel } from '../ui-overlays/InterruptLogPanel'
import { AgentSentimentPanel } from '../ui-overlays/AgentSentimentPanel'

// Hooks
import {
  useSimulationSocket,
  useAudioPlayer,
  type JudgeInterrupt,
  type JudgeInterruptSource,
  type AgentScoreEntry,
  type MissedQuestionEntry,
  type MultiAgentSocketConfig,
} from '../hooks/useSimulationSocket'
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

  // Session ID
  const sessionId = useMemo(() => `session_${Date.now()}`, [])

  // Audio player for judge TTS
  const { playAudioChunk } = useAudioPlayer()

  const loadMultiAgentConfig = useCallback(async (): Promise<MultiAgentSocketConfig | undefined> => {
    if (!sessionConfig?.useMultiAgentJudge) return undefined

    try {
      const response = await fetch(`${API_URL}/api/multi-agent/agents`)
      if (!response.ok) {
        throw new Error(`Failed to load agents (${response.status})`)
      }
      const payload = await response.json() as { agents?: Agent[] }
      const agents = payload.agents || []
      if (agents.length === 0) {
        console.warn('[CourtroomPage] No agents returned; enabling backend multi-agent defaults')
        return {
          enabled: true,
          strategy: 'round_robin',
          max_agents_per_pass: 5,
        }
      }
      console.log(`[CourtroomPage] Loaded ${agents.length} agents for judge orchestration`)
      return {
        enabled: true,
        strategy: 'round_robin',
        max_agents_per_pass: 5,
        agents,
      }
    } catch (error) {
      console.warn('[CourtroomPage] Failed to prefetch agents; enabling backend multi-agent defaults:', error)
      return {
        enabled: true,
        strategy: 'round_robin',
        max_agents_per_pass: 5,
      }
    }
  }, [sessionConfig?.useMultiAgentJudge])

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

  const {
    isConnected,
    sendConfig,
    sendAudio,
    sendSilenceTimeout,
    sendQuestionCutoff,
    changePhase: sendPhaseChange,
    disconnect: disconnectSocket
  } = useSimulationSocket({
    sessionId,
    onJudgeInterrupt: handleJudgeInterrupt,
    onAgentScores: handleAgentScores,
    onMissedQuestion: handleMissedQuestion,
    onPhaseChange: (phase) => {
      console.log('[CourtroomPage] Backend phase update:', phase)
      // Only accept PROCEEDING/ADJOURNED from backend (ritual phases controlled by frontend)
      if (phase === 'PROCEEDING' || phase === 'ADJOURNED') {
        setSimulationPhase(phase)
      }
    },
    onTranscriptReceived: (transcript: string) => {
      console.log('[CourtroomPage] Transcript:', transcript)
      setRecentTranscript(transcript)
      const cleanTranscript = transcript.trim()
      if (cleanTranscript.length > 0) {
        setTranscriptHistory(prev => {
          if (prev.length > 0 && prev[prev.length - 1].text === cleanTranscript) {
            return prev
          }
          return [
            ...prev,
            {
              text: cleanTranscript,
              timestamp: new Date().toISOString(),
            },
          ]
        })
      }
      // Clear transcript timeout
      setTimeout(() => setRecentTranscript(''), TRANSCRIPT_DISPLAY_DURATION_MS)
    },
    onError: (error) => {
      console.error('[CourtroomPage] WebSocket error:', error)
    }
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
      }
    },
    onError: (error) => {
      console.error('[CourtroomPage] Media error:', error)
    }
  })

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
    if (simulationPhase !== 'PROCEEDING') return
    
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
  }, [simulationPhase, sendQuestionCutoff])

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
        if (isConnected && sessionConfig) {
          // Check for custom prompts from Judge Admin
          let customSynthesisPrompt: string | undefined
          try {
            const storedPrompts = localStorage.getItem('customJudgePrompts')
            if (storedPrompts) {
              const prompts = JSON.parse(storedPrompts)
              customSynthesisPrompt = prompts.synthesisPrompt
            }
          } catch (e) {
            console.warn('Failed to load custom prompts:', e)
          }

          if (customSynthesisPrompt) {
            const preview = customSynthesisPrompt.slice(0, 200).replace(/\n/g, ' ')
            console.log('[CourtroomPage] Judge using CUSTOM synthesis prompt (from Set Prompts):', preview + (customSynthesisPrompt.length > 200 ? '...' : ''))
          } else {
            console.log('[CourtroomPage] Judge using backend DEFAULT synthesis prompt (no custom prompt in localStorage)')
          }

          const multiAgentConfig = await loadMultiAgentConfig()
          console.log('[CourtroomPage][DBG] Sending socket config with multi_agent:', multiAgentConfig)
          sendConfig({
            proceedingType: sessionConfig.proceedingType,
            userRole: sessionConfig.userRole,
            seed_questions: [],
            brief_summary: sessionConfig.judicialSummary || sessionConfig.materials?.map(m => m.text.slice(0, 500)).join('\n') || '',
            synthesis_prompt: customSynthesisPrompt,
            multi_agent: multiAgentConfig,
          })
        }

        if (isCancelled) return
        timer = setTimeout(() => {
          console.log('[CourtroomPage] Starting recording after sync delay')
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
  }, [simulationPhase, isRecording, isConnected, sessionConfig, sendConfig, startRecording, stopRecording, loadMultiAgentConfig])

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
                         data.format === 'mp3' ? 'audio/mpeg' : 'audio/ogg'
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
    console.log('[CourtroomPage] Transitioning to PROCEEDING')
    sendPhaseChange('PROCEEDING')
    questionCutoffReachedRef.current = false
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
  }, [sendPhaseChange, playRitualCue])

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

  // ========== RENDER ==========
  return (
    <div className="avatar-page courtroom-fullscreen">
      <div className="courtroom-canvas-fullscreen">
        <CourtroomScene 
          speakingRole={speakingRole}
          lipsyncManager={lipsyncRef.current}
          orbitControlsRef={orbitControlsRef}
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
        />

        <JudgeSpeechOverlay question={currentJudgeQuestion} source={currentInterruptSource} />

        <InterruptLogPanel
          questions={questionHistory}
          missedQuestions={missedQuestions}
          isVisible={simulationPhase === 'PROCEEDING'}
        />

        <AgentSentimentPanel
          scores={agentScores}
          isVisible={simulationPhase === 'PROCEEDING'}
        />
      </div>
    </div>
  )
}
