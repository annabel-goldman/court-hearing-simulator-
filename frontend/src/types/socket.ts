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
