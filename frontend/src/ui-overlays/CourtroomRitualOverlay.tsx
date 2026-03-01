/**
 * CourtroomRitualOverlay Component
 *
 * Displays courtroom ritual phases (All Rise, Judge Entering, etc.)
 * with formal messaging and action buttons.
 */

import type { SimulationPhase } from '../3d-rendering/types'

interface CourtroomRitualOverlayProps {
  phase: SimulationPhase
  onAction: () => void
}

const RITUAL_CONTENT = {
  ALL_RISE: {
    stage: 'Opening Protocol',
    title: 'All Rise',
    subtitle: 'The Honorable Court is now in session.',
    instruction: 'Stand for the court opening statement.',
    buttonText: 'Standing',
  },
  JUDGE_ENTERING: {
    stage: 'Opening Protocol',
    title: 'Judge Entering',
    subtitle: 'Please remain standing while the bench is entering.',
    instruction: null,
    buttonText: null,
  },
  JUDGE_SEATED: {
    stage: 'Opening Protocol',
    title: 'You May Be Seated',
    subtitle: 'Proceeding will begin momentarily.',
    instruction: 'Take your seat and prepare to present argument.',
    buttonText: 'Seated',
  },
  ADJOURNED: {
    stage: 'Session Closed',
    title: 'Court Adjourned',
    subtitle: 'The proceeding has concluded.',
    instruction: 'Select below to return to intake and start a new session.',
    buttonText: 'Exit Courtroom',
  },
} as const

export function CourtroomRitualOverlay({ phase, onAction }: CourtroomRitualOverlayProps) {
  if (phase === 'OFF_RECORD' || phase === 'PROCEEDING') {
    return null
  }

  const content = RITUAL_CONTENT[phase as keyof typeof RITUAL_CONTENT]
  if (!content) return null

  return (
    <div className="ritual-overlay">
      <div className="ritual-content">
        <p className="ritual-stage">{content.stage}</p>
        <h2 className="ritual-title">{content.title}</h2>
        <p className="ritual-subtitle">{content.subtitle}</p>
        {content.instruction && <p className="ritual-instruction">{content.instruction}</p>}
        {content.buttonText && (
          <button className="btn-primary-large ritual-btn" onClick={onAction}>
            {content.buttonText}
          </button>
        )}
      </div>
    </div>
  )
}
