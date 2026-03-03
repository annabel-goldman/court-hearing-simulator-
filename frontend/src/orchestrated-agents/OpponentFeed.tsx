/**
 * Opponent Response Feed
 *
 * Displays adaptive respondent (opposing counsel) arguments generated
 * by the OpponentEngine. Shows the opponent's rebuttal, the tactic used,
 * and the estimated strength — helping the student understand what a real
 * opposing counsel would argue.
 *
 * Most-recent entries appear first.
 */

import { useState } from 'react';
import type { OpponentResponse } from '../multi-agent/types';
import './agenda.css';

interface OpponentFeedProps {
  responses: OpponentResponse[];
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  rebuttal:      { label: 'Rebuttal',      color: '#e74c3c' },
  exploitation:  { label: 'Exploitation',   color: '#e67e22' },
  affirmative:   { label: 'Affirmative',    color: '#2980b9' },
};

const RECENT_COUNT = 2;

function strengthBar(strength: number) {
  const pct = Math.min(100, Math.max(0, strength * 10));
  const hue = 120 - (strength / 10) * 120; // green→red as strength rises (stronger = more danger)
  return (
    <div className="oa-opponent__strength-bar" title={`Strength: ${strength}/10`}>
      <div
        className="oa-opponent__strength-fill"
        style={{ width: `${pct}%`, background: `hsl(${hue}, 70%, 50%)` }}
      />
    </div>
  );
}

export function OpponentFeed({ responses }: OpponentFeedProps) {
  const [showAll, setShowAll] = useState(false);

  if (responses.length === 0) {
    return (
      <p className="oa-feed__empty">
        The opposing counsel will respond here as you argue — adapting to your points
        and exploiting weaknesses the judges identify.
      </p>
    );
  }

  const sorted = [...responses].reverse();
  const visible = showAll ? sorted : sorted.slice(0, RECENT_COUNT);
  const hiddenCount = sorted.length - RECENT_COUNT;

  return (
    <div className="oa-feed">
      {visible.map((resp, i) => {
        const typeInfo = TYPE_LABELS[resp.response_type] || TYPE_LABELS.rebuttal;
        return (
          <div
            key={i}
            className="oa-feed__item"
            style={{ borderLeftColor: typeInfo.color }}
          >
            <div className="oa-feed__header">
              <span
                className="oa-feed__badge oa-feed__badge--opponent"
                style={{ background: typeInfo.color }}
              >
                {typeInfo.label}
              </span>
              <span className="oa-feed__topic">{resp.topic}</span>
              {strengthBar(resp.strength)}
            </div>
            <p className="oa-feed__text">{resp.argument}</p>
            {resp.strategy_note && (
              <p className="oa-feed__strategy">
                <em>Strategy: {resp.strategy_note}</em>
              </p>
            )}
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
}
