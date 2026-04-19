import type { SessionAgendaItem } from '../3d-rendering/types'

interface RawPrediction {
  prediction_id: number
  lens: string
  rationale: string
  topics: Array<{ title: string; description?: string }>
}

export interface RawDonePayload {
  case_summary?: string
  predictions?: RawPrediction[]
  [key: string]: unknown
}

export function buildAgendaItemsFromPredictions(
  rawDone: RawDonePayload,
): SessionAgendaItem[] {
  const predictions = (rawDone.predictions ?? []).filter(
    (p) => (p.topics?.length ?? 0) > 0 && p.rationale !== 'Parse error.',
  )

  return predictions.map((p) => ({
    id: String(p.prediction_id),
    lens: p.lens,
    rationale: p.rationale,
    topics: p.topics.map((t, i) => ({
      order: i,
      title: t.title,
      description: t.description ?? '',
    })),
    agentId: null,
  }))
}
