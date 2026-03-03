/**
 * Agenda Panel
 *
 * Controlled component: agenda items are derived from the projected timeline
 * (generated once the briefs are uploaded). Each item represents one judicial
 * lens — the title is the lens name, the rationale explains why a judge might
 * adopt that angle, and the topics list shows the predicted questions the judge
 * will probe.
 *
 * During a live session the panel also shows:
 *  - A confidence bar per lens (tracker EMA score)
 *  - ✓ checkmarks on topics the speaker has addressed
 *  - A highlight on the currently active topic (MCTS + tracker match)
 *  - The MCTS-predicted next topics ("Coming next") at the top
 */

import { useState } from 'react';
import type { Agent, AgendaItem, AgendaUpdate, PredictedTopic } from '../multi-agent/types';
import { Card, CardHeader, CardContent } from '../multi-agent/components/ui';
import './agenda.css';

// Re-export for backwards compatibility — consumers that import from here
// will continue to work.
export type { AgendaItem, PredictedTopic };

interface AgendaPanelProps {
  agents: Agent[];
  items: AgendaItem[];
  onItemsChange: (items: AgendaItem[]) => void;
  isLoading?: boolean;
  statusText?: string;
  coverage?: AgendaUpdate | null;
}

const TARGET_LABELS: Record<PredictedTopic['target'], string> = {
  petitioner: 'Petitioner',
  respondent: 'Respondent',
  both: 'Both',
};

