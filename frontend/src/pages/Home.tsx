import { useState, useRef, DragEvent, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerSrc

interface UploadedFile {
  name: string
  text: string
}

type HomeStage = 'landing' | 'desk'
type IntakePhase = 'idle' | 'launching' | 'analyzing'

const ANALYSIS_MESSAGE = 'The judge is analyzing your briefs.'
const BENCH_LOGO_SRC = `${import.meta.env.BASE_URL}bench-logo.svg`

function SubmitFolderIcon() {
  return (
    <svg viewBox="0 0 24 24" className="action-icon" aria-hidden="true">
      <path d="M3 7.5a2.5 2.5 0 0 1 2.5-2.5h4L11.4 7h7.1A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
      <path d="M12 15V10.5" />
      <path d="m9.8 12.6 2.2-2.3 2.2 2.3" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="action-icon" aria-hidden="true">
      <path d="M4.5 7.5h15" />
      <path d="M9.5 7.5v-1a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1" />
      <path d="M7.5 7.5 8.3 18a2 2 0 0 0 2 1.8h3.4a2 2 0 0 0 2-1.8l.8-10.5" />
      <path d="M10.2 11v5.5" />
      <path d="M13.8 11v5.5" />
    </svg>
  )
}

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
  const [intakePhase, setIntakePhase] = useState<IntakePhase>('idle')

  const [fileA, setFileA] = useState<UploadedFile | null>(null)
  const [fileB, setFileB] = useState<UploadedFile | null>(null)
  const [loadingA, setLoadingA] = useState(false)
  const [loadingB, setLoadingB] = useState(false)
  const [dragOverA, setDragOverA] = useState(false)
  const [dragOverB, setDragOverB] = useState(false)
  const [landingActivated, setLandingActivated] = useState(false)
  const [showLandingButton, setShowLandingButton] = useState(false)
  const [error, setError] = useState('')
  const [sessionDuration, setSessionDuration] = useState(180)

  const inputRefA = useRef<HTMLInputElement>(null)
  const inputRefB = useRef<HTMLInputElement>(null)
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
    padOne.frequency.setValueAtTime(82.41, now) // E2

    const padTwo = ctx.createOscillator()
    padTwo.type = 'sine'
    padTwo.frequency.setValueAtTime(123.47, now) // B2

    const padThree = ctx.createOscillator()
    padThree.type = 'triangle'
    padThree.frequency.setValueAtTime(164.81, now) // E3

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
    if (stage !== 'landing') return

    setShowLandingButton(false)
    if (!landingActivated) return

    const timer = window.setTimeout(() => {
      setShowLandingButton(true)
    }, 1600)
    const stampOneTimer = window.setTimeout(() => {
      playStampSlamSound('heavy')
    }, 520)
    const stampTwoTimer = window.setTimeout(() => {
      playStampSlamSound('light')
    }, 1210)

    return () => {
      window.clearTimeout(timer)
      window.clearTimeout(stampOneTimer)
      window.clearTimeout(stampTwoTimer)
    }
  }, [stage, landingActivated])

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
      stopBackgroundMusic()
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        void audioContextRef.current.close()
      }
      audioContextRef.current = null
      audioUnlockedRef.current = false
    }
  }, [])

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
          { name: fileB.name, text: fileB.text, role: 'appellee' },
        ],
        useMultiAgentJudge: true,
        sessionDurationSeconds: sessionDuration,
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

  const enterDeskStage = async () => {
    await unlockAudio()
    playUploadSound()
    setStage('desk')
  }

  const beginLandingSequence = async () => {
    await unlockAudio()
    startBackgroundMusic()
    setLandingActivated(true)
  }

  if (stage === 'landing') {
    return (
      <div className="landing-stage">
        <div className="landing-backdrop-grid" />
        <div className="landing-content">
          <img
            src={BENCH_LOGO_SRC}
            alt="The Bench"
            className={`landing-logo landing-logo-stamp ${landingActivated ? 'is-animated' : ''}`}
            draggable={false}
          />
          <p className={`landing-stamp landing-stamp-secondary ${landingActivated ? 'is-animated' : ''}`}>
            to moot or not to moot
          </p>
          <div className="landing-start-slot">
            <button
              className={`landing-start-text ${showLandingButton ? 'is-visible' : ''}`}
              type="button"
              onClick={enterDeskStage}
              disabled={!showLandingButton}
              aria-hidden={!showLandingButton}
            >
              start
            </button>
          </div>
          {!landingActivated && (
            <div className="landing-gate-overlay">
              <button
                type="button"
                className="landing-gate-button"
                onClick={beginLandingSequence}
              >
                <span>Welcome to The Bench</span>
                <strong>Click to begin</strong>
              </button>
            </div>
          )}
        </div>
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
          <div className={`paper-grid ${intakePhase === 'launching' ? 'is-launching' : ''}`}>
            {showAnalysis ? (
              <div className="analysis-card analysis-card-full">
                <p>{ANALYSIS_MESSAGE}</p>
              </div>
            ) : (
              <>
                <section className={`paper-sheet ${fileA ? 'filled' : 'blank'} ${dragOverA ? 'dragging' : ''}`}>
                  <div className="paper-head">
                    <span>Appellant Brief</span>
                    <span>A</span>
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
                      <span className="paper-watermark">Appellant</span>
                      <p className="paper-filled-name">{fileA.name}</p>
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
                      <span className="paper-watermark">Appellant</span>
                      <p>{loadingA ? 'Reading brief...' : 'Submit appellant brief here'}</p>
                    </div>
                  )}
                </section>

                <section className={`paper-sheet ${fileB ? 'filled' : 'blank'} ${dragOverB ? 'dragging' : ''}`}>
                  <div className="paper-head">
                    <span>Appellee Brief</span>
                    <span>B</span>
                  </div>
                  {fileB ? (
                    <div className="paper-dropzone paper-dropzone-filled">
                      <button
                        className="paper-remove-x"
                        onClick={() => removeFile('b')}
                        type="button"
                        aria-label="Remove appellee brief"
                      >
                        ×
                      </button>
                      <span className="paper-watermark">Appellee</span>
                      <p className="paper-filled-name">{fileB.name}</p>
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
                      <span className="paper-watermark">Appellee</span>
                      <p>{loadingB ? 'Reading brief...' : 'Submit appellee brief here'}</p>
                    </div>
                  )}
                </section>
              </>
            )}
          </div>

          <div className="session-duration-row">
            <span className="session-duration-label">Session length</span>
            <div className="session-duration-pills">
              {[60, 120, 180, 300, 600].map((secs) => (
                <button
                  key={secs}
                  type="button"
                  className={`duration-pill${sessionDuration === secs ? ' active' : ''}`}
                  onClick={() => setSessionDuration(secs)}
                  disabled={intakeLocked}
                >
                  {secs < 60 ? `${secs}s` : `${secs / 60}m`}
                </button>
              ))}
            </div>
          </div>

          <div className="desk-controls">
            <div className="action-row action-row-legal">
              <button
                className="icon-action-btn icon-submit-btn"
                onClick={enterCourtroom}
                disabled={!canEnter}
                aria-label={intakePhase === 'idle' ? 'Submit briefs to court' : intakePhase === 'launching' ? 'Submitting briefs' : 'Reviewing briefs'}
                title="Submit briefs"
              >
                {intakePhase === 'idle' ? <SubmitFolderIcon /> : '⌛'}
              </button>
              <button
                className="icon-action-btn icon-clear-btn"
                onClick={clearAll}
                disabled={intakeLocked || (!fileA && !fileB)}
                aria-label="Clear briefs"
                title="Clear briefs"
              >
                <TrashIcon />
              </button>
            </div>
          </div>

          {error && <div className="error-banner">{error}</div>}
        </div>
      </main>
    </div>
  )
}
