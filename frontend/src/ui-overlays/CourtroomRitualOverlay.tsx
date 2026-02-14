/**
 * CourtroomRitualOverlay Component
 * 
 * Displays courtroom ritual phases (All Rise, Judge Entering, etc.)
 * with appropriate messaging and action buttons.
 */

import type { SimulationPhase } from '../3d-rendering/types'

interface CourtroomRitualOverlayProps {
  phase: SimulationPhase
  onAction: () => void
}

const RITUAL_CONTENT = {
  ALL_RISE: {
    icon: '⚖️',
    title: 'All Rise',
    subtitle: 'The Honorable Court is now in session',
    instruction: 'Please stand',
    buttonText: 'I am standing',
  },
  JUDGE_ENTERING: {
    icon: '👨‍⚖️',
    title: 'Judge Entering',
    subtitle: 'Please remain standing',
    instruction: null,
    buttonText: null,
  },
  JUDGE_SEATED: {
    icon: '🪑',
    title: 'You May Be Seated',
    subtitle: 'The court is now in session',
    instruction: 'Please take your seat',
    buttonText: 'I am seated',
  },
  ADJOURNED: {
    icon: '🏛️',
    title: 'Court Adjourned',
    subtitle: 'This proceeding has concluded',
    instruction: 'Thank you for your participation',
    buttonText: 'Exit Courtroom',
  },
} as const

export function CourtroomRitualOverlay({ phase, onAction }: CourtroomRitualOverlayProps) {
  // Skip rendering if not in a ritual phase
  if (phase === 'OFF_RECORD' || phase === 'PROCEEDING') {
    return null
  }

  const content = RITUAL_CONTENT[phase as keyof typeof RITUAL_CONTENT]
  if (!content) return null

  return (
    <div className="ritual-overlay">
      <div className="ritual-content">
        <div className="ritual-icon">{content.icon}</div>
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
