/**
 * Question Feed Component
 * 
 * Displays agent questions in real-time with color coding
 * 
 * Styles: styles/question-feed.css
 */

import type { AgentQuestion } from '../../types';
import '../../styles/question-feed.css';

interface QuestionFeedProps {
  questions: AgentQuestion[];
  placeholder?: string;
}

export function QuestionFeed({ 
  questions, 
  placeholder = "Agents will ask questions as you speak..." 
}: QuestionFeedProps) {
  return (
    <div className="ma-question-feed">
      {questions.length === 0 ? (
        <p className="ma-question-feed__placeholder">{placeholder}</p>
      ) : (
        questions.map((q, index) => (
          <QuestionItem key={`${q.agent_id}-${index}`} question={q} />
        ))
      )}
    </div>
  );
}

interface QuestionItemProps {
  question: AgentQuestion;
}

function QuestionItem({ question }: QuestionItemProps) {
  return (
    <div
      className="ma-question-item"
      style={{ 
        backgroundColor: `${question.color}20`,
        borderLeftColor: question.color
      }}
    >
      <div className="ma-question-item__header">
        <span 
          className="ma-question-item__dot"
          style={{ backgroundColor: question.color }}
        />
        <span 
          className="ma-question-item__agent-name"
          style={{ color: question.color }}
        >
          {question.agent_name}
        </span>
        <span className="ma-question-item__timestamp">
          {new Date(question.timestamp).toLocaleTimeString()}
        </span>
      </div>
      <p className="ma-question-item__text">{question.question}</p>
    </div>
  );
}
