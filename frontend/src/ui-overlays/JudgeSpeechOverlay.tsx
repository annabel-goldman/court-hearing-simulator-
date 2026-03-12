/**
 * JudgeSpeechOverlay Component
 *
 * Displays the judge's current speech in the center of the screen.
 */

import type { JudgeInterruptSource } from '../types/socket'

interface JudgeSpeechOverlayProps {
  question: string | null
  source?: JudgeInterruptSource | null
}

export function JudgeSpeechOverlay({ question, source }: JudgeSpeechOverlayProps) {
  if (!question) return null

  const isAgent = source?.type === 'multi_agent'
  const accentColor = isAgent && source?.agent_color ? source.agent_color : 'var(--primary)'
  const label = isAgent && source?.agent_name ? source.agent_name : 'Bench Direction'

  return (
    <div className="judge-question-overlay" role="status" aria-live="polite">
      <div
        className="judge-question-content"
        style={{
          borderColor: accentColor,
          boxShadow: `0 4px 30px color-mix(in srgb, ${accentColor} 30%, transparent)`,
        }}
      >
        <span className="judge-label" style={{ color: accentColor }}>
          {label}
        </span>
        <p className="judge-question-text">{question}</p>
      </div>
    </div>
  )
}
