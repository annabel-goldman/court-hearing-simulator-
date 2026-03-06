/**
 * Judge Activity Feed
 *
 * Unified chronological log of selected agent responses — both questions
 * and counter-arguments — shown as a single timeline, newest first.
 * Each item is labelled with a type badge (Question / Counter).
 *
 * Counter-arguments now flow through the same pipeline as questions:
 * all agents generate them, the frontend receives them as agent_question
 * messages with question_type='counter', and only the selected winner
 * (selected=true) appears here.
 *
 * Styles: agenda.css (oa-feed-*)
 */

import { memo, useState } from 'react';
import type { AgentQuestion } from '../multi-agent/types';
import './agenda.css';

const RECENT_COUNT = 3;

interface JudgeActivityFeedProps {
  questions: AgentQuestion[];
}

export const JudgeActivityFeed = memo(function JudgeActivityFeed({ questions }: JudgeActivityFeedProps) {
  const [showAll, setShowAll] = useState(false);

  const selected = questions.filter(q => q.selected !== false);
  const sorted = [...selected].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  if (sorted.length === 0) {
    return (
      <p className="oa-feed__empty">
        Judge questions and counter-arguments will appear here during the hearing. The panel will update in real time as judges interrupt and respond.
      </p>
    );
  }

  const visible = showAll ? sorted : sorted.slice(0, RECENT_COUNT);
  const hiddenCount = sorted.length - RECENT_COUNT;

  return (
    <div className="oa-feed">
      {visible.map((q, i) => {
        const isCounter = q.question_type === 'counter';
        return (
          <div key={`${q.agent_id}-${i}`} className="oa-feed__item" style={{ borderLeftColor: q.color }}>
            <div className="oa-feed__header">
              <span className="oa-feed__dot" style={{ background: q.color }} />
              <span className="oa-feed__name">{q.agent_name}</span>
              <span className={`oa-feed__type-badge ${isCounter ? 'oa-feed__type-badge--counter' : 'oa-feed__type-badge--question'}`}>
                {isCounter ? 'Counter' : 'Question'}
              </span>
              {isCounter && q.topic && (
                <span className="oa-feed__topic">{q.topic}</span>
              )}
              <span className="oa-feed__time">
                {new Date(q.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <p className="oa-feed__text">{q.question}</p>
          </div>
        );
      })}

      {hiddenCount > 0 && (
        <button
          className="oa-feed__show-more"
          onClick={() => setShowAll(prev => !prev)}
        >
          {showAll ? 'Show recent only' : `See previous statements (${hiddenCount})`}
        </button>
      )}
    </div>
  );
});
