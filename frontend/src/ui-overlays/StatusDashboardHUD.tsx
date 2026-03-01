/**
 * StatusDashboardHUD Component
 *
 * Heads-up display elements for the courtroom simulation.
 */

import { RefObject } from 'react'
import type { SpeakingRole, SimulationPhase } from '../3d-rendering/types'

interface StatusDashboardHUDProps {
  phase: SimulationPhase
  isConnected: boolean
  isCameraOn: boolean
  isMicOn: boolean
  isRecording: boolean
  audioLevel: number
  timerSeconds: number
  recentTranscript: string
  speakingRole: SpeakingRole
  videoPreviewRef: RefObject<HTMLVideoElement>
  onEndSession: () => void
}

const PHASE_LABELS: Record<SimulationPhase, string> = {
  OFF_RECORD: 'Off Record',
  ALL_RISE: 'All Rise',
  JUDGE_ENTERING: 'Judge Entering',
  JUDGE_SEATED: 'Judge Seated',
  PROCEEDING: 'Proceeding',
  ADJOURNED: 'Adjourned',
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function StatusDashboardHUD({
  phase,
  isConnected,
  isCameraOn,
  isMicOn,
  isRecording,
  audioLevel,
  timerSeconds,
  recentTranscript,
  speakingRole,
  videoPreviewRef,
  onEndSession,
}: StatusDashboardHUDProps) {
  const isProceeding = phase === 'PROCEEDING'

  return (
    <>
      <div className="top-left-panel">
        <div className="self-preview-compact">
          <video
            ref={videoPreviewRef}
            autoPlay
            muted
            playsInline
            className="self-preview-video-small"
          />
          <div className="media-status-row">
            <span className={`status-dot ${isCameraOn ? 'active' : 'inactive'}`} title="Camera">
              {isCameraOn ? 'CAM' : 'CAM OFF'}
            </span>
            <span className={`status-dot ${isMicOn ? 'active' : 'inactive'}`} title="Microphone">
              {isRecording ? 'REC' : (isMicOn ? 'MIC ON' : 'MIC OFF')}
            </span>
            {isMicOn && (
              <div className="audio-level-meter-small" aria-hidden>
                <div
                  className="audio-level-bar"
                  style={{ width: `${Math.min(Math.max(audioLevel - 10, 0) * 4, 100)}%` }}
                />
              </div>
            )}
          </div>
        </div>

        {isProceeding && (
          <div className="transcript-panel">
            <span className="transcript-header-label">Live Transcript</span>
            <span className="transcript-content-text">
              {recentTranscript || 'Listening for your argument...'}
            </span>
          </div>
        )}
      </div>

      <div className="courtroom-command-bar">
        <div className="courtroom-command-left">
          <span className="phase-chip">{PHASE_LABELS[phase]}</span>
          {isProceeding && (
            <div className="courtroom-timer">
              <span className="timer-label">Time Remaining</span>
              <span className={`timer-value ${timerSeconds < 60 ? 'danger' : timerSeconds < 180 ? 'warning' : ''}`}>
                {formatTime(timerSeconds)}
              </span>
            </div>
          )}
          <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
            <span className="connection-dot" />
            <span className="connection-label">{isConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
        </div>

        {isProceeding && (
          <button className="btn-end-session" onClick={onEndSession}>
            End Session
          </button>
        )}
      </div>

      {speakingRole && isProceeding && (
        <div className="speaking-indicator-3d">
          <span className="wave" />
          <span className="wave" />
          <span className="wave" />
          <span className="speaking-text">
            {speakingRole === 'judge' ? 'Bench Speaking' : 'Counsel Speaking'}
          </span>
        </div>
      )}
    </>
  )
}