export function AgendaPanel({
  agents,
  items,
  onItemsChange,
  isLoading = false,
  statusText = '',
  coverage = null,
}: AgendaPanelProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dropdownValue, setDropdownValue] = useState('');

  const handleDropdownChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setDropdownValue(id);
    if (id) {
      setExpanded(id);
      document
        .getElementById(`agenda-item-${id}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => (prev === id ? null : id));
    setDropdownValue(id);
  };

  const handleAssignAgent = (itemId: string, agentId: string) => {
    onItemsChange(
      items.map((item) =>
        item.id === itemId ? { ...item, agentId: agentId || null } : item
      )
    );
  };

  const activeLensId = coverage ? String(coverage.best_prediction_id) : null;
  const activeTopicTitle = coverage?.last_human_matched_topic ?? null;
  const nextTopics = coverage?.predicted_next_topics ?? [];

  return (
    <Card>
      <CardHeader>Projected Hearing Agenda</CardHeader>
      <CardContent>
        {isLoading && items.length === 0 ? (
          <div className="oa-agenda__loading">
            <span className="oa-agenda__spinner" />
            <span>{statusText || 'Generating agenda from briefs…'}</span>
          </div>
        ) : items.length === 0 ? (
          <p className="oa-agenda__empty">
            Upload both briefs and press Start to see the projected hearing agenda.
          </p>
        ) : (
          <div className="oa-agenda">
            {/* Streaming status while items are still arriving */}
            {isLoading && statusText && (
              <div className="oa-agenda__loading oa-agenda__loading--inline">
                <span className="oa-agenda__spinner" />
                <span>{statusText}</span>
              </div>
            )}

            {/* MCTS next-topic prediction */}
            {nextTopics.length > 0 && (
              <div className="oa-next-topics">
                <span>Coming next:</span>
                <div className="oa-next-topics__list">
                  {nextTopics.slice(0, 4).map((t) => (
                    <span key={t} className="oa-next-topics__tag">{t}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Jump-to dropdown */}
            <select
              className="oa-agenda__dropdown"
              value={dropdownValue}
              onChange={handleDropdownChange}
            >
              <option value="">Jump to judicial lens…</option>
              {items.map((item, i) => (
                <option key={`${i}-${item.id}`} value={item.id}>
                  {i + 1}. {item.lens}
                </option>
              ))}
            </select>

            {/* Vertical timeline */}
            <div className="oa-timeline">
              {items.map((item, index) => {
                const assignedAgent = agents.find((a) => a.id === item.agentId);
                const isExpanded = expanded === item.id;
                const isLast = index === items.length - 1;
                const isActive = item.id === activeLensId;

                // Per-lens coverage from tracker
                const ac = coverage?.agenda_confidences.find(
                  (c) => String(c.prediction_id) === item.id
                );
                const confidencePct = ac ? Math.round(ac.confidence * 100) : 0;

                return (
                  <div
                    key={`${index}-${item.id}`}
                    id={`agenda-item-${item.id}`}
                    className={[
                      'oa-timeline__item',
                      isExpanded ? 'oa-timeline__item--expanded' : '',
                      isActive   ? 'oa-timeline__item--active'   : '',
                    ].filter(Boolean).join(' ')}
                  >
                    {/* Left rail */}
                    <div className="oa-timeline__rail">
                      <div className="oa-timeline__dot">{index + 1}</div>
                      {!isLast && <div className="oa-timeline__line" />}
                    </div>

                    {/* Right content */}
                    <div className="oa-timeline__content">
                      <button
                        className="oa-timeline__title"
                        onClick={() => toggleExpand(item.id)}
                      >
                        <span>{item.lens}</span>
                        <span className="oa-timeline__chevron">
                          {isExpanded ? '▲' : '▼'}
                        </span>
                      </button>

                      {/* Confidence bar (visible even when collapsed) */}
                      {ac && (
                        <div
                          className="oa-confidence-bar"
                          style={{ width: `${confidencePct}%` }}
                          title={`Confidence: ${confidencePct}%`}
                        />
                      )}

                      {isExpanded && (
                        <div className="oa-timeline__body">
                          {/* Rationale */}
                          <div className="oa-timeline__section">
                            <span className="oa-timeline__section-label">Rationale</span>
                            <p className="oa-timeline__summary">{item.rationale}</p>
                          </div>

                          {/* Predicted topics */}
                          {item.topics.length > 0 && (
                            <div className="oa-timeline__section">
                              <span className="oa-timeline__section-label">
                                Predicted Topics ({item.topics.length})
                              </span>
                              <div className="oa-topics">
                                {item.topics.map((topic) => {
                                  const coverageItem = ac?.topics_coverage.find(
                                    (tc) => tc.title === topic.title
                                  );
                                  const isAddressed = coverageItem?.addressed ?? false;
                                  const quality     = coverageItem?.quality ?? 0;
                                  const isWeak      = isAddressed && quality < 0.4;
                                  const isCurrent = topic.title === activeTopicTitle;

                                  return (
                                    <div
                                      key={`${item.id}-${topic.order}-${topic.title}`}
                                      className={[
                                        'oa-topic',
                                        isAddressed && !isWeak ? 'oa-topic--addressed' : '',
                                        isWeak      ? 'oa-topic--weak'      : '',
                                        isCurrent   ? 'oa-topic--active'   : '',
                                      ].filter(Boolean).join(' ')}
                                    >
                                      <div className="oa-topic__header">
                                        <span className="oa-topic__order">{topic.order}</span>
                                        <span className="oa-topic__title">{topic.title}</span>
                                        {isAddressed && !isWeak && (
                                          <span className="oa-topic__check">✓</span>
                                        )}
                                        {isWeak && (
                                          <span className="oa-topic__weak-badge" title={`Quality: ${(quality * 100).toFixed(0)}%`}>⚠ weak</span>
                                        )}
                                        {isAddressed && (
                                          <span className="oa-topic__quality-bar" title={`Argument quality: ${(quality * 100).toFixed(0)}%`}>
                                            <span
                                              className="oa-topic__quality-fill"
                                              style={{
                                                width: `${quality * 100}%`,
                                                backgroundColor: quality >= 0.7 ? '#22d3ee' : quality >= 0.4 ? '#fb923c' : '#f87171',
                                              }}
                                            />
                                          </span>
                                        )}
                                        <span className={`oa-topic__target oa-topic__target--${topic.target}`}>
                                          {TARGET_LABELS[topic.target]}
                                        </span>
                                      </div>
                                      <p className="oa-topic__description">{topic.description}</p>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Agent assignment */}
                          <div className="oa-timeline__section">
                            <span className="oa-timeline__section-label">Assigned Agent</span>
                            <select
                              className="oa-timeline__agent-select"
                              value={item.agentId || ''}
                              onChange={(e) => handleAssignAgent(item.id, e.target.value)}
                            >
                              <option value="">No agent assigned</option>
                              {agents.map((agent) => (
                                <option key={agent.id} value={agent.id}>
                                  {agent.name}
                                </option>
                              ))}
                            </select>

                            {assignedAgent && (
                              <div
                                className="oa-agent-card"
                                style={{ borderLeftColor: assignedAgent.color }}
                              >
                                <div className="oa-agent-card__header">
                                  <span
                                    className="oa-agent-card__dot"
                                    style={{ backgroundColor: assignedAgent.color }}
                                  />
                                  <span className="oa-agent-card__name">
                                    {assignedAgent.name}
                                  </span>
                                </div>
                                <p className="oa-agent-card__description">
                                  {assignedAgent.description}
                                </p>
                                {assignedAgent.triggers.length > 0 && (
                                  <div className="oa-agent-card__triggers">
                                    <span className="oa-agent-card__triggers-label">Triggers</span>
                                    <div className="oa-agent-card__tags">
                                      {assignedAgent.triggers.map((t, i) => (
                                        <span key={i} className="oa-agent-card__tag">{t}</span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
