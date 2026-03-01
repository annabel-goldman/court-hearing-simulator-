/**
 * Multi-Agent Module Index
 * 
 * Re-exports components, hooks, and types for external consumption
 */

// Main page
export { AgentSimulation } from './pages/AgentSimulation';

// Composed components
export { BriefUpload } from './components/BriefUpload';
export { AgentEditor } from './components/AgentEditor';

// UI Components
export * from './components/ui';

// Feature Components
export * from './components/features';

// Hooks
export { useMultiAgentSocket } from './hooks/useMultiAgentSocket';
export { useMediaRecording } from './hooks/useMediaRecording';

// Types
export type {
  Agent,
  AgentQuestion,
  BriefData,
  SimulationPhase,
  MultiAgentSessionConfig,
  MultiAgentSocketMessage,
  // Shared orchestrated-agent types (canonical source — no circular imports)
  AgendaItem,
  PredictedTopic,
  AgendaUpdate,
  AgendaConfidence,
  TopicCoverage,
  CounterArgument,
  MCTSTree,
  MCTSNode,
  MCTSEdge,
} from './types';
