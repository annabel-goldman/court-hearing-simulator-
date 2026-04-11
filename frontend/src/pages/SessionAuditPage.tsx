import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import './SessionAuditPage.css'
import type { SessionAuditPayload, PerformanceNotesResponse } from '../types/sessionAudit'
import { fetchPerformanceNotes } from '../features/orchestrated/services/performanceService'

const SESSION_AUDIT_STORAGE_KEY = 'courtSessionAudit'

interface SessionAuditLocationState {
  audit?: SessionAuditPayload
}

const DIMENSION_LABELS: { key: keyof PerformanceNotesResponse['dimensions']; label: string }[] = [
  { key: 'directness',                    label: 'Directness' },
  { key: 'legal_anchoring',               label: 'Legal Anchoring' },
  { key: 'responsiveness_under_pressure', label: 'Responsiveness Under Pressure' },
  { key: 'argument_development',          label: 'Argument Development' },
  { key: 'bench_engagement',              label: 'Bench Engagement' },
]

function loadStoredAudit(): SessionAuditPayload | null {
  const raw = sessionStorage.getItem(SESSION_AUDIT_STORAGE_KEY)
  if (!raw) return null

  try {
    return JSON.parse(raw) as SessionAuditPayload
  } catch {
    return null
  }
}

export default function SessionAuditPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as SessionAuditLocationState | null

  const auditData = useMemo(() => state?.audit ?? loadStoredAudit(), [state])

  const [notes, setNotes] = useState<PerformanceNotesResponse | null>(null)
  const [notesLoading, setNotesLoading] = useState(false)
  const [notesError, setNotesError] = useState<string | null>(null)

  useEffect(() => {
    if (!auditData) {
      navigate('/', { replace: true })
    }
  }, [auditData, navigate])

  useEffect(() => {
    if (!auditData) return
    let cancelled = false

    setNotesLoading(true)
    setNotesError(null)

    fetchPerformanceNotes(auditData)
      .then((result) => {
        if (!cancelled) setNotes(result)
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setNotesError(err instanceof Error ? err.message : 'Failed to load performance notes.')
      })
      .finally(() => {
        if (!cancelled) setNotesLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [auditData])

  const handlePlayAgain = () => {
    sessionStorage.removeItem('courtSessionAudit')
    sessionStorage.removeItem('courtSession')
    navigate('/', { replace: true })
  }

  if (!auditData) {
    return null
  }

  return (
    <div className="session-audit-page">
      <div className="session-audit-shell">
        <header className="session-audit-header">
          <div className="session-audit-header-row">
            <h1 className="session-audit-title">Court Adjourned</h1>
            <button type="button" className="session-audit-play-again-btn" onClick={handlePlayAgain}>
              Play Again
            </button>
          </div>
        </header>

        <section className="session-audit-section">
          <h2 className="session-audit-section-title">Questions Asked</h2>
          {auditData.questions.length === 0 ? (
            <p className="session-audit-empty">No questions were captured in this session.</p>
          ) : (
            <div className="session-audit-question-list">
              {auditData.questions.map((record, index) => (
                <article className="session-audit-question" key={record.id}>
                  <div className="session-audit-question__meta">
                    <span className="session-audit-question__index">Q{index + 1}</span>
                    <span
                      className="session-audit-question__agent"
                      style={{
                        borderColor: record.agentColor || '#8390aa',
                        color: record.agentColor || '#e7ebf4',
                      }}
                    >
                      {record.agentName}
                    </span>
                  </div>
                  <p className="session-audit-question__text">{record.question}</p>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="session-audit-section">
          <h2 className="session-audit-section-title">Your Performance</h2>

          {notesLoading && (
            <p className="session-audit-performance session-audit-performance--loading">
              Generating performance notes…
            </p>
          )}

          {notesError && !notesLoading && (
            <p className="session-audit-performance session-audit-performance--error">
              {notesError}
            </p>
          )}

          {notes && !notesLoading && (
            <>
              <div className="session-audit-scorecard">
                {DIMENSION_LABELS.map(({ key, label }) => {
                  const dim = notes.dimensions[key]
                  return (
                    <article key={key} className="session-audit-scorecard__row">
                      <div className="session-audit-scorecard__header">
                        <span className="session-audit-scorecard__label">{label}</span>
                        <span className="session-audit-scorecard__score">{dim.score}/10</span>
                      </div>
                      <div
                        className="session-audit-scorecard__bar"
                        role="meter"
                        aria-valuenow={dim.score}
                        aria-valuemin={1}
                        aria-valuemax={10}
                      >
                        <div
                          className="session-audit-scorecard__bar-fill"
                          style={{ width: `${dim.score * 10}%` }}
                        />
                      </div>
                      <p className="session-audit-scorecard__note">{dim.note}</p>
                    </article>
                  )
                })}
              </div>
              <p className="session-audit-performance session-audit-performance--overall">
                {notes.overall_note}
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
