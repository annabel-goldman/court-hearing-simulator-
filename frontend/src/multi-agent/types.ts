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
  is_custom?: boolean;  // True if this agent can be deleted
  voice_id?: string;    // TTS voice ID; "" or undefined = provider default
}

export interface AgentQuestion {
  agent_id: string;
  agent_name: string;
  color: string;
  question: string;
  timestamp: string;
  selected?: boolean;     // true = chosen to interrupt (shown in Judge Activity)
  audio?: string;         // Base64-encoded TTS audio (opus)
  audio_format?: string;  // e.g. 'opus'
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

// ── MCTS tree types ────────────────────────────────────────────────────────

export interface MCTSNode {
  id: number;
  label: string;      // topic title, empty string for root
  visits: number;
  avg_value: number;
  depth: number;
}

export interface MCTSEdge {
  source: number;
  target: number;
}

export interface MCTSTree {
  nodes: MCTSNode[];
  edges: MCTSEdge[];
}

// ── Agenda / tracker types ─────────────────────────────────────────────────

export interface TopicCoverage {
  order: number;
  title: string;
  addressed: boolean;
  address_turn?: number | null;  // turn index when first addressed (from backend)
  quality: number;               // 0.0–1.0, LLM-assessed argument quality
}

export interface AgendaConfidence {
  prediction_id: number;
  lens: string;
  confidence: number;
  topics_coverage: TopicCoverage[];
  uncovered_titles?: string[];  // topics not yet addressed (from backend tracker)
  weak_titles?: string[];       // topics addressed with quality < 0.4
}

export interface AgendaUpdate {
  best_prediction_id: number;
  agenda_confidences: AgendaConfidence[];
  last_human_matched_topic: string | null;
  predicted_next_topics: string[];
  mcts_tree?: MCTSTree;
  triggered_by?: string;
  regeneration_needed?: boolean;  // backend signals when agendas should be regenerated
}

export interface ArgumentScore {
  speaker: string;            // "appellant" | "respondent"
  clarity: number;            // 0-10
  legal_reasoning: number;    // 0-10
  responsiveness: number;     // 0-10
  persuasiveness: number;     // 0-10
  overall: number;            // 0-10
  feedback: string;
}

export interface CounterArgument {
  agent_id: string;
  agent_name: string;
  color: string;
  topic: string;
  counter_argument: string;
  timestamp: string;
}

export interface OpponentResponse {
  response_type: 'rebuttal' | 'exploitation' | 'affirmative';
  argument: string;
  strategy_note: string;
  topic: string;
  strength: number;
  timestamp: string;
  audio?: string;         // Base64-encoded TTS audio
  audio_format?: string;  // e.g. 'mp3'
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'judge' | 'opponent';
  text: string;
  agentName?: string;
  agentColor?: string;
  timestamp: number;
}

// ── Orchestrated‑agent agenda types ────────────────────────────────────────
// Defined here (not in AgendaPanel) so both modules can import them without a
// circular dependency between multi-agent ↔ orchestrated-agents.

export interface PredictedTopic {
  order: number;
  title: string;
  description: string;
  target: 'petitioner' | 'respondent' | 'both';
}

export interface AgendaItem {
  id: string;
  lens: string;
  rationale: string;
  topics: PredictedTopic[];
  agentId: string | null;
}
