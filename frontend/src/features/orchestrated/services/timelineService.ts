import { apiFetch } from '../../../api/client'

interface ProjectedTimelinePayload {
  appellant_brief: string
  appellee_brief: string
}

export async function requestProjectedTimelineStream(
  payload: ProjectedTimelinePayload
): Promise<Response> {
  return apiFetch('/api/projected-timeline/generate-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}
