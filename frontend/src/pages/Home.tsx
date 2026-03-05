import { useState, useRef, DragEvent, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { JudgeAvatarDifficulty } from '../3d-rendering/types'
import { getAssetUrl } from '../config/assetUrls'

GlobalWorkerOptions.workerSrc = workerSrc

interface UploadedFile {
  name: string
  text: string
}

type HomeStage = 'landing' | 'desk'
type LandingPhase = 'intro' | 'welcome'
type IntakePhase = 'idle' | 'launching' | 'analyzing'
type UserPartyRole = 'appellant' | 'respondent'
type JudgeInterruptionLevel = 'easy' | 'difficult' | 'hard'
type JudgeQuestionTypeId =
  | 'clarification'
  | 'hypothetical'
  | 'precedent'
  | 'statutory'
  | 'devils_advocate'

const ANALYSIS_MESSAGE = 'The judge is analyzing your briefs.'
const BENCH_LOGO_SRC = getAssetUrl('bench-logo.svg')
const LANDING_INTRO_BACKGROUND_SRC = getAssetUrl('Background.jpg')
const LANDING_SWOOSH_MS = 840
const SETTINGS_PULSE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000
const SETTINGS_PULSE_LAST_SEEN_KEY = 'homeSettingsPulseLastSeenAt'
const SETTINGS_PULSE_SESSION_KEY = 'homeSettingsPulseShownThisSession'

const SESSION_LENGTH_OPTIONS = [60, 120, 180, 300, 600, 900] as const
const INTERRUPTION_LEVEL_OPTIONS: JudgeInterruptionLevel[] = ['easy', 'difficult', 'hard']
const INTERRUPTION_LEVEL_LABELS: Record<JudgeInterruptionLevel, string> = {
  easy: 'Low',
  difficult: 'Medium',
  hard: 'High',
}
const JUDGE_DIFFICULTY_OPTIONS: JudgeAvatarDifficulty[] = ['easy', 'medium', 'hard']
const JUDGE_DIFFICULTY_LABELS: Record<JudgeAvatarDifficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
}
const JUDGE_QUESTION_OPTIONS: Array<{
  id: JudgeQuestionTypeId
  label: string
  description: string
}> = [
  {
    id: 'clarification',
    label: 'Clarification',
    description: 'Judge asks focused follow-ups to tighten your argument.',
  },
  {
    id: 'hypothetical',
    label: 'Hypotheticals',
    description: 'Judge tests your rule with edge-case fact patterns.',
  },
  {
    id: 'precedent',
    label: 'Precedent',
    description: 'Judge probes how prior cases control this dispute.',
  },
  {
    id: 'statutory',
    label: 'Statutory Interpretation',
    description: 'Judge asks text, structure, and purpose-based questions.',
  },
  {
    id: 'devils_advocate',
    label: "Devil's Advocate",
    description: 'Judge pushes the strongest version of the other side.',
  },
]

async function extractTextFromPdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await getDocument({ data: arrayBuffer }).promise

  let fullText = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()
    const pageText = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
    fullText += `${pageText}\n\n`
  }

  return fullText.trim()
}

