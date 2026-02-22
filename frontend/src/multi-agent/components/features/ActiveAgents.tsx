/**
 * Active Agents Display Component
 * 
 * Shows badges for all active agents with their colors
 * 
 * Styles: styles/active-agents.css
 */

import { Badge } from '../ui';
import type { Agent } from '../../types';
import '../../styles/active-agents.css';

interface ActiveAgentsProps {
  agents: Agent[];
}

export function ActiveAgents({ agents }: ActiveAgentsProps) {
  if (agents.length === 0) return null;

  return (
    <div className="ma-active-agents">
      <p className="ma-active-agents__label">Active Agents:</p>
      <div className="ma-active-agents__list">
        {agents.map(agent => (
          <Badge key={agent.id} color={agent.color}>
            {agent.name}
          </Badge>
        ))}
      </div>
    </div>
  );
}
