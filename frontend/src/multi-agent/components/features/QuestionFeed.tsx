/**
 * Question Feed Component
 *
 * Shows each agent in its own column so you can see all judges in parallel.
 * Both regular questions (question_type='question') and counter-arguments
 * (question_type='counter') appear here — counters are tagged with a topic badge.
 * Below the grid, a compact chronological log shows recent entries from all agents.
 *
 * Styles: styles/question-feed.css
 */

import { memo } from 'react';
import type { Agent, AgentQuestion } from '../../types';
import '../../styles/question-feed.css';

interface QuestionFeedProps {
  agents?: Agent[];
  questions: AgentQuestion[];
}

export const QuestionFeed = memo(function QuestionFeed({ agents = [], questions }: QuestionFeedProps) {
  const byAgent: Record<string, AgentQuestion[]> = {};
  for (const q of questions) {
    (byAgent[q.agent_id] ??= []).push(q);
  }

  return (
    <div className="ma-qfeed">
      {/* ── Per-agent grid ── */}
      {agents.length === 0 ? (
        <p className="ma-qfeed__placeholder">No agents configured.</p>
      ) : (
        <div className="ma-qfeed__grid">
          {agents.map((agent) => {
            const agentQs = byAgent[agent.id] ?? [];
            const latest = agentQs[agentQs.length - 1];
            const count = agentQs.length;
            const isCounter = latest?.question_type === 'counter';

            return (
              <div
                key={agent.id}
                className={`ma-qfeed__card${count > 0 ? ' ma-qfeed__card--active' : ''}${isCounter ? ' ma-qfeed__card--counter' : ''}`}
                style={{ borderTopColor: agent.color }}
              >
                <div className="ma-qfeed__card-header">
                  <span className="ma-qfeed__dot" style={{ background: agent.color }} />
                  <span className="ma-qfeed__agent-name" style={{ color: agent.color }}>
                    {agent.name}
                  </span>
                  {count > 0 && (
                    <span className="ma-qfeed__badge">{count}</span>
                  )}
                </div>

                {latest ? (
                  <div className="ma-qfeed__latest">
                    {isCounter && latest.topic && (
                      <span className="ma-qfeed__type-tag ma-qfeed__type-tag--counter">
                        Counter · {latest.topic}
                      </span>
                    )}
                    <p className="ma-qfeed__question-text">{latest.question}</p>
                    <span className="ma-qfeed__time">
                      {new Date(latest.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                ) : (
                  <p className="ma-qfeed__idle">Listening…</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Chronological history ── */}
      {questions.length > 0 && (
        <div className="ma-qfeed__history">
          <p className="ma-qfeed__history-label">Recent activity</p>
          {[...questions].reverse().map((q, i) => {
            const isCounter = q.question_type === 'counter';
            return (
              <div key={`${q.agent_id}-${i}`} className="ma-qfeed__history-item">
                <span className="ma-qfeed__dot ma-qfeed__dot--sm" style={{ background: q.color }} />
                <span className="ma-qfeed__history-name" style={{ color: q.color }}>
                  {q.agent_name}
                </span>
                {isCounter && (
                  <span className="ma-qfeed__type-tag ma-qfeed__type-tag--counter ma-qfeed__type-tag--sm">C</span>
                )}
                <span className="ma-qfeed__history-text">{q.question}</span>
                <span className="ma-qfeed__time ma-qfeed__time--right">
                  {new Date(q.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
