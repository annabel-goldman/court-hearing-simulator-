/**
 * AgentSentimentPanel
 *
 * Live display of each judge's eagerness to ask a question.
 * Scores (1-10) come from the backend after every multi-agent evaluation pass.
 */

import type { AgentScoreEntry } from '../hooks/useSimulationSocket'

interface AgentSentimentPanelProps {
  scores: Record<string, AgentScoreEntry>
  isVisible: boolean
}

export function AgentSentimentPanel({ scores, isVisible }: AgentSentimentPanelProps) {
  if (!isVisible) return null

  const entries = Object.values(scores)
  if (entries.length === 0) return null

  // Sort by descending relevance so hottest judges float to the top.
  const sorted = [...entries].sort((a, b) => {
    if (a.on_cooldown && !b.on_cooldown) return 1
    if (!a.on_cooldown && b.on_cooldown) return -1
    return (b.relevance ?? 0) - (a.relevance ?? 0)
  })

  return (
    <div className="agent-sentiment-panel">
      <div className="agent-sentiment-header">
        <span className="agent-sentiment-title">Bench Sentiment</span>
      </div>
      <div className="agent-sentiment-list">
        {sorted.map((entry) => {
          const color = entry.agent_color || 'var(--primary)'
          const rel = entry.relevance ?? 0
          const fillPct = entry.on_cooldown ? 0 : (rel / 10) * 100
          const isHot = !entry.on_cooldown && rel >= 7
          const wantsToAsk = entry.should_ask === true && !entry.on_cooldown

          return (
            <div
              key={entry.agent_id}
              className={`agent-sentiment-row${wantsToAsk ? ' wants-to-ask' : ''}${entry.on_cooldown ? ' on-cooldown' : ''}`}
            >
              <span
                className="agent-sentiment-dot"
                style={{ background: entry.on_cooldown ? 'var(--text-subtle)' : color }}
                aria-hidden
              />
              <div className="agent-sentiment-body">
                <div className="agent-sentiment-name-row">
                  <span
                    className="agent-sentiment-name"
                    style={{ color: entry.on_cooldown ? 'var(--text-subtle)' : color }}
                  >
                    {entry.agent_name}
                  </span>
                  {entry.on_cooldown && (
                    <span className="agent-sentiment-badge cooling">COOLING</span>
                  )}
                  {wantsToAsk && (
                    <span className="agent-sentiment-badge asking">ASKING</span>
                  )}
                </div>
                <div className="agent-sentiment-bar-track">
                  <div
                    className={`agent-sentiment-bar-fill${isHot ? ' hot' : ''}`}
                    style={{
                      width: `${fillPct}%`,
                      background: entry.on_cooldown ? 'var(--bg-muted)' : color,
                    }}
                  />
                  {!entry.on_cooldown && entry.relevance !== null && (
                    <span className="agent-sentiment-score">{rel}</span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
