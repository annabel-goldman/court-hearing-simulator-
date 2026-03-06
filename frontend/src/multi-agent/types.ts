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
  is_custom?: boolean;
}

export interface AgentQuestion {
  agent_id: string;
  agent_name: string;
  color: string;
  question: string;
  timestamp: string;
  /** True for the question that was actually spoken; false/omit for others in the same batch */
  selected?: boolean;
  /** Set by the frontend for counter-argument items */
  question_type?: 'question' | 'counter';
  topic?: string;
  audio?: string;
  audio_format?: string;
}

export interface BriefData {
  name: string;
  text: string;
}

export interface MultiAgentSessionConfig {
  agents: Agent[];
  brief_summary: string;
}

export type SimulationPhase = 'SETUP' | 'READY' | 'INTRO' | 'RECORDING' | 'PAUSED' | 'FINISHED';

export interface MultiAgentSocketMessage {
  type: string;
  data: Record<string, unknown>;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'agent';
  text: string;
  timestamp: number;
}

export interface MCTSNode {
  id: number;
  label: string;
  visits: number;
  avg_value: number;
  depth: number;
}

export interface MCTSTree {
  nodes: MCTSNode[];
  edges: { source: number; target: number }[];
}

export interface PredictedTopic {
  order: number;
  title: string;
  description: string;
  target: string;
}

export interface AgendaItem {
  id: string;
  lens: string;
  rationale: string;
  topics: PredictedTopic[];
  agentId: string | null;
}

export interface TopicCoverage {
  title: string;
  addressed: boolean;
  quality: number;
}

export interface AgendaConfidence {
  prediction_id: number;
  lens: string;
  confidence: number;
  topics_coverage: TopicCoverage[];
  weak_titles?: string[];
}

export interface AgendaUpdate {
  best_prediction_id: number | null;
  agenda_confidences: AgendaConfidence[];
  last_human_matched_topic: string | null;
  predicted_next_topics: string[];
  mcts_tree?: MCTSTree | null;
  regeneration_needed: boolean;
}

export interface ArgumentScore {
  speaker: string;
  utterance_preview?: string;
  clarity: number;
  legal_reasoning: number;
  responsiveness: number;
  persuasiveness: number;
  overall: number;
  feedback: string;
  timestamp?: number;
}

export interface OpponentResponse {
  response_type: string;
  argument: string;
  strategy_note: string;
  topic: string;
  strength: number;
  timestamp: number;
  audio?: string;
  audio_format?: string;
}
