export type QuestionSourceType = 'judge_engine' | 'multi_agent'
export type MissedQuestionReason = 'not_selected' | 'duplicate'

export interface SessionQuestionRecord {
  id: string
  question: string
  timestamp: string
  sourceType: QuestionSourceType
  agentId?: string
  agentName: string
  agentColor?: string
}

export interface MissedQuestionRecord {
  id: string
  question: string
  timestamp: string
  agentId: string
  agentName: string
  agentColor?: string
  relevance: number
  reason: MissedQuestionReason
}

export interface SessionTranscriptRecord {
  text: string
  timestamp: string
}

export interface SessionAuditPayload {
  sessionId: string
  startedAt: string
  endedAt: string
  durationSeconds: number
  proceedingType: 'demo'
  userRole: 'attorney'
  useMultiAgentJudge: boolean
  questions: SessionQuestionRecord[]
  missedQuestions: MissedQuestionRecord[]
  transcriptSegments: SessionTranscriptRecord[]
}
