/**
 * Judge Activity Feed
 *
 * Unified chronological log that merges judge questions ("won" interrupts)
 * and counter-arguments into a single timeline, newest first.
 * Each item is labelled with a type badge so the distinction is clear.
 *
 * Styles: agenda.css (oa-feed-*)
 */

import { useState } from 'react';
import type { AgentQuestion, CounterArgument } from '../multi-agent/types';
import './agenda.css';

type ActivityItem =
  | { kind: 'question'; ts: number; data: AgentQuestion }
  | { kind: 'counter';  ts: number; data: CounterArgument };

const RECENT_COUNT = 2;

interface JudgeActivityFeedProps {
  questions: AgentQuestion[];
  counterArguments: CounterArgument[];
}

export function JudgeActivityFeed({ questions, counterArguments }: JudgeActivityFeedProps) {
  const [showAll, setShowAll] = useState(false);

  // Only show questions that were selected to actually interrupt the student.
  // All agent questions appear in the per-agent QuestionFeed grid, but only
  // the randomly chosen winner appears here in the judicial activity log.
  const selectedQuestions = questions.filter(q => q.selected !== false);

  const items: ActivityItem[] = [
    ...selectedQuestions.map((q): ActivityItem => ({
      kind: 'question',
      ts: new Date(q.timestamp).getTime(),
      data: q,
    })),
    ...counterArguments.map((c): ActivityItem => ({
      kind: 'counter',
      ts: new Date(c.timestamp).getTime(),
      data: c,
    })),
  ].sort((a, b) => b.ts - a.ts);

  if (items.length === 0) {
    return (
      <p className="oa-feed__empty">
        Judge questions and counter-arguments will appear here during the hearing.
      </p>
    );
  }

  const visible = showAll ? items : items.slice(0, RECENT_COUNT);
  const hiddenCount = items.length - RECENT_COUNT;

  return (
    <div className="oa-feed">
      {visible.map((item, i) => {
        if (item.kind === 'question') {
          const q = item.data;
          return (
            <div key={`q-${i}`} className="oa-feed__item" style={{ borderLeftColor: q.color }}>
              <div className="oa-feed__header">
                <span className="oa-feed__dot" style={{ background: q.color }} />
                <span className="oa-feed__name">{q.agent_name}</span>
                <span className="oa-feed__type-badge oa-feed__type-badge--question">Question</span>
                <span className="oa-feed__time">
                  {new Date(q.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p className="oa-feed__text">{q.question}</p>
            </div>
          );
        } else {
          const c = item.data;
          return (
            <div key={`c-${i}`} className="oa-feed__item" style={{ borderLeftColor: c.color }}>
              <div className="oa-feed__header">
                <span className="oa-feed__dot" style={{ background: c.color }} />
                <span className="oa-feed__name">{c.agent_name}</span>
                <span className="oa-feed__type-badge oa-feed__type-badge--counter">Counter</span>
                <span className="oa-feed__topic">{c.topic}</span>
                <span className="oa-feed__time">
                  {new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p className="oa-feed__text">{c.counter_argument}</p>
            </div>
          );
        }
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
}
