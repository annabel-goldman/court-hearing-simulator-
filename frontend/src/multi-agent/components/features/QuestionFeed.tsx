/**
 * Question Feed Component
 *
 * Groups questions into "rounds" — each evaluation cycle produces multiple
 * candidate questions from different agents, one of which is selected to be
 * spoken.  A round is closed once a question with selected=true arrives.
 *
 * - The CURRENT (incomplete) round is always shown; each agent gets a card.
 * - Closed rounds are collapsed; use "Show previous rounds" to expand history.
 * - Long responses scroll within each card (overflow-y: auto).
 *
 * Styles: styles/question-feed.css
 */

import { useState, useMemo } from 'react';
import type { Agent, AgentQuestion } from '../../types';
import '../../styles/question-feed.css';

interface QuestionFeedProps {
  questions: AgentQuestion[];
  agents?: Agent[];
  placeholder?: string;
}

interface Round {
  id: number;
  questions: AgentQuestion[];
  winner: AgentQuestion | null;
  closed: boolean;
}

function groupIntoRounds(questions: AgentQuestion[]): Round[] {
  const rounds: Round[] = [];
  let current: AgentQuestion[] = [];
  let roundId = 0;

  for (const q of questions) {
    current.push(q);

    if (q.selected === true) {
      rounds.push({
        id: roundId++,
        questions: current,
        winner: q,
        closed: true,
      });
      current = [];
    }
  }

  if (current.length > 0) {
    rounds.push({
      id: roundId,
      questions: current,
      winner: null,
      closed: false,
    });
  }

  return rounds;
}

/** One card per agent: show question if present, else placeholder */
function getAgentCardsForRound(round: Round, agents?: Agent[]): AgentQuestion[] {
  if (!agents || agents.length === 0) {
    return round.questions;
  }
  const byAgent = new Map(round.questions.map(q => [q.agent_id, q]));
  const fallbackTs = round.questions[0]?.timestamp ?? new Date().toISOString();
  return agents.map(agent => {
    const q = byAgent.get(agent.id);
    if (q) return q;
    return {
      agent_id: agent.id,
      agent_name: agent.name,
      color: agent.color,
      question: '—',
      timestamp: fallbackTs,
      selected: false,
    };
  });
}

export function QuestionFeed({
  questions,
  agents,
  placeholder = 'Agents will ask questions as you speak...',
}: QuestionFeedProps) {
  const [showPrevious, setShowPrevious] = useState(false);
  const rounds = useMemo(() => groupIntoRounds(questions), [questions]);

  if (questions.length === 0) {
    return (
      <div className="ma-question-feed">
        <p className="ma-question-feed__placeholder">{placeholder}</p>
      </div>
    );
  }

  const closedRounds = rounds.filter(r => r.closed);
  const currentRound = rounds.find(r => !r.closed) ?? null;

  return (
    <div className="ma-question-feed">
      {closedRounds.length > 0 && (
        <button
          className="ma-question-feed__toggle"
          onClick={() => setShowPrevious(p => !p)}
        >
          {showPrevious
            ? 'Hide previous rounds'
            : `Show previous rounds (${closedRounds.length})`}
        </button>
      )}

      {showPrevious && closedRounds.map((round) => (
        <RoundCard key={round.id} round={round} agents={agents} />
      ))}

      {currentRound ? (
        <div className="ma-round ma-round--current">
          <div className="ma-round__label">Current evaluation</div>
          <div className="ma-round__questions">
            {getAgentCardsForRound(currentRound, agents).map((q) => (
              <QuestionItem
                key={`${q.agent_id}-${q.timestamp}`}
                question={q}
                agentColor={agents?.find(a => a.id === q.agent_id)?.color}
              />
            ))}
          </div>
        </div>
      ) : (
        <p className="ma-question-feed__placeholder">
          Waiting for next evaluation…
        </p>
      )}
    </div>
  );
}

function RoundCard({ round, agents }: { round: Round; agents?: Agent[] }) {
  const [expanded, setExpanded] = useState(false);
  const winner = round.winner;

  return (
    <div className="ma-round ma-round--closed">
      <button
        className="ma-round__summary"
        onClick={() => setExpanded(e => !e)}
        style={{ borderLeftColor: winner?.color ?? 'var(--ma-border-default)' }}
      >
        <span className="ma-round__summary-dot" style={{ background: winner?.color }} />
        <span className="ma-round__summary-name">{winner?.agent_name ?? 'Agent'}</span>
        <span className="ma-round__summary-text">
          {winner?.question
            ? (winner.question.length > 80 ? winner.question.slice(0, 78) + '…' : winner.question)
            : '—'}
        </span>
        <span className="ma-round__chevron">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="ma-round__questions">
          {getAgentCardsForRound(round, agents).map((q) => (
            <QuestionItem
              key={`${q.agent_id}-${q.timestamp}`}
              question={q}
              agentColor={agents?.find(a => a.id === q.agent_id)?.color}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface QuestionItemProps {
  question: AgentQuestion;
  agentColor?: string;
}

function QuestionItem({ question, agentColor }: QuestionItemProps) {
  const isSelected = question.selected === true;
  const color = question.color || agentColor || '#888';

  return (
    <div
      className={`ma-question-item${isSelected ? ' ma-question-item--spoken' : ''}`}
      style={{
        backgroundColor: `${color}${isSelected ? '30' : '15'}`,
        borderLeftColor: color,
      }}
    >
      <div className="ma-question-item__header">
        <span className="ma-question-item__dot" style={{ backgroundColor: color }} />
        <span className="ma-question-item__agent-name" style={{ color }}>
          {question.agent_name}
        </span>
        <span className="ma-question-item__timestamp">
          {new Date(question.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
        {isSelected && <span className="ma-question-item__spoken">Spoken</span>}
      </div>
      <div className="ma-question-item__text-wrap">
        <p className="ma-question-item__text">{question.question}</p>
      </div>
    </div>
  );
}
