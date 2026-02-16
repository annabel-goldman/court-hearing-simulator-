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
import { CourtroomRitualOverlay } from '../ui-overlays/CourtroomRitualOverlay'
import { JudgeSpeechOverlay } from '../ui-overlays/JudgeSpeechOverlay'
import { StatusDashboardHUD } from '../ui-overlays/StatusDashboardHUD'

// Hooks
import { useSimulationSocket, useAudioPlayer, type JudgeInterrupt } from '../hooks/useSimulationSocket'
import { useMediaRecording } from '../hooks/useMediaRecording'

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
} from '../config/simulationConfig'

// TTS endpoint (set VITE_API_URL in production, e.g. https://your-backend.onrender.com)
const TTS_ENDPOINT = (import.meta.env.VITE_API_URL || 'http://localhost:8000') + '/api/tts'

export default function CourtroomPage() {
  const navigate = useNavigate()

  // ========== STATE ==========
  const [speakingRole, setSpeakingRole] = useState<SpeakingRole>(null)
  const [simulationPhase, setSimulationPhase] = useState<SimulationPhase>('OFF_RECORD')
  const [sessionConfig, setSessionConfig] = useState<SessionConfig | null>(null)
  const [currentJudgeQuestion, setCurrentJudgeQuestion] = useState<string | null>(null)
  const [recentTranscript, setRecentTranscript] = useState<string>('')
  const [timerSeconds, setTimerSeconds] = useState(DEMO_SESSION_DURATION_SECONDS)

  // ========== REFS ==========
  const lipsyncRef = useRef<Lipsync | null>(null)
  const orbitControlsRef = useRef<OrbitControlsImpl>(null)
  const questionTimeoutRef = useRef<number | null>(null)

  // Session ID
  const sessionId = useMemo(() => `session_${Date.now()}`, [])

  // Audio player for judge TTS
  const { playAudioChunk } = useAudioPlayer()

  // ========== WEBSOCKET ==========
  const { 
    isConnected, 
    sendConfig, 
    sendAudio,
    changePhase: sendPhaseChange,
    disconnect: disconnectSocket
  } = useSimulationSocket({
    sessionId,
    onJudgeInterrupt: handleJudgeInterrupt,
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

  // ========== JUDGE INTERRUPT HANDLER ==========
  function handleJudgeInterrupt(interrupt: JudgeInterrupt) {
    console.log('[CourtroomPage] Judge interrupt:', interrupt.question)
    
    // Clear any pending timeout
    if (questionTimeoutRef.current) {
      clearTimeout(questionTimeoutRef.current)
    }
    
    setCurrentJudgeQuestion(interrupt.question)
    setSpeakingRole('judge')
    
    if (interrupt.audio && interrupt.audioFormat) {
      playAudioChunk(interrupt.audio, interrupt.audioFormat)
      const wordCount = interrupt.question.split(' ').length
      const speakingTimeMs = Math.max(wordCount * MS_PER_WORD, MIN_SPEAKING_TIME_MS)
      questionTimeoutRef.current = window.setTimeout(() => {
        setCurrentJudgeQuestion(null)
        setSpeakingRole(null)
      }, speakingTimeMs)
    } else {
      playRitualCue(interrupt.question)
      questionTimeoutRef.current = window.setTimeout(() => {
        setCurrentJudgeQuestion(null)
        setSpeakingRole(null)
      }, FALLBACK_QUESTION_TIMEOUT_MS)
    }
  }

  // ========== TIMER ==========
  useEffect(() => {
    if (simulationPhase !== 'PROCEEDING') return
    
    const interval = setInterval(() => {
      setTimerSeconds(prev => {
        if (prev <= 0) {
          setSimulationPhase('ADJOURNED')
          return 0
        }
        return prev - 1
      })
    }, TIMER_INTERVAL_MS)
    
    return () => clearInterval(interval)
  }, [simulationPhase])

  // ========== AUTO-START RECORDING ==========
  useEffect(() => {
    if (simulationPhase === 'PROCEEDING' && !isRecording) {
      if (isConnected && sessionConfig) {
        // Check for custom prompts from Judge Admin
        let customSynthesisPrompt: string | undefined
        try {
          const storedPrompts = sessionStorage.getItem('customJudgePrompts')
          if (storedPrompts) {
            const prompts = JSON.parse(storedPrompts)
            customSynthesisPrompt = prompts.synthesisPrompt
          }
        } catch (e) {
          console.warn('Failed to load custom prompts:', e)
        }

        sendConfig({
          proceedingType: sessionConfig.proceedingType,
          userRole: sessionConfig.userRole,
          seed_questions: [],
          brief_summary: sessionConfig.judicialSummary || sessionConfig.materials?.map(m => m.text.slice(0, 500)).join('\n') || '',
          synthesis_prompt: customSynthesisPrompt
        })
      }
      
      const timer = setTimeout(() => {
        console.log('[CourtroomPage] Starting recording after sync delay')
        startRecording()
      }, RECORDING_SYNC_DELAY_MS)
      
      return () => clearTimeout(timer)
    } else if (simulationPhase === 'ADJOURNED' && isRecording) {
      stopRecording()
    }
  }, [simulationPhase, isRecording, isConnected, sessionConfig, sendConfig, startRecording, stopRecording])

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
      setTimerSeconds(DEMO_SESSION_DURATION_SECONDS)
      
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
  async function playRitualCue(text: string): Promise<void> {
    console.log('[CourtroomPage] Playing TTS:', text)
    
    try {
      const response = await fetch(TTS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: 'onyx' })
      })
      
      if (response.ok) {
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
      }
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
  }

  // ========== RITUAL PROGRESSION ==========
  const handleRitualAction = useCallback(() => {
    switch (simulationPhase) {
      case 'ALL_RISE':
        setSimulationPhase('JUDGE_ENTERING')
        setTimeout(() => {
          setSimulationPhase('JUDGE_SEATED')
          playRitualCue('You may be seated.')
        }, JUDGE_ENTERING_DURATION_MS)
        break
        
      case 'JUDGE_SEATED':
        setSimulationPhase('PROCEEDING')
        console.log('[CourtroomPage] Transitioning to PROCEEDING')
        sendPhaseChange('PROCEEDING')
        setTimeout(() => {
          const openingText = 'Counsel for the appellant, you may proceed when ready.'
          setCurrentJudgeQuestion(openingText)
          setSpeakingRole('judge')
          playRitualCue(openingText)
          setTimeout(() => {
            setCurrentJudgeQuestion(null)
            setSpeakingRole(null)
          }, OPENING_STATEMENT_DURATION_MS)
        }, PROCEEDING_START_DELAY_MS)
        break
        
      case 'ADJOURNED':
        sessionStorage.removeItem('courtSession')
        navigate('/')
        break
    }
  }, [simulationPhase, sendPhaseChange, navigate])

  // End session handler
  const endSession = useCallback(() => {
    stopRecording()
    disconnectSocket()
    setSimulationPhase('ADJOURNED')
    playRitualCue('This court is adjourned. All rise.')
  }, [disconnectSocket, stopRecording])

  // Initialize lipsync
  useEffect(() => {
    lipsyncRef.current = new Lipsync()
    return () => {
      if (questionTimeoutRef.current) {
        clearTimeout(questionTimeoutRef.current)
      }
    }
  }, [])

  // ========== RENDER ==========
  return (
    <div className="avatar-page courtroom-fullscreen">
      <CourtroomRitualOverlay phase={simulationPhase} onAction={handleRitualAction} />

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

        <JudgeSpeechOverlay question={currentJudgeQuestion} />
      </div>
    </div>
  )
}
