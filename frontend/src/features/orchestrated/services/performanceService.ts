import { apiPostJson } from '../../../api/client'
import type { SessionAuditPayload, PerformanceNotesResponse } from '../../../types/sessionAudit'

export async function fetchPerformanceNotes(
  audit: SessionAuditPayload,
): Promise<PerformanceNotesResponse> {
  return apiPostJson<PerformanceNotesResponse, SessionAuditPayload>(
    '/api/performance-notes',
    audit,
  )
}
