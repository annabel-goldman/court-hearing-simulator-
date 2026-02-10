/**
 * JudgeQuestionOverlay Component
 * 
 * Displays the judge's current question in the center of the screen.
 */

interface JudgeQuestionOverlayProps {
  question: string | null
}

export function JudgeQuestionOverlay({ question }: JudgeQuestionOverlayProps) {
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
