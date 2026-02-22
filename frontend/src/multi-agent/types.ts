/**
 * Types for the Multi-Agent Simulation module
 */

export interface Agent {
  id: string;
  name: string;
  color: string;
  description: string;
  triggers: string[];
  example_questions: string[];
  extra_prompt: string;
  version?: number;
  created_at?: string;
  is_default?: boolean;
}

export interface AgentQuestion {
  agent_id: string;
  agent_name: string;
  color: string;
  question: string;
  timestamp: string;
}

export interface BriefData {
  name: string;
  text: string;
}

export interface MultiAgentSessionConfig {
  agents: Agent[];
  brief_summary: string;
}

export type SimulationPhase = 'SETUP' | 'READY' | 'RECORDING' | 'PAUSED' | 'FINISHED';

export interface MultiAgentSocketMessage {
  type: string;
  data: Record<string, unknown>;
}
