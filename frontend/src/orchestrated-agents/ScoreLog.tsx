/**
 * Score Log
 *
 * Visual log of argument scores assigned by the judge engine.
 * Each entry shows the speaker, overall score, a short feedback excerpt,
 * and four dimension progress bars.
 *
 * Styles: score-log.css
 */

import type { ArgumentScore } from '../multi-agent/types';
import './score-log.css';

interface ScoreLogProps {
  scores: ArgumentScore[];
}

const DIMS: { key: keyof ArgumentScore; label: string }[] = [
  { key: 'clarity',         label: 'Clarity' },
  { key: 'legal_reasoning', label: 'Legal Rsn.' },
  { key: 'responsiveness',  label: 'Responsive' },
  { key: 'persuasiveness',  label: 'Persuasion' },
];

function overallClass(v: number): string {
  if (v >= 7) return 'sl-overall--high';
  if (v >= 5) return 'sl-overall--mid';
  return 'sl-overall--low';
}

export function ScoreLog({ scores }: ScoreLogProps) {
  if (scores.length === 0) {
    return (
      <div className="sl-log">
        <p className="sl-log__placeholder">No scores yet. Start the session to see argument scores.</p>
      </div>
    );
  }

  return (
    <div className="sl-log">
      {[...scores].reverse().slice(0, 20).map((score, i) => {
        const isRespondent = score.speaker === 'respondent';
        const fillClass = isRespondent ? 'sl-dim__fill sl-dim__fill--respondent' : 'sl-dim__fill';

        return (
          <div
            key={i}
            className={`sl-entry sl-entry--${score.speaker}`}
          >
            <div className="sl-entry__header">
              <span className={`sl-speaker sl-speaker--${score.speaker}`}>
                {score.speaker}
              </span>
              <span className={`sl-overall ${overallClass(score.overall)}`}>
                {score.overall.toFixed(1)}
              </span>
              {score.feedback && (
                <span className="sl-feedback" title={score.feedback}>
                  {score.feedback}
                </span>
              )}
            </div>

            <div className="sl-dims">
              {DIMS.map(({ key, label }) => {
                const val = score[key] as number;
                return (
                  <div key={key} className="sl-dim">
                    <span className="sl-dim__label">{label}</span>
                    <div className="sl-dim__track">
                      <div
                        className={fillClass}
                        style={{ width: `${Math.min(100, (val / 10) * 100)}%` }}
                      />
                    </div>
                    <span className="sl-dim__value">{val.toFixed(1)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
