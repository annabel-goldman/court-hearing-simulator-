/**
 * StatusDashboardHUD Component
 * 
 * Heads-up display elements for the courtroom simulation:
 * - Self-preview video
 * - Timer
 * - Connection status
 * - Transcript feedback
 * - Speaking indicator
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
      {/* Top Left: Self-preview video and transcript feedback */}
      <div className="top-left-panel">
        {/* Self-preview video */}
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
              {isCameraOn ? '📹' : '🚫'}
            </span>
            <span className={`status-dot ${isMicOn ? 'active' : 'inactive'}`} title="Microphone">
              {isRecording ? '🔴' : (isMicOn ? '🎤' : '🔇')}
            </span>
            {isMicOn && (
              <div className="audio-level-meter-small">
                <div 
                  className="audio-level-bar" 
                  style={{ width: `${Math.min(Math.max(audioLevel - 10, 0) * 4, 100)}%` }}
                />
              </div>
            )}
          </div>
        </div>
        
        {/* Transcript feedback */}
        {isProceeding && (
          <div className="transcript-panel">
            <span className="transcript-header-label">Hearing:</span>
            <span className="transcript-content-text">
              {recentTranscript || 'Listening...'}
            </span>
          </div>
        )}
      </div>
      
      {/* Top Center: Timer */}
      {isProceeding && (
        <div className="courtroom-timer">
          <span className="timer-label">Time Remaining</span>
          <span className={`timer-value ${timerSeconds < 60 ? 'danger' : timerSeconds < 180 ? 'warning' : ''}`}>
            {formatTime(timerSeconds)}
          </span>
        </div>
      )}

      {/* Top Right: Connection status and end session */}
      {isProceeding && (
        <div className="top-right-controls">
          <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
            <span className="connection-dot" />
            <span className="connection-label">{isConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
          <button className="btn-end-session" onClick={onEndSession}>
            End Session
          </button>
        </div>
      )}

      {/* Speaking indicator - bottom center */}
      {speakingRole && isProceeding && (
        <div className="speaking-indicator-3d">
          <span className="wave"></span>
          <span className="wave"></span>
          <span className="wave"></span>
          <span className="speaking-text">
            {speakingRole === 'judge' ? 'Judge' : 'Counsel'} speaking...
          </span>
        </div>
      )}
    </>
  )
}
