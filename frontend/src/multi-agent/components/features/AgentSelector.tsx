/**
 * Agent Selector Component
 * 
 * Grid of buttons to select an agent for editing
 * 
 * Styles: styles/agent-selector.css
 */

import type { Agent } from '../../types';
import '../../styles/agent-selector.css';

interface AgentSelectorProps {
  agents: Agent[];
  selectedAgentId: string | null;
  localEdits: Record<string, Agent>;
  onSelect: (agentId: string) => void;
}

export function AgentSelector({ 
  agents, 
  selectedAgentId, 
  localEdits,
  onSelect 
}: AgentSelectorProps) {
  return (
    <div className="ma-agent-selector">
      {agents.map(agent => {
        const effective = localEdits[agent.id] || agent;
        const hasEdits = !!localEdits[agent.id];
        const isSelected = selectedAgentId === agent.id;
        
        const btnClasses = [
          'ma-agent-selector__btn',
          isSelected ? 'ma-agent-selector__btn--selected' : '',
        ].filter(Boolean).join(' ');
        
        return (
          <button
            key={agent.id}
            onClick={() => onSelect(agent.id)}
            className={btnClasses}
            style={{ backgroundColor: effective.color }}
          >
            {effective.name}
            {hasEdits && <span className="ma-agent-selector__edit-marker">*</span>}
          </button>
        );
      })}
    </div>
  );
}
