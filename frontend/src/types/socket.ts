import type { Agent as MultiAgentProfile } from '../multi-agent/types'

export interface JudgeInterruptSource {
  type: 'judge_engine' | 'multi_agent'
  strategy?: string
  agent_id?: string
  agent_name?: string
  agent_color?: string
}

export interface JudgeInterrupt {
  question: string
  reasoning?: string
  audio?: string
  audioFormat?: string
  source?: JudgeInterruptSource
}

export interface AgentScoreEntry {
  agent_id: string
  agent_name: string
  agent_color: string
  relevance: number | null
  should_ask: boolean | null
  on_cooldown: boolean
}

export interface MissedQuestionEntry {
  agent_id: string
  agent_name: string
  agent_color: string
  question: string
  relevance: number
  reason: 'not_selected' | 'duplicate'
  timestamp: string
}

export interface MultiAgentSocketConfig {
  enabled: boolean
  strategy?: 'round_robin'
  max_agents_per_pass?: number
  agents?: MultiAgentProfile[]
}

export interface WebSocketSessionConfig {
  proceedingType: 'appellate' | 'demo'
  userRole: 'attorney' | 'self-represented'
  judgePersonality?: string
  interruptionFrequency?: string
  seed_questions?: unknown[]
  brief_summary?: string
  synthesis_prompt?: string
  multi_agent?: MultiAgentSocketConfig
}
