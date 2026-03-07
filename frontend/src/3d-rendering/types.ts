/**
 * Shared types for 3D courtroom rendering
 */

export type SpeakingRole = 'judge' | 'counsel' | null
export type JudgeAvatarDifficulty = 'easy' | 'medium' | 'hard'

// Simulation State Machine
export type SimulationPhase = 
  | 'OFF_RECORD'      // Before court starts
  | 'ALL_RISE'        // Bailiff announces "All rise"
  | 'JUDGE_ENTERING'  // Judge is walking to bench
  | 'JUDGE_SEATED'    // Judge is seated, user prompted to sit
  | 'PROCEEDING'      // Active court session
  | 'ADJOURNED'       // Court has ended

/** Agenda item for orchestrated agents (from projected-timeline API) */
export interface SessionAgendaItem {
  id: string
  lens: string
  rationale: string
  topics: Array<{ order?: number; title: string; description?: string; target?: string }>
  agentId: string | null
}

export interface SessionConfig {
  proceedingType: 'demo'
  userRole: 'attorney'
  materials: Array<{ name: string; text: string; role: string }>
  judicialSummary?: string
  useMultiAgentJudge?: boolean
  sessionDurationSeconds?: number
  judgeAvatarDifficulty?: JudgeAvatarDifficulty
  userPartyRole?: 'appellant' | 'respondent'
  judgeDisposition?: {
    interruptionLevel?: string
    questionTypes?: string[]
  }
  /** Orchestrated agents: raw predictions from projected-timeline generate-stream */
  predictedTopicSets?: unknown
  /** Orchestrated agents: agenda items derived from predictions */
  agendaItems?: SessionAgendaItem[]
}

// Viseme mapping for Ready Player Me avatars
export const VISEME_MAP: Record<string, string> = {
  'aa': 'viseme_aa',
  'E': 'viseme_E', 
  'I': 'viseme_I',
  'O': 'viseme_O',
  'U': 'viseme_U',
  'CH': 'viseme_CH',
  'DD': 'viseme_DD',
  'FF': 'viseme_FF',
  'kk': 'viseme_kk',
  'nn': 'viseme_nn',
  'PP': 'viseme_PP',
  'RR': 'viseme_RR',
  'sil': 'viseme_sil',
  'SS': 'viseme_SS',
  'TH': 'viseme_TH',
}