export default function Home() {
  const navigate = useNavigate()

  const [stage, setStage] = useState<HomeStage>('landing')
  const [landingPhase, setLandingPhase] = useState<LandingPhase>('intro')
  const [intakePhase, setIntakePhase] = useState<IntakePhase>('idle')
  const [landingExiting, setLandingExiting] = useState(false)
  const [landingActivated, setLandingActivated] = useState(false)
  const [showLandingButton, setShowLandingButton] = useState(false)

  const [fileA, setFileA] = useState<UploadedFile | null>(null)
  const [fileB, setFileB] = useState<UploadedFile | null>(null)
  const [loadingA, setLoadingA] = useState(false)
  const [loadingB, setLoadingB] = useState(false)
  const [dragOverA, setDragOverA] = useState(false)
  const [dragOverB, setDragOverB] = useState(false)
  const [infoModalOpen, setInfoModalOpen] = useState(false)
  const [settingsModalOpen, setSettingsModalOpen] = useState(false)
  const [settingsPulseActive, setSettingsPulseActive] = useState(false)
  const [error, setError] = useState('')
  const [sessionDuration, setSessionDuration] = useState(180)
  const [userPartyRole, setUserPartyRole] = useState<UserPartyRole>('appellant')
  const [judgeInterruptionLevel, setJudgeInterruptionLevel] = useState<JudgeInterruptionLevel>('difficult')
  const [judgeAvatarDifficulty, setJudgeAvatarDifficulty] = useState<JudgeAvatarDifficulty>('medium')
  const [enabledQuestionTypes, setEnabledQuestionTypes] = useState<JudgeQuestionTypeId[]>([
    'clarification',
    'hypothetical',
    'precedent',
  ])

  const landingIntroBackgroundStyle = {
    backgroundImage: `url(${LANDING_INTRO_BACKGROUND_SRC})`,
  }

  const inputRefA = useRef<HTMLInputElement>(null)
  const inputRefB = useRef<HTMLInputElement>(null)
  const landingExitTimerRef = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioUnlockedRef = useRef(false)
  const backgroundMusicRef = useRef<{
    oscillators: OscillatorNode[]
    gainNode: GainNode
    pulseIntervalId: number
  } | null>(null)

  const getAudioContext = () => {
    if (typeof window === 'undefined') return null
    if (audioContextRef.current?.state === 'closed') {
      audioContextRef.current = null
      audioUnlockedRef.current = false
    }
    if (!audioContextRef.current) {
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioContextCtor) return null
      audioContextRef.current = new AudioContextCtor()
    }
    return audioContextRef.current
  }

  const createTone = (
    ctx: AudioContext,
    startTime: number,
    duration: number,
    fromFrequency: number,
    toFrequency: number,
    type: OscillatorType,
    fromGain: number,
    toGain: number
  ) => {
    if (ctx.state === 'closed') return
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(fromFrequency, startTime)
    oscillator.frequency.exponentialRampToValueAtTime(toFrequency, startTime + duration)
    gain.gain.setValueAtTime(Math.max(fromGain, 0.0001), startTime)
    gain.gain.exponentialRampToValueAtTime(Math.max(toGain, 0.0001), startTime + duration)
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start(startTime)
    oscillator.stop(startTime + duration)
  }

  const createNoiseBurst = (
    ctx: AudioContext,
    startTime: number,
    duration: number,
    gainValue: number,
    centerFrequency = 200,
    qValue = 1
  ) => {
    if (ctx.state === 'closed') return
    const frameCount = Math.floor(ctx.sampleRate * duration)
    const buffer = ctx.createBuffer(1, frameCount, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < frameCount; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frameCount)
    }

    const source = ctx.createBufferSource()
    source.buffer = buffer

    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(centerFrequency, startTime)
    filter.Q.setValueAtTime(qValue, startTime)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, startTime)
    gain.gain.exponentialRampToValueAtTime(gainValue, startTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)

    source.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)
    source.start(startTime)
    source.stop(startTime + duration)
  }

  const unlockAudio = async () => {
    const ctx = getAudioContext()
    if (!ctx) return null
    try {
      if (ctx.state === 'suspended') {
        await ctx.resume()
      }
      audioUnlockedRef.current = true
      return ctx
    } catch {
      return null
    }
  }

  const playStampSlamSound = (weight: 'heavy' | 'light') => {
    if (!audioUnlockedRef.current) return
    const ctx = getAudioContext()
    if (!ctx || ctx.state === 'closed') return

    const now = ctx.currentTime + 0.004
    const lowGain = weight === 'heavy' ? 0.45 : 0.28
    const crackGain = weight === 'heavy' ? 0.24 : 0.15

    createTone(ctx, now, 0.2, 208, 60, 'square', lowGain, 0.0001)
    createTone(ctx, now + 0.01, 0.14, 128, 52, 'triangle', lowGain * 0.68, 0.0001)
    createNoiseBurst(ctx, now, 0.11, crackGain, 220, 1.2)
    createNoiseBurst(ctx, now + 0.003, 0.08, crackGain * 0.9, 1500, 2.1)
  }

  const playUploadSound = () => {
    if (!audioUnlockedRef.current) return
    const ctx = getAudioContext()
    if (!ctx || ctx.state === 'closed') return

    const now = ctx.currentTime + 0.01
    createTone(ctx, now, 0.09, 390, 520, 'triangle', 0.08, 0.0001)
    createTone(ctx, now + 0.08, 0.1, 520, 680, 'triangle', 0.06, 0.0001)
  }

  const playBriefSendWhoosh = () => {
    if (!audioUnlockedRef.current) return
    const ctx = getAudioContext()
    if (!ctx || ctx.state === 'closed') return

    const duration = 0.78
    const now = ctx.currentTime + 0.01
    const frameCount = Math.floor(ctx.sampleRate * duration)
    const buffer = ctx.createBuffer(1, frameCount, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < frameCount; i++) {
      const envelope = 1 - i / frameCount
      data[i] = (Math.random() * 2 - 1) * envelope
    }

    const source = ctx.createBufferSource()
    source.buffer = buffer

    const sweepFilter = ctx.createBiquadFilter()
    sweepFilter.type = 'bandpass'
    sweepFilter.frequency.setValueAtTime(260, now)
    sweepFilter.frequency.exponentialRampToValueAtTime(2400, now + duration)
    sweepFilter.Q.setValueAtTime(0.9, now)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.19, now + 0.07)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)

    source.connect(sweepFilter)
    sweepFilter.connect(gain)
    gain.connect(ctx.destination)
    source.start(now)
    source.stop(now + duration + 0.02)

    createTone(ctx, now + 0.03, 0.42, 350, 130, 'triangle', 0.06, 0.0001)
  }

  const startBackgroundMusic = () => {
    if (!audioUnlockedRef.current) return
    if (backgroundMusicRef.current) return

    const ctx = getAudioContext()
    if (!ctx || ctx.state === 'closed') return

    const now = ctx.currentTime
    const masterGain = ctx.createGain()
    masterGain.gain.setValueAtTime(0.0001, now)
    masterGain.gain.exponentialRampToValueAtTime(0.035, now + 1.3)
    masterGain.connect(ctx.destination)

    const padFilter = ctx.createBiquadFilter()
    padFilter.type = 'lowpass'
    padFilter.frequency.setValueAtTime(680, now)
    padFilter.Q.setValueAtTime(0.5, now)
    padFilter.connect(masterGain)

    const padOne = ctx.createOscillator()
    padOne.type = 'triangle'
    padOne.frequency.setValueAtTime(82.41, now)

    const padTwo = ctx.createOscillator()
    padTwo.type = 'sine'
    padTwo.frequency.setValueAtTime(123.47, now)

    const padThree = ctx.createOscillator()
    padThree.type = 'triangle'
    padThree.frequency.setValueAtTime(164.81, now)

    padOne.connect(padFilter)
    padTwo.connect(padFilter)
    padThree.connect(padFilter)
    padOne.start(now)
    padTwo.start(now)
    padThree.start(now)

    let pulseIndex = 0
    const pulseNotes = [220, 246.94, 261.63, 293.66]
    const pulseIntervalId = window.setInterval(() => {
      if (!audioUnlockedRef.current || !audioContextRef.current || audioContextRef.current.state === 'closed') return
      const t = audioContextRef.current.currentTime + 0.02
      const frequency = pulseNotes[pulseIndex % pulseNotes.length]
      createTone(audioContextRef.current, t, 0.42, frequency, frequency * 0.985, 'sine', 0.03, 0.0001)
      pulseIndex += 1
    }, 1200)

    backgroundMusicRef.current = {
      oscillators: [padOne, padTwo, padThree],
      gainNode: masterGain,
      pulseIntervalId,
    }
  }

  const stopBackgroundMusic = () => {
    const music = backgroundMusicRef.current
    const ctx = audioContextRef.current
    if (!music || !ctx || ctx.state === 'closed') {
      backgroundMusicRef.current = null
      return
    }

    window.clearInterval(music.pulseIntervalId)
    const now = ctx.currentTime
    music.gainNode.gain.cancelScheduledValues(now)
    music.gainNode.gain.setValueAtTime(Math.max(music.gainNode.gain.value, 0.0001), now)
    music.gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.45)

    music.oscillators.forEach((osc) => {
      try {
        osc.stop(now + 0.5)
      } catch {
        // oscillator may already be stopped
      }
    })

    backgroundMusicRef.current = null
  }

  useEffect(() => {
    if (stage !== 'landing' || landingPhase !== 'welcome' || !landingActivated) return

    const buttonRevealDelayMs = 1600
    setShowLandingButton(false)
    const timer = window.setTimeout(() => {
      setShowLandingButton(true)
      playStampSlamSound('light')
    }, buttonRevealDelayMs)
    const stampOneTimer = window.setTimeout(() => {
      playStampSlamSound('heavy')
    }, 520)

    return () => {
      window.clearTimeout(timer)
      window.clearTimeout(stampOneTimer)
    }
  }, [stage, landingPhase, landingActivated])

  useEffect(() => {
    const unlockFromInteraction = () => {
      void unlockAudio()
    }

    window.addEventListener('pointerdown', unlockFromInteraction, { passive: true })
    window.addEventListener('touchstart', unlockFromInteraction, { passive: true })
    window.addEventListener('keydown', unlockFromInteraction)

    return () => {
      window.removeEventListener('pointerdown', unlockFromInteraction)
      window.removeEventListener('touchstart', unlockFromInteraction)
      window.removeEventListener('keydown', unlockFromInteraction)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (landingExitTimerRef.current !== null) {
        window.clearTimeout(landingExitTimerRef.current)
        landingExitTimerRef.current = null
      }
      stopBackgroundMusic()
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        void audioContextRef.current.close()
      }
      audioContextRef.current = null
      audioUnlockedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!settingsModalOpen && !infoModalOpen) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setInfoModalOpen(false)
        setSettingsModalOpen(false)
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [infoModalOpen, settingsModalOpen])

  useEffect(() => {
    if (stage !== 'desk') return

    try {
      const hasShownThisSession = sessionStorage.getItem(SETTINGS_PULSE_SESSION_KEY) === '1'
      if (hasShownThisSession) return

      const now = Date.now()
      const rawLastSeen = localStorage.getItem(SETTINGS_PULSE_LAST_SEEN_KEY)
      const parsedLastSeen = rawLastSeen ? Number(rawLastSeen) : NaN
      const visitedRecently =
        Number.isFinite(parsedLastSeen) && now - parsedLastSeen < SETTINGS_PULSE_COOLDOWN_MS

      if (!visitedRecently) {
        setSettingsPulseActive(true)
      }

      sessionStorage.setItem(SETTINGS_PULSE_SESSION_KEY, '1')
    } catch {
      // Ignore storage failures and leave pulse disabled
    }
  }, [stage])

  const handleFileUpload = async (
    file: File,
    setFile: (f: UploadedFile | null) => void,
    setLoadingState: (l: boolean) => void
  ) => {
    if (!file.type.includes('pdf') && !file.name.endsWith('.pdf')) {
      setError('Please upload a PDF file')
      return
    }

    setLoadingState(true)
    setError('')

    try {
      const text = await extractTextFromPdf(file)
      setFile({ name: file.name, text })
      playUploadSound()
    } catch (err) {
      setError(`Failed to read PDF: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setLoadingState(false)
    }
  }

  const handleDragOver = (e: DragEvent, setDragOver: (v: boolean) => void) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(true)
  }

  const handleDragLeave = (e: DragEvent, setDragOver: (v: boolean) => void) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
  }

  const handleDrop = (
    e: DragEvent,
    setFile: (f: UploadedFile | null) => void,
    setLoadingState: (l: boolean) => void,
    setDragOver: (v: boolean) => void
  ) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)

    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      handleFileUpload(files[0], setFile, setLoadingState)
    }
  }

  const buildSessionConfig = async () => {
    if (!fileA || !fileB) {
      throw new Error('Both briefs are required')
    }

    let customSummarizationPrompt: string | undefined
    try {
      const storedPrompts = localStorage.getItem('customJudgePrompts')
      if (storedPrompts) {
        const prompts = JSON.parse(storedPrompts)
        customSummarizationPrompt = prompts.summarizationPrompt
      }
    } catch (promptError) {
      console.warn('Failed to load custom prompts:', promptError)
    }

      const fallbackConfig = {
        proceedingType: 'demo' as const,
        userRole: 'attorney' as const,
        materials: [
          { name: fileA.name, text: fileA.text, role: 'appellant' },
          { name: fileB.name, text: fileB.text, role: 'respondent' },
        ],
        useMultiAgentJudge: true,
        sessionDurationSeconds: sessionDuration,
        judgeAvatarDifficulty,
        userPartyRole,
        judgeDisposition: {
          interruptionLevel: judgeInterruptionLevel,
          questionTypes: enabledQuestionTypes,
        },
      }

    try {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
      const res = await fetch(`${API_URL}/api/summarize-briefs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appellant_brief: fileA.text,
          appellee_brief: fileB.text,
          system_prompt: customSummarizationPrompt,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        return fallbackConfig
      }

      return {
        ...fallbackConfig,
        judicialSummary: data.summary as string | undefined,
      }
    } catch (summaryError) {
      console.warn('Summary generation failed, proceeding without summary:', summaryError)
      return fallbackConfig
    }
  }

  const enterCourtroom = async () => {
    if (!fileA?.text || !fileB?.text) {
      setError('Please upload both briefs before entering the courtroom')
      return
    }

    setError('')
    setIntakePhase('launching')

    try {
      const sessionPromise = buildSessionConfig()
      playBriefSendWhoosh()

      await new Promise((resolve) => window.setTimeout(resolve, 900))
      setIntakePhase('analyzing')

      const [sessionConfig] = await Promise.all([
        sessionPromise,
        new Promise((resolve) => window.setTimeout(resolve, 2200)),
      ])

      stopBackgroundMusic()
      localStorage.setItem('judgeAvatarDifficulty', judgeAvatarDifficulty)
      sessionStorage.setItem('courtSession', JSON.stringify(sessionConfig))
      navigate('/courtroom')
    } catch (err) {
      setIntakePhase('idle')
      setError(`Unable to enter courtroom: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  const clearAll = () => {
    if (intakePhase !== 'idle') return

    setFileA(null)
    setFileB(null)
    setError('')
    if (inputRefA.current) inputRefA.current.value = ''
    if (inputRefB.current) inputRefB.current.value = ''
  }

  const removeFile = (which: 'a' | 'b') => {
    if (intakePhase !== 'idle') return

    if (which === 'a') {
      setFileA(null)
      if (inputRefA.current) inputRefA.current.value = ''
      return
    }

    setFileB(null)
    if (inputRefB.current) inputRefB.current.value = ''
  }

  const toggleQuestionType = (typeId: JudgeQuestionTypeId) => {
    setEnabledQuestionTypes((current) => {
      if (current.includes(typeId)) {
        return current.filter((id) => id !== typeId)
      }
      return [...current, typeId]
    })
  }

  const markSettingsPulseSeen = () => {
    setSettingsPulseActive(false)
    try {
      localStorage.setItem(SETTINGS_PULSE_LAST_SEEN_KEY, String(Date.now()))
      sessionStorage.setItem(SETTINGS_PULSE_SESSION_KEY, '1')
    } catch {
      // Ignore storage failures
    }
  }

  const openInfoModal = () => {
    setSettingsModalOpen(false)
    setInfoModalOpen(true)
  }

  const openSettingsModal = () => {
    markSettingsPulseSeen()
    setInfoModalOpen(false)
    setSettingsModalOpen(true)
  }

  const infoModal = infoModalOpen ? (
    <div
      className="settings-modal-backdrop"
      role="presentation"
      onClick={() => setInfoModalOpen(false)}
    >
      <div
        className="settings-modal-shell"
        role="dialog"
        aria-modal="true"
        aria-label="Information"
        onClick={(event) => event.stopPropagation()}
      >
        <section className="paper-sheet blank settings-file-sheet">
          <div className="paper-head settings-modal-head">
            <span>Information</span>
            <button
              type="button"
              className="settings-modal-close-btn"
              aria-label="Close information modal"
              onClick={() => setInfoModalOpen(false)}
            >
              X
            </button>
          </div>

          <div className="settings-file-body info-file-body">
            <div className="settings-ledger-row">
              <p className="settings-ledger-copy">
                <span className="settings-ledger-label">Flow</span>
                <span className="settings-ledger-note">How this experience is organized</span>
              </p>
              <div className="info-ledger-detail">
                <p>Step 1 is the courtroom intro, step 2 is the brief prompt, and step 3 is brief upload.</p>
              </div>
            </div>

            <div className="settings-ledger-row">
              <p className="settings-ledger-copy">
                <span className="settings-ledger-label">Click Through</span>
                <span className="settings-ledger-note">How to move forward</span>
              </p>
              <div className="info-ledger-detail">
                <p>Click through the intro flow to reach moot and start your session.</p>
              </div>
            </div>

            <div className="settings-ledger-row">
              <p className="settings-ledger-copy">
                <span className="settings-ledger-label">Settings</span>
                <span className="settings-ledger-note">Customize your argument experience</span>
              </p>
              <div className="info-ledger-detail">
                <p>On the brief upload page, use the settings button to choose different session settings.</p>
              </div>
            </div>

            <div className="settings-ledger-row">
              <p className="settings-ledger-copy">
                <span className="settings-ledger-label">Tip</span>
                <span className="settings-ledger-note">For a smoother session</span>
              </p>
              <div className="info-ledger-detail">
                <p>Use concise, complete briefs to improve summary quality and courtroom question relevance.</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  ) : null

  const enterDeskStage = async () => {
    if (landingExiting) return
    await unlockAudio()
    playBriefSendWhoosh()
    stopBackgroundMusic()
    setLandingExiting(true)

    if (landingExitTimerRef.current !== null) {
      window.clearTimeout(landingExitTimerRef.current)
    }
    landingExitTimerRef.current = window.setTimeout(() => {
      setStage('desk')
      setLandingExiting(false)
      landingExitTimerRef.current = null
    }, LANDING_SWOOSH_MS)
  }

  const enterWelcomeStage = async () => {
    if (landingExiting || landingPhase !== 'intro') return
    await unlockAudio()
    startBackgroundMusic()
    setLandingActivated(true)
    setLandingPhase('welcome')
  }

  if (stage === 'landing') {
    return (
      <div className={`landing-stage ${landingExiting ? 'is-swooshing' : ''}`}>
        <div className="landing-backdrop-grid" />
        <div className="top-left-action-stack">
          <button
            type="button"
            className="info-action-btn"
            onClick={openInfoModal}
            aria-label="Open session information"
            aria-haspopup="dialog"
            aria-expanded={infoModalOpen}
            disabled={landingExiting}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="info-action-icon">
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <text x="12" y="15.1" textAnchor="middle" fontSize="10" fontWeight="700" fontFamily="Spectral, Georgia, serif">
                i
              </text>
            </svg>
          </button>
        </div>
        <div className={`landing-content ${landingPhase === 'intro' ? 'landing-single-intro' : ''}`}>
          {landingPhase === 'intro' ? (
            <>
              <div className="landing-single-background" style={landingIntroBackgroundStyle} aria-hidden="true" />
              <div className="landing-single-photo-overlay" aria-hidden="true" />
              <div className="landing-single-start-wrap">
                <button
                  type="button"
                  className="landing-single-start-btn"
                  onClick={enterWelcomeStage}
                  disabled={landingExiting}
                >
                  start
                </button>
              </div>
            </>
          ) : (
            <>
              <img
                src={BENCH_LOGO_SRC}
                alt="The Bench"
                className={`landing-logo landing-logo-stamp ${landingActivated ? 'is-animated' : ''}`}
                draggable={false}
              />
              <div className="landing-start-slot">
                <button
                  className={`landing-start-text ${showLandingButton ? 'is-visible' : ''}`}
                  type="button"
                  onClick={enterDeskStage}
                  disabled={!showLandingButton || landingExiting}
                  aria-hidden={!showLandingButton}
                >
                  upload your breifs
                </button>
              </div>
            </>
          )}
        </div>
        {infoModal}
      </div>
    )
  }

  const intakeLocked = intakePhase !== 'idle'
  const showAnalysis = intakePhase === 'analyzing'
  const canEnter = Boolean(fileA && fileB) && !loadingA && !loadingB && !intakeLocked

  return (
    <div className="home home-professional desk-stage">
      <main className="home-main desk-main">
        <div className="desk-surface">
          <div className="top-left-action-stack">
            <button
              type="button"
              className="info-action-btn"
              onClick={openInfoModal}
              aria-label="Open session information"
              aria-haspopup="dialog"
              aria-expanded={infoModalOpen}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="info-action-icon">
                <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <text x="12" y="15.1" textAnchor="middle" fontSize="10" fontWeight="700" fontFamily="Spectral, Georgia, serif">
                  i
                </text>
              </svg>
            </button>
            <button
              type="button"
              className={`settings-gear-btn ${settingsPulseActive ? 'is-pulsing' : ''}`}
              onClick={openSettingsModal}
              aria-label="Open session settings"
              aria-haspopup="dialog"
              aria-expanded={settingsModalOpen}
              disabled={intakeLocked}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="settings-gear-icon">
                <path d="M19.43 12.98c.04-.32.07-.65.07-.98s-.03-.66-.07-.98l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.32 7.32 0 0 0-1.7-.98l-.38-2.65A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.49.42l-.38 2.65c-.62.25-1.19.58-1.7.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.5.5 0 0 0 .12.64L4.57 11c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46a.5.5 0 0 0 .61.22l2.49-1c.51.4 1.08.73 1.7.98l.38 2.65A.5.5 0 0 0 10 22h4a.5.5 0 0 0 .49-.42l.38-2.65c.62-.25 1.19-.58 1.7-.98l2.49 1a.5.5 0 0 0 .61-.22l2-3.46a.5.5 0 0 0-.12-.64L19.43 12.98zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z" />
              </svg>
            </button>
          </div>

          {infoModal}

          {settingsModalOpen && (
            <div
              className="settings-modal-backdrop"
              role="presentation"
              onClick={() => setSettingsModalOpen(false)}
            >
              <div
                className="settings-modal-shell"
                role="dialog"
                aria-modal="true"
                aria-label="Session settings"
                onClick={(event) => event.stopPropagation()}
              >
                <section className="paper-sheet blank settings-file-sheet">
                  <div className="paper-head settings-modal-head">
                    <span>Session Settings</span>
                    <button
                      type="button"
                      className="settings-modal-close-btn"
                      aria-label="Close settings modal"
                      onClick={() => setSettingsModalOpen(false)}
                    >
                      X
                    </button>
                  </div>

                  <div className="settings-file-body">
                    <div className="settings-ledger-row">
                      <p className="settings-ledger-copy">
                        <span className="settings-ledger-label">Side</span>
                        <span className="settings-ledger-note">Who you will argue for</span>
                      </p>
                      <div className="settings-ledger-options">
                        <button
                          type="button"
                          className={`settings-ledger-option ${userPartyRole === 'appellant' ? 'is-selected' : ''}`}
                          onClick={() => setUserPartyRole('appellant')}
                        >
                          Appellant
                        </button>
                        <button
                          type="button"
                          className={`settings-ledger-option ${userPartyRole === 'respondent' ? 'is-selected' : ''}`}
                          onClick={() => setUserPartyRole('respondent')}
                        >
                          Respondent
                        </button>
                      </div>
                    </div>

                    <div className="settings-ledger-row">
                      <p className="settings-ledger-copy">
                        <span className="settings-ledger-label">Session length</span>
                        <span className="settings-ledger-note">How long your oral argument runs</span>
                      </p>
                      <div className="settings-ledger-options">
                        {SESSION_LENGTH_OPTIONS.map((secs) => (
                          <button
                            key={secs}
                            type="button"
                            className={`settings-ledger-option ${sessionDuration === secs ? 'is-selected' : ''}`}
                            onClick={() => setSessionDuration(secs)}
                          >
                            {secs < 60 ? `${secs}s` : `${secs / 60}m`}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="settings-ledger-row">
                      <p className="settings-ledger-copy">
                        <span className="settings-ledger-label">Question style</span>
                        <span className="settings-ledger-note">Pick any judicial question types</span>
                      </p>
                      <div className="settings-ledger-control-stack">
                        <div className="settings-ledger-options settings-ledger-options-question-style">
                          {JUDGE_QUESTION_OPTIONS.map((option) => {
                            const isSelected = enabledQuestionTypes.includes(option.id)
                            return (
                              <button
                                key={option.id}
                                type="button"
                                className={`settings-ledger-option settings-ledger-option-question-style ${isSelected ? 'is-selected' : ''}`}
                                onClick={() => toggleQuestionType(option.id)}
                              >
                                {option.label}
                              </button>
                            )
                          })}
                        </div>
                        {enabledQuestionTypes.length === 0 && (
                          <p className="settings-ledger-warning" role="status" aria-live="polite">
                            You've selected no judges; this means no questions will be asked during your session.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="settings-ledger-row">
                      <p className="settings-ledger-copy">
                        <span className="settings-ledger-label">Interruption pace</span>
                        <span className="settings-ledger-note">How aggressively the judge cuts in</span>
                      </p>
                      <div className="settings-ledger-options">
                        {INTERRUPTION_LEVEL_OPTIONS.map((level) => (
                          <button
                            key={level}
                            type="button"
                            className={`settings-ledger-option ${judgeInterruptionLevel === level ? 'is-selected' : ''}`}
                            onClick={() => setJudgeInterruptionLevel(level)}
                          >
                            {INTERRUPTION_LEVEL_LABELS[level]}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="settings-ledger-row">
                      <p className="settings-ledger-copy">
                        <span className="settings-ledger-label">Judge difficulty</span>
                        <span className="settings-ledger-note">Select the judge avatar used in 3D court</span>
                      </p>
                      <div className="settings-ledger-options">
                        {JUDGE_DIFFICULTY_OPTIONS.map((level) => (
                          <button
                            key={level}
                            type="button"
                            className={`settings-ledger-option ${judgeAvatarDifficulty === level ? 'is-selected' : ''}`}
                            onClick={() => setJudgeAvatarDifficulty(level)}
                          >
                            {JUDGE_DIFFICULTY_LABELS[level]}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          )}

          <div className={`paper-grid ${intakePhase === 'launching' ? 'is-launching' : ''}`}>
            {showAnalysis ? (
              <div className="analysis-card analysis-card-full">
                <p>{ANALYSIS_MESSAGE}</p>
              </div>
            ) : (
              <>
                <section className={`paper-sheet ${fileA ? 'filled' : 'blank'} ${dragOverA ? 'dragging' : ''}`}>
                  <div className="paper-head paper-head-brief">
                    <span>Appellant Brief</span>
                  </div>
                  {fileA ? (
                    <div className="paper-dropzone paper-dropzone-filled">
                      <button
                        className="paper-remove-x"
                        onClick={() => removeFile('a')}
                        type="button"
                        aria-label="Remove appellant brief"
                      >
                        ×
                      </button>
                      <svg viewBox="0 0 24 24" className="paper-upload-success-icon" aria-hidden="true">
                        <path d="m5.8 12.4 4.1 4.1 8.3-8.3" />
                      </svg>
                    </div>
                  ) : (
                    <div
                      className={`paper-dropzone ${loadingA ? 'loading' : ''}`}
                      onDragOver={(e) => handleDragOver(e, setDragOverA)}
                      onDragEnter={(e) => handleDragOver(e, setDragOverA)}
                      onDragLeave={(e) => handleDragLeave(e, setDragOverA)}
                      onDrop={(e) => handleDrop(e, setFileA, setLoadingA, setDragOverA)}
                      onClick={() => !intakeLocked && inputRefA.current?.click()}
                    >
                      <input
                        ref={inputRefA}
                        type="file"
                        accept=".pdf,application/pdf"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) handleFileUpload(file, setFileA, setLoadingA)
                        }}
                        disabled={loadingA || intakeLocked}
                      />
                      <svg
                        viewBox="0 0 24 24"
                        className={`paper-upload-icon ${loadingA ? 'is-loading' : ''}`}
                        aria-hidden="true"
                      >
                        <path d="M12 15.5V5.75" />
                        <path d="m8.9 8.95 3.1-3.2 3.1 3.2" />
                        <path d="M5 14.6v3.7c0 .9.7 1.7 1.7 1.7h10.6c.9 0 1.7-.7 1.7-1.7v-3.7" />
                      </svg>
                    </div>
                  )}
                </section>

                <section className={`paper-sheet ${fileB ? 'filled' : 'blank'} ${dragOverB ? 'dragging' : ''}`}>
                  <div className="paper-head paper-head-brief">
                    <span>Respondent Brief</span>
                  </div>
                  {fileB ? (
                    <div className="paper-dropzone paper-dropzone-filled">
                      <button
                        className="paper-remove-x"
                        onClick={() => removeFile('b')}
                        type="button"
                        aria-label="Remove respondent brief"
                      >
                        ×
                      </button>
                      <svg viewBox="0 0 24 24" className="paper-upload-success-icon" aria-hidden="true">
                        <path d="m5.8 12.4 4.1 4.1 8.3-8.3" />
                      </svg>
                    </div>
                  ) : (
                    <div
                      className={`paper-dropzone ${loadingB ? 'loading' : ''}`}
                      onDragOver={(e) => handleDragOver(e, setDragOverB)}
                      onDragEnter={(e) => handleDragOver(e, setDragOverB)}
                      onDragLeave={(e) => handleDragLeave(e, setDragOverB)}
                      onDrop={(e) => handleDrop(e, setFileB, setLoadingB, setDragOverB)}
                      onClick={() => !intakeLocked && inputRefB.current?.click()}
                    >
                      <input
                        ref={inputRefB}
                        type="file"
                        accept=".pdf,application/pdf"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) handleFileUpload(file, setFileB, setLoadingB)
                        }}
                        disabled={loadingB || intakeLocked}
                      />
                      <svg
                        viewBox="0 0 24 24"
                        className={`paper-upload-icon ${loadingB ? 'is-loading' : ''}`}
                        aria-hidden="true"
                      >
                        <path d="M12 15.5V5.75" />
                        <path d="m8.9 8.95 3.1-3.2 3.1 3.2" />
                        <path d="M5 14.6v3.7c0 .9.7 1.7 1.7 1.7h10.6c.9 0 1.7-.7 1.7-1.7v-3.7" />
                      </svg>
                    </div>
                  )}
                </section>
              </>
            )}
          </div>

          <div className="desk-controls">
            <button
              type="button"
              className="settings-continue-btn"
              onClick={enterCourtroom}
              disabled={!canEnter}
            >
              {intakePhase === 'idle' ? 'Continue' : intakePhase === 'launching' ? 'Submitting…' : 'Reviewing…'}
            </button>
            <button
              type="button"
              className="settings-trash-btn"
              onClick={clearAll}
              disabled={intakeLocked || (!fileA && !fileB)}
            >
              Discard files
            </button>
          </div>

          {error && <div className="error-banner">{error}</div>}
        </div>
      </main>
    </div>
  )
}
