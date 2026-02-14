/**
 * JudgeSpeechOverlay Component
 * 
 * Displays the judge's current question/speech in the center of the screen.
 */

interface JudgeSpeechOverlayProps {
  question: string | null
}

export function JudgeSpeechOverlay({ question }: JudgeSpeechOverlayProps) {
  if (!question) return null

  return (
    <div className="judge-question-overlay">
      <div className="judge-question-content">
        <span className="judge-label">Judge:</span>
        <p className="judge-question-text">{question}</p>
      </div>
    </div>
  )
}
