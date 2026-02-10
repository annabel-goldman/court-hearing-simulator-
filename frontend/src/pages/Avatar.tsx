/**
 * Avatar Page
 * 
 * Main courtroom simulation page that orchestrates:
 * - 3D scene rendering (via CourtroomScene)
 * - WebSocket communication for real-time judge interrupts
 * - Audio recording and transcription
 * - Ritual phase progression
 * - UI overlays (HUD, judge questions, ritual prompts)
 */

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { Lipsync } from 'wawa-lipsync'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useSimulationSocket, useAudioPlayer, type JudgeInterrupt } from '../hooks/useSimulationSocket'
import { CourtroomScene } from '../components/courtroom/CourtroomScene'
import { RitualOverlay } from '../components/overlays/RitualOverlay'
import { JudgeQuestionOverlay } from '../components/overlays/JudgeQuestionOverlay'
import { CourtroomHUD } from '../components/overlays/CourtroomHUD'
import type { SpeakingRole, SimulationPhase, SessionConfig } from '../components/courtroom/types'

// TTS endpoint (set VITE_API_URL in production, e.g. https://your-backend.onrender.com)
const TTS_ENDPOINT = (import.meta.env.VITE_API_URL || 'http://localhost:8000') + '/api/tts'

export default function Avatar() {
  // ========== STATE ==========
  const [speakingRole, setSpeakingRole] = useState<SpeakingRole>(null)
  const [simulationPhase, setSimulationPhase] = useState<SimulationPhase>('OFF_RECORD')
  const [sessionConfig, setSessionConfig] = useState<SessionConfig | null>(null)
  const [isCameraOn, setIsCameraOn] = useState(false)
  const [isMicOn, setIsMicOn] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [currentJudgeQuestion, setCurrentJudgeQuestion] = useState<string | null>(null)
  const [audioLevel, setAudioLevel] = useState(0)
  const [recentTranscript, setRecentTranscript] = useState<string>('')
  const [timerSeconds, setTimerSeconds] = useState(60)

  // ========== REFS ==========
  const videoPreviewRef = useRef<HTMLVideoElement>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioAnalyzerRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const audioAccumulatorRef = useRef<Blob[]>([])
  const recordingIntervalRef = useRef<number | null>(null)
  const lipsyncRef = useRef<Lipsync | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
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
      console.log('[Avatar] Backend phase update:', phase)
      // Only accept PROCEEDING/ADJOURNED from backend (ritual phases controlled by frontend)
      if (phase === 'PROCEEDING' || phase === 'ADJOURNED') {
        setSimulationPhase(phase)
      }
    },
    onTranscriptReceived: (transcript: string) => {
      console.log('[Avatar] Transcript:', transcript)
      setRecentTranscript(transcript)
      // Clear transcript timeout
      setTimeout(() => setRecentTranscript(''), 5000)
    },
    onError: (error) => {
      console.error('[Avatar] WebSocket error:', error)
    }
  })

  // ========== JUDGE INTERRUPT HANDLER ==========
  function handleJudgeInterrupt(interrupt: JudgeInterrupt) {
    console.log('[Avatar] Judge interrupt:', interrupt.question)
    
    // Clear any pending timeout
    if (questionTimeoutRef.current) {
      clearTimeout(questionTimeoutRef.current)
    }
    
    setCurrentJudgeQuestion(interrupt.question)
    setSpeakingRole('judge')
    
    if (interrupt.audio && interrupt.audioFormat) {
      playAudioChunk(interrupt.audio, interrupt.audioFormat)
      const wordCount = interrupt.question.split(' ').length
      const speakingTimeMs = Math.max(wordCount * 400, 3000)
      questionTimeoutRef.current = window.setTimeout(() => {
        setCurrentJudgeQuestion(null)
        setSpeakingRole(null)
      }, speakingTimeMs)
    } else {
      playRitualCue(interrupt.question)
      questionTimeoutRef.current = window.setTimeout(() => {
        setCurrentJudgeQuestion(null)
        setSpeakingRole(null)
      }, 5000)
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
    }, 1000)
    
    return () => clearInterval(interval)
  }, [simulationPhase])

  // ========== MEDIA INITIALIZATION ==========
  useEffect(() => {
    const initMedia = async () => {
      try {
        console.log('[Avatar] Requesting camera/mic access...')
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        console.log('[Avatar] Media stream obtained')
        mediaStreamRef.current = stream
        
        if (videoPreviewRef.current) {
          videoPreviewRef.current.srcObject = stream
        }
        
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
        console.error('[Avatar] Failed to access camera/mic:', err)
      }
    }
    
    initMedia()
    
    return () => {
      mediaStreamRef.current?.getTracks().forEach(track => track.stop())
      if (mediaRecorderRef.current?.state !== 'inactive') {
        mediaRecorderRef.current?.stop()
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      audioContextRef.current?.close()
    }
  }, [])

  // ========== RECORDING ==========
  const startRecording = useCallback(() => {
    console.log('[Avatar] Starting recording...')
    if (!mediaStreamRef.current) return
    
    const startNewRecorder = () => {
      const audioStream = new MediaStream(mediaStreamRef.current!.getAudioTracks())
      const recorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' })
      
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioAccumulatorRef.current.push(event.data)
        }
      }
      
      recorder.onstop = () => {
        if (audioAccumulatorRef.current.length > 0) {
          const completeBlob = new Blob(audioAccumulatorRef.current, { type: 'audio/webm' })
          console.log('[Avatar] Sending audio:', completeBlob.size, 'bytes')
          if (isConnected) {
            sendAudio(completeBlob)
          }
          audioAccumulatorRef.current = []
        }
      }
      
      recorder.start()
      mediaRecorderRef.current = recorder
      
      setTimeout(() => {
        if (recorder.state === 'recording') {
          recorder.stop()
        }
      }, 4000)
    }
    
    startNewRecorder()
    recordingIntervalRef.current = window.setInterval(() => {
      if (mediaStreamRef.current) {
        startNewRecorder()
      }
    }, 4500)
    
    setIsRecording(true)
  }, [isConnected, sendAudio])

  const stopRecording = useCallback(() => {
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

  // ========== AUTO-START RECORDING ==========
  useEffect(() => {
    if (simulationPhase === 'PROCEEDING' && !isRecording) {
      if (isConnected && sessionConfig) {
        sendConfig({
          proceedingType: sessionConfig.proceedingType,
          userRole: sessionConfig.userRole,
          seed_questions: [],
          brief_summary: sessionConfig.materials?.map(m => m.text.slice(0, 500)).join('\n') || ''
        })
      }
      
      const timer = setTimeout(() => {
        console.log('[Avatar] Starting recording after sync delay')
        startRecording()
      }, 500)
      
      return () => clearTimeout(timer)
    } else if (simulationPhase === 'ADJOURNED' && isRecording) {
      stopRecording()
    }
  }, [simulationPhase, isRecording, isConnected, sessionConfig, sendConfig, startRecording, stopRecording])

  // ========== SESSION INITIALIZATION ==========
  useEffect(() => {
    console.log('[Avatar] Initializing courtroom...')
    const stored = sessionStorage.getItem('courtSession')
    if (!stored) {
      console.log('[Avatar] No session config, redirecting...')
      window.location.href = '/'
      return
    }
    
    try {
      const config = JSON.parse(stored) as SessionConfig
      console.log('[Avatar] Session loaded:', config.proceedingType)
      setSessionConfig(config)
      setTimerSeconds(60) // Demo mode: 1 minute
      
      const timeoutId = window.setTimeout(() => {
        console.log('[Avatar] Starting ritual: ALL_RISE')
        setSimulationPhase('ALL_RISE')
        playRitualCue('All rise. The Honorable Court is now in session.')
      }, 1500)
      
      return () => clearTimeout(timeoutId)
    } catch (e) {
      console.error('[Avatar] Failed to parse session:', e)
    }
  }, [])

  // ========== TTS ==========
  async function playRitualCue(text: string): Promise<void> {
    console.log('[Avatar] Playing TTS:', text)
    
    try {
      const response = await fetch(TTS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: 'onyx', provider: 'openai' })
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
      console.warn('[Avatar] Backend TTS failed:', err)
    }
    
    // Fallback to browser TTS
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = 0.85
      utterance.pitch = 0.9
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
        }, 3000)
        break
        
      case 'JUDGE_SEATED':
        setSimulationPhase('PROCEEDING')
        console.log('[Avatar] Transitioning to PROCEEDING')
        sendPhaseChange('PROCEEDING')
        setTimeout(() => {
          const openingText = 'Counsel for the appellant, you may proceed when ready.'
          setCurrentJudgeQuestion(openingText)
          setSpeakingRole('judge')
          playRitualCue(openingText)
          setTimeout(() => {
            setCurrentJudgeQuestion(null)
            setSpeakingRole(null)
          }, 4000)
        }, 1000)
        break
        
      case 'ADJOURNED':
        sessionStorage.removeItem('courtSession')
        window.location.href = '/'
        break
    }
  }, [simulationPhase, sendPhaseChange])

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
      audioContextRef.current?.close()
      if (questionTimeoutRef.current) {
        clearTimeout(questionTimeoutRef.current)
      }
    }
  }, [])

  // ========== RENDER ==========
  return (
    <div className="avatar-page courtroom-fullscreen">
      <RitualOverlay phase={simulationPhase} onAction={handleRitualAction} />

      <div className="courtroom-canvas-fullscreen">
        <CourtroomScene 
          speakingRole={speakingRole}
          lipsyncManager={lipsyncRef.current}
          orbitControlsRef={orbitControlsRef}
        />
        
        <CourtroomHUD
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

        <JudgeQuestionOverlay question={currentJudgeQuestion} />
      </div>
    </div>
  )
}
