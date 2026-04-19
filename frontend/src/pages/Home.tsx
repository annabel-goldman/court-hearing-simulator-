import { useState, useRef, DragEvent, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import type { JudgeAvatarDifficulty, SessionAgendaItem } from '../3d-rendering/types'
import { preloadCourtroomGlbAssets } from '../3d-rendering/preloadCourtroomGlbs'
import { getAssetUrl } from '../config/assetUrls'
import { extractPdfText } from '../features/pdf/utils/extractPdfText'
import { loadMultiAgentProfiles } from '../features/orchestrated/services/multiAgentService'
import { requestProjectedTimelineStream } from '../features/orchestrated/services/timelineService'
import { buildAgendaItemsFromPredictions } from '../utils/buildAgendaItems'
import type { RawDonePayload } from '../utils/buildAgendaItems'
import type { Agent } from '../multi-agent/types'

import demoPredictedTopicSets from '../data/harvard-demo/predicted-topic-sets.json'
import appellantBriefRaw from '../data/harvard-demo/appellant-brief.txt?raw'
import respondentBriefRaw from '../data/harvard-demo/respondent-brief.txt?raw'

interface UploadedFile {
  name: string
  text: string
}

type HomeStage = 'landing' | 'desk'
type IntakePhase = 'idle' | 'launching' | 'analyzing'
type IntakeMode = 'live' | 'demo'

const PREPARING_MESSAGE = 'Preparing your session…'

const PHASE_LABELS: Record<string, string> = {
  extracting:  'Phase 1 — Extracting key legal issues…',
  agendas:     'Phase 2 — Generating judicial lenses…',
  refinement:  'Phase 2.5 — Scoring Topics…',
  mcts:        'Phase 3 — Simulating Potential Conversations…',
}
const BENCH_LOGO_SRC = getAssetUrl('bench-logo.svg')
const LANDING_INTRO_BACKGROUND_SRC = getAssetUrl('Background.jpg')
const SETTINGS_PULSE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000
const SETTINGS_PULSE_LAST_SEEN_KEY = 'homeSettingsPulseLastSeenAt'
const SETTINGS_PULSE_SESSION_KEY = 'homeSettingsPulseShownThisSession'
const DEFAULT_USER_PARTY_ROLE = 'appellant'
const DEFAULT_JUDGE_AVATAR_DIFFICULTY: JudgeAvatarDifficulty = 'medium'
const LANDING_TO_DESK_TRANSITION_MS = 760
const DESK_ENTER_TRANSITION_MS = 420
const DEMO_FAKE_ANALYSIS_MS = 5000
const DEMO_UPLOAD_DELAY_MS = 600

const SESSION_LENGTH_OPTIONS = [60, 120, 180, 300, 600, 900] as const
const TEAM_MEMBERS = [
  'Annabel Goldman',
  'Aurora Shi',
  'Sophia Pi',
  'Fernanda Carvalho',
  'Teni Aina',
  'Johnalbert Garnica',
] as const

export default function Home() {
  const navigate = useNavigate()
  const location = useLocation()

  const [stage, setStage] = useState<HomeStage>('landing')
  const [intakeMode, setIntakeMode] = useState<IntakeMode>('live')
  const [intakePhase, setIntakePhase] = useState<IntakePhase>('idle')
  const [loadingStatus, setLoadingStatus] = useState('')
  const [volumeLevel, setVolumeLevel] = useState(0.72)
  const [volumePopoverOpen, setVolumePopoverOpen] = useState(false)
  const [landingExitActive, setLandingExitActive] = useState(false)
  const [deskEnterActive, setDeskEnterActive] = useState(false)

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
  const [judgeAgents, setJudgeAgents] = useState<Agent[]>([])
  const [judgeAgentsLoading, setJudgeAgentsLoading] = useState(false)
  const [judgeAgentsLoadError, setJudgeAgentsLoadError] = useState('')
  const [enabledJudgeAgentIds, setEnabledJudgeAgentIds] = useState<string[]>([])
  const [isEnteringDemo, setIsEnteringDemo] = useState(false)

  const landingIntroBackgroundStyle = {
    backgroundImage: `url(${LANDING_INTRO_BACKGROUND_SRC})`,
  }

  const inputRefA = useRef<HTMLInputElement>(null)
  const inputRefB = useRef<HTMLInputElement>(null)
  const volumeControlRef = useRef<HTMLDivElement | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const outputGainRef = useRef<GainNode | null>(null)
  const audioUnlockedRef = useRef(false)
  const backgroundMusicRef = useRef<{
    oscillators: OscillatorNode[]
    gainNode: GainNode
    pulseIntervalId: number
  } | null>(null)
  const landingExitTimerRef = useRef<number | null>(null)
  const deskEnterTimerRef = useRef<number | null>(null)
  const intakeLocked = intakePhase !== 'idle'
  const isDemoMode = intakeMode === 'demo'

  useEffect(() => {
    const state = location.state as { returnToWelcome?: boolean } | null
    if (state?.returnToWelcome) {
      setLandingExitActive(false)
      setDeskEnterActive(false)
      setStage('desk')
    }
  }, [location.state])

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

  const getOutputGainNode = (ctx: AudioContext) => {
    if (outputGainRef.current && outputGainRef.current.context === ctx) {
      return outputGainRef.current
    }

    const gainNode = ctx.createGain()
    gainNode.gain.setValueAtTime(volumeLevel, ctx.currentTime)
    gainNode.connect(ctx.destination)
    outputGainRef.current = gainNode
    return gainNode
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
    gain.connect(getOutputGainNode(ctx))
    oscillator.start(startTime)
    oscillator.stop(startTime + duration)
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
    gain.connect(getOutputGainNode(ctx))
    source.start(now)
    source.stop(now + duration + 0.02)

    createTone(ctx, now + 0.03, 0.42, 350, 130, 'triangle', 0.06, 0.0001)
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
      }
      if (deskEnterTimerRef.current !== null) {
        window.clearTimeout(deskEnterTimerRef.current)
      }
      stopBackgroundMusic()
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        void audioContextRef.current.close()
      }
      audioContextRef.current = null
      outputGainRef.current = null
      audioUnlockedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!settingsModalOpen && !infoModalOpen && !volumePopoverOpen) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setInfoModalOpen(false)
        setSettingsModalOpen(false)
        setVolumePopoverOpen(false)
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [infoModalOpen, settingsModalOpen, volumePopoverOpen])

  useEffect(() => {
    const ctx = audioContextRef.current
    const output = outputGainRef.current
    if (!ctx || !output || ctx.state === 'closed') return

    const now = ctx.currentTime
    output.gain.cancelScheduledValues(now)
    output.gain.setValueAtTime(output.gain.value, now)
    output.gain.linearRampToValueAtTime(volumeLevel, now + 0.08)
  }, [volumeLevel])

  useEffect(() => {
    if (!volumePopoverOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      if (volumeControlRef.current?.contains(event.target as Node)) return
      setVolumePopoverOpen(false)
    }

    window.addEventListener('mousedown', handlePointerDown)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
    }
  }, [volumePopoverOpen])

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

  useEffect(() => {
    if (stage !== 'desk') return
    if (judgeAgents.length > 0 || judgeAgentsLoadError) return

    let isCancelled = false
    setJudgeAgentsLoading(true)
    setJudgeAgentsLoadError('')

    loadMultiAgentProfiles()
      .then((agents) => {
        if (isCancelled) return
        setJudgeAgents(agents)
        setEnabledJudgeAgentIds((current) => {
          if (current.length === 0) {
            return agents.map((agent) => agent.id)
          }
          const availableIds = new Set(agents.map((agent) => agent.id))
          return current.filter((id) => availableIds.has(id))
        })
      })
      .catch((loadError) => {
        if (isCancelled) return
        console.error('[Home] Failed to load judge agents:', loadError)
        setJudgeAgents([])
        setJudgeAgentsLoadError('Unable to load judge question types right now.')
      })
      .finally(() => {
        if (!isCancelled) {
          setJudgeAgentsLoading(false)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [stage, judgeAgents.length, judgeAgentsLoadError])

  const resetUploadedFiles = () => {
    setFileA(null)
    setFileB(null)
    setLoadingA(false)
    setLoadingB(false)
    setDragOverA(false)
    setDragOverB(false)
    setError('')
    setLoadingStatus('')
    setIntakePhase('idle')
    if (inputRefA.current) inputRefA.current.value = ''
    if (inputRefB.current) inputRefB.current.value = ''
  }

  const handleFileUpload = async (
    file: File,
    setFile: (f: UploadedFile | null) => void,
    setLoadingState: (l: boolean) => void
  ) => {
    if (!isDemoMode && !file.type.includes('pdf') && !file.name.endsWith('.pdf')) {
      setError('Please upload a PDF file')
      return
    }

    setLoadingState(true)
    setError('')

    try {
      if (isDemoMode) {
        await new Promise((resolve) => window.setTimeout(resolve, DEMO_UPLOAD_DELAY_MS))
        setFile({ name: file.name, text: '' })
      } else {
        const text = await extractPdfText(file)
        setFile({ name: file.name, text })
      }
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

  const buildBaseSessionConfig = (materials: Array<{ name: string; text: string; role: string }>) => ({
    proceedingType: 'demo' as const,
    userRole: 'attorney' as const,
    materials,
    useMultiAgentJudge: true,
    sessionDurationSeconds: sessionDuration,
    enabledJudgeAgentIds,
    judgeAvatarDifficulty: DEFAULT_JUDGE_AVATAR_DIFFICULTY,
    userPartyRole: DEFAULT_USER_PARTY_ROLE,
  })

  const buildLiveSessionConfig = async () => {
    if (!fileA?.text || !fileB?.text) {
      throw new Error('Both briefs are required')
    }

    const baseConfig = buildBaseSessionConfig([
      { name: fileA.name, text: fileA.text, role: 'appellant' },
      { name: fileB.name, text: fileB.text, role: 'respondent' },
    ])

    try {
      const agendaData = await generateOrchestratedAgenda(fileA.text, fileB.text, setLoadingStatus)

      return {
        ...baseConfig,
        judicialSummary: agendaData?.case_summary,
        predictedTopicSets: agendaData?.predictedTopicSets,
        agendaItems: agendaData?.agendaItems,
      }
    } catch (summaryError) {
      console.warn('Session config build failed, using fallback:', summaryError)
      return { ...baseConfig }
    }
  }

  const loadPreanalyzedDemoAgenda = async (onStatus?: (msg: string) => void) => {
    const phaseKeys = ['extracting', 'agendas', 'refinement', 'mcts'] as const
    const perPhaseMs = DEMO_FAKE_ANALYSIS_MS / phaseKeys.length

    for (const phase of phaseKeys) {
      onStatus?.(PHASE_LABELS[phase] ?? '')
      await new Promise((resolve) => window.setTimeout(resolve, perPhaseMs))
    }

    const rawDone = demoPredictedTopicSets as RawDonePayload
    const agendaItems = buildAgendaItemsFromPredictions(rawDone)

    return {
      predictedTopicSets: rawDone,
      case_summary: rawDone.case_summary as string | undefined,
      agendaItems,
    }
  }

  const buildDemoSessionConfig = async () => {
    if (!fileA || !fileB) {
      throw new Error('Both files are required')
    }

    const agendaData = await loadPreanalyzedDemoAgenda(setLoadingStatus)
    const baseConfig = buildBaseSessionConfig([
      { name: fileA.name, text: appellantBriefRaw, role: 'appellant' },
      { name: fileB.name, text: respondentBriefRaw, role: 'respondent' },
    ])

    return {
      ...baseConfig,
      judicialSummary: agendaData.case_summary,
      predictedTopicSets: agendaData.predictedTopicSets,
      agendaItems: agendaData.agendaItems,
    }
  }

  async function generateOrchestratedAgenda(
    appellantBrief: string,
    appelleeBrief: string,
    onStatus?: (msg: string) => void
  ): Promise<{
    predictedTopicSets: unknown
    case_summary?: string
    agendaItems: SessionAgendaItem[]
  } | null> {
    try {
      const res = await requestProjectedTimelineStream({
        appellant_brief: appellantBrief,
        appellee_brief: appelleeBrief,
      })
      if (!res.ok || !res.body) return null

      onStatus?.('Sending briefs to the LLM…')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let rawDone: Record<string, unknown> | null = null
      let lensCount = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''

        for (const part of parts) {
          const line = part.trim()
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice('data: '.length)) as {
              type: string
              data?: Record<string, unknown>
            }
            if (event.type === 'status') {
              const phase = event.data?.phase as string | undefined
              onStatus?.(PHASE_LABELS[phase ?? ''] ?? '')
            } else if (event.type === 'agenda') {
              lensCount++
              const lens = event.data?.lens as string | undefined
              onStatus?.(`Phase 2 — Lens ${lensCount}: ${lens ?? ''}`)
            } else if (event.type === 'done' && event.data) {
              rawDone = event.data as Record<string, unknown>
            }
          } catch {
            /* skip parse errors */
          }
        }
      }

      if (!rawDone) return null

      const agendaItems = buildAgendaItemsFromPredictions(rawDone as RawDonePayload)

      return {
        predictedTopicSets: rawDone,
        case_summary: rawDone.case_summary as string | undefined,
        agendaItems,
      }
    } catch (e) {
      console.warn('Orchestrated agenda generation failed:', e)
      return null
    }
  }

  const enterCourtroom = async () => {
    if (!fileA || !fileB) {
      setError(isDemoMode ? 'Please upload both files before entering the courtroom' : 'Please upload both briefs before entering the courtroom')
      return
    }

    setError('')
    setLoadingStatus('')
    setIntakePhase('launching')

    try {
      const sessionPromise = isDemoMode ? buildDemoSessionConfig() : buildLiveSessionConfig()
      playBriefSendWhoosh()

      await new Promise((resolve) => window.setTimeout(resolve, 900))
      setIntakePhase('analyzing')

      const [sessionConfig] = await Promise.all([
        sessionPromise,
        new Promise((resolve) => window.setTimeout(resolve, isDemoMode ? 0 : 2200)),
      ])

      await preloadCourtroomGlbAssets(DEFAULT_JUDGE_AVATAR_DIFFICULTY, (loaded, total) => {
        if (loaded >= total) {
          setLoadingStatus('Finalizing courtroom…')
          return
        }
        setLoadingStatus(`Loading courtroom models (${loaded}/${total})…`)
      })

      stopBackgroundMusic()
      localStorage.setItem('judgeAvatarDifficulty', DEFAULT_JUDGE_AVATAR_DIFFICULTY)
      sessionStorage.setItem('courtSession', JSON.stringify(sessionConfig))
      navigate('/courtroom')
    } catch (err) {
      setIntakePhase('idle')
      setLoadingStatus('')
      setError(`Unable to enter courtroom: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  const clearAll = () => {
    if (intakePhase !== 'idle') return

    resetUploadedFiles()
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

  const goBackInFlow = () => {
    if (stage === 'landing') {
      navigate(-1)
      return
    }

    if (intakeLocked) return

    setInfoModalOpen(false)
    setSettingsModalOpen(false)
    setVolumePopoverOpen(false)
    setStage('landing')
    stopBackgroundMusic()
  }

  const toggleJudgeAgent = (agentId: string) => {
    setEnabledJudgeAgentIds((current) => (
      current.includes(agentId)
        ? current.filter((id) => id !== agentId)
        : [...current, agentId]
    ))
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
    setVolumePopoverOpen(false)
    setSettingsModalOpen(false)
    setInfoModalOpen(true)
  }

  const openSettingsModal = () => {
    setVolumePopoverOpen(false)
    markSettingsPulseSeen()
    setInfoModalOpen(false)
    setSettingsModalOpen(true)
  }

  const handleVolumeSliderChange = (value: string) => {
    const parsed = Number(value)
    if (Number.isNaN(parsed)) return
    const clamped = Math.max(0, Math.min(100, parsed))
    setVolumeLevel(clamped / 100)
  }

  const volumePercent = Math.round(volumeLevel * 100)
  const isVolumeMuted = volumePercent === 0
  const volumeControl = (
    <div className="volume-control-wrap" ref={volumeControlRef}>
      <button
        type="button"
        className="landing-mute-btn"
        onClick={() => setVolumePopoverOpen((open) => !open)}
        aria-label="Adjust background audio volume"
        aria-haspopup="dialog"
        aria-expanded={volumePopoverOpen}
        title={`Volume: ${volumePercent}%`}
      >
        {isVolumeMuted ? (
          <svg viewBox="0 0 24 24" aria-hidden="true" className="landing-mute-icon">
            <path d="M3 9v6h4l5 5V4L7 9H3z" />
            <path d="m16 9 5 6M21 9l-5 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true" className="landing-mute-icon">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
          </svg>
        )}
      </button>
      {volumePopoverOpen && (
        <div className="volume-popover" role="dialog" aria-label="Volume control">
          <label htmlFor="volume-slider" className="volume-popover-label">Volume</label>
          <input
            id="volume-slider"
            className="volume-popover-slider"
            type="range"
            min="0"
            max="100"
            step="1"
            value={volumePercent}
            onChange={(event) => handleVolumeSliderChange(event.target.value)}
          />
          <span className="volume-popover-value">{volumePercent}%</span>
        </div>
      )}
    </div>
  )

  const infoModal = infoModalOpen ? (
    <div
      className="settings-modal-backdrop"
      role="presentation"
      onClick={() => setInfoModalOpen(false)}
    >
      <div
        className="settings-modal-shell info-modal-shell"
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
            <div className="info-sheet">
              <section className="info-sheet__hero">
                <p className="info-sheet__eyebrow">About The Bench</p>
                <h2 className="info-sheet__title">
                  Built to make moot court preparation more effective and more accessible.
                </h2>
                <p className="info-sheet__lede">
                  The Bench was created by a team of engineers and law students to help law
                  students prepare more effectively for moot court.
                </p>
              </section>

              <section className="info-sheet__section">
                <p className="info-sheet__paragraph">
                  Law school is designed to prepare students for litigation, but opportunities
                  for meaningful courtroom practice are often limited. Moot court helps fill
                  that gap by giving students a chance to develop oral advocacy skills in a
                  simulated setting. However, traditional moot court preparation can be
                  time-intensive and expensive, which can make regular practice difficult to
                  access. We believe that more efficient simulation tools can expand
                  opportunities for experiential learning.
                </p>
                <p className="info-sheet__paragraph">
                  Our goal was to identify the most important learning outcomes students gain
                  from moot court participation. To do this, we analyzed the types of
                  questions judges most commonly ask, identified the core advocacy skills those
                  questions are intended to assess, and translated them into specialized
                  agents. By modeling these high-priority lines of questioning, The Bench is
                  designed to target the skills that matter most in moot court preparation.
                </p>
              </section>

              <section className="info-sheet__callout" aria-label="Settings information">
                <span className="info-sheet__callout-label">Customize your session</span>
                <p className="info-sheet__callout-copy">
                  You can customize your experience in the Settings panel. There, you can
                  choose which types of agents you want asking questions and adjust the length
                  of your session.
                </p>
              </section>

              <section className="info-sheet__team-section" aria-label="Team members">
                <div className="info-sheet__team-heading">
                  <p className="info-sheet__eyebrow info-sheet__eyebrow--compact">Our Team</p>
                  <h3 className="info-sheet__team-title">
                    The people behind the project
                  </h3>
                </div>
                <div className="info-sheet__team-list" role="list">
                  {TEAM_MEMBERS.map((member) => (
                    <span key={member} className="info-sheet__team-pill" role="listitem">
                      {member}
                    </span>
                  ))}
                </div>
              </section>

              <section className="info-sheet__footer" aria-label="Project details">
                <p className="info-sheet__footer-copy">
                  For a look inside the project flow, open{' '}
                  <button
                    type="button"
                    className="info-ledger-link info-sheet__footer-link"
                    onClick={() => {
                      setInfoModalOpen(false)
                      navigate('/orchestrated-agents')
                    }}
                  >
                    Playground Mode
                  </button>
                  .
                </p>
              </section>
            </div>
          </div>
        </section>
      </div>
    </div>
  ) : null

  const enterDeskStage = async (mode: IntakeMode) => {
    if (stage === 'desk' || landingExitActive) return
    if (mode === 'demo') {
      setIsEnteringDemo(true)
    }
    setIntakeMode(mode)
    resetUploadedFiles()
    await unlockAudio()
    playBriefSendWhoosh()
    setVolumePopoverOpen(false)
    setDeskEnterActive(true)
    setLandingExitActive(true)

    if (landingExitTimerRef.current !== null) {
      window.clearTimeout(landingExitTimerRef.current)
    }
    landingExitTimerRef.current = window.setTimeout(() => {
      stopBackgroundMusic()
      setStage('desk')
      setLandingExitActive(false)
      setIsEnteringDemo(false)
      landingExitTimerRef.current = null
    }, LANDING_TO_DESK_TRANSITION_MS)

    if (deskEnterTimerRef.current !== null) {
      window.clearTimeout(deskEnterTimerRef.current)
    }
    deskEnterTimerRef.current = window.setTimeout(() => {
      setDeskEnterActive(false)
      deskEnterTimerRef.current = null
    }, LANDING_TO_DESK_TRANSITION_MS + DESK_ENTER_TRANSITION_MS)
  }

  const shouldRenderLanding = stage === 'landing'
  const shouldRenderDesk = stage === 'desk' || landingExitActive

  const landingStage = shouldRenderLanding ? (
    <div className={`landing-stage ${landingExitActive ? 'is-transitioning-to-desk transition-overlay' : ''}`}>
        <div className="landing-backdrop-grid" />
        <div className="top-left-action-stack">
          <div className="top-left-action-row">
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
          </div>
        </div>
        <div className="landing-content landing-single-intro">
          <div className="landing-single-background" style={landingIntroBackgroundStyle} aria-hidden="true" />
          <div className="landing-single-photo-overlay" aria-hidden="true" />
          <div className="landing-intro-copy-stack">
            <img
              src={BENCH_LOGO_SRC}
              alt="The Bench"
              className="landing-intro-logo"
              draggable={false}
            />
            <button
              type="button"
              className="landing-single-start-btn landing-intro-start-btn"
              onClick={() => enterDeskStage('live')}
            >
              prepare for moot court
            </button>
            <button
              type="button"
              className="landing-demo-btn"
              onClick={() => enterDeskStage('demo')}
              disabled={isEnteringDemo}
            >
              {isEnteringDemo ? 'Loading demo…' : 'demo mode'}
            </button>
          </div>
        </div>
        {infoModal}
      </div>
  ) : null

  const isLaunching = intakePhase === 'launching'
  const showLoading = intakePhase === 'analyzing'
  const loadingMessage = loadingStatus || PREPARING_MESSAGE
  const canEnter = Boolean(fileA && fileB) && !loadingA && !loadingB && !intakeLocked

  const deskStage = shouldRenderDesk ? (
    <div className="home home-professional desk-stage">
      <main className="home-main desk-main">
        <div className={`desk-surface ${deskEnterActive ? 'is-entering' : ''}`}>
          <button
            type="button"
            className="flow-back-btn"
            onClick={goBackInFlow}
            aria-label="Go back"
            disabled={intakeLocked}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="flow-back-icon">
              <path d="M14.5 5.5 8 12l6.5 6.5" />
            </svg>
          </button>
          <div className="top-left-action-stack">
            <div className="top-left-action-row">
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
              {volumeControl}
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
                        <span className="settings-ledger-label">Question types</span>
                        <span className="settings-ledger-note">Choose which judges are allowed to question you</span>
                      </p>
                      <div className="settings-ledger-control-stack">
                        <div className="settings-ledger-options settings-ledger-options-question-style">
                          {judgeAgents.map((agent) => {
                            const isSelected = enabledJudgeAgentIds.includes(agent.id)
                            return (
                              <button
                                key={agent.id}
                                type="button"
                                className={`settings-ledger-option settings-ledger-option-question-style ${isSelected ? 'is-selected' : ''}`}
                                onClick={() => toggleJudgeAgent(agent.id)}
                                title={agent.description}
                              >
                                {agent.name}
                              </button>
                            )
                          })}
                        </div>
                        {judgeAgentsLoading && (
                          <p className="settings-ledger-note" role="status" aria-live="polite">
                            Loading available judges…
                          </p>
                        )}
                        {!judgeAgentsLoading && judgeAgentsLoadError && (
                          <p className="settings-ledger-warning" role="status" aria-live="polite">
                            {judgeAgentsLoadError}
                          </p>
                        )}
                        {!judgeAgentsLoading && !judgeAgentsLoadError && judgeAgents.length === 0 && (
                          <p className="settings-ledger-warning" role="status" aria-live="polite">
                            No judge agents are currently available.
                          </p>
                        )}
                        {!judgeAgentsLoading && judgeAgents.length > 0 && enabledJudgeAgentIds.length === 0 && (
                          <p className="settings-ledger-warning" role="status" aria-live="polite">
                            You've selected no judges; this means no questions will be asked during your session.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          )}

          <div className={`paper-grid ${isLaunching ? 'is-launching' : ''}`}>
            {showLoading ? (
              <div className="analysis-card analysis-card-full">
                <div className="analysis-card-loader" role="status" aria-label="Loading" />
                <p>{loadingMessage}</p>
                <p className="analysis-card-patience">Please be patient — this process can take 2–5 minutes.</p>
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
                        accept={isDemoMode ? undefined : '.pdf,application/pdf'}
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
                        accept={isDemoMode ? undefined : '.pdf,application/pdf'}
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
  ) : null

  if (landingExitActive) {
    return (
      <div className="home-transition-shell">
        <div className="transition-underlay">
          {deskStage}
        </div>
        {landingStage}
      </div>
    )
  }

  if (shouldRenderLanding) {
    return landingStage
  }

  return (
    <>
      {deskStage}
    </>
  )
}
