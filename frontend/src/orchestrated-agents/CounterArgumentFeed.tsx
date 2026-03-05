/**
 * Counter-Argument Feed
 *
 * Displays counter-arguments fired by assigned agents when the tracker
 * matches the user's speech to a predicted hearing topic.
 * Most-recent entries appear first.
 */

import type { CounterArgument } from '../multi-agent/types';
import './agenda.css';

interface CounterArgumentFeedProps {
  counterArguments: CounterArgument[];
}

export function CounterArgumentFeed({ counterArguments }: CounterArgumentFeedProps) {
  if (counterArguments.length === 0) {
    return (
      <p className="oa-feed__empty">
        Assign an agent to a lens in the agenda panel — they will respond here when
        you address their topic.
      </p>
    );
  }

  return (
    <div className="oa-feed">
      {[...counterArguments].reverse().map((arg, i) => (
        <div
          key={i}
          className="oa-feed__item"
          style={{ borderLeftColor: arg.color }}
        >
          <div className="oa-feed__header">
            <span className="oa-feed__dot" style={{ background: arg.color }} />
            <span className="oa-feed__name">{arg.agent_name}</span>
            <span className="oa-feed__topic">{arg.topic}</span>
          </div>
          <p className="oa-feed__text">{arg.counter_argument}</p>
        </div>
      ))}
    </div>
  );
}
