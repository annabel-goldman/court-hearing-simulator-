import { useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import './SessionAuditPage.css'
import type { SessionAuditPayload } from '../types/sessionAudit'

const SESSION_AUDIT_STORAGE_KEY = 'courtSessionAudit'

interface SessionAuditLocationState {
  audit?: SessionAuditPayload
}

function estimateTranscriptWordCount(transcriptSegments: SessionAuditPayload['transcriptSegments']): number {
  return transcriptSegments.reduce((total, segment) => {
    const words = segment.text.trim().split(/\s+/).filter(Boolean).length
    return total + words
  }, 0)
}

function buildPerformanceSummary(audit: SessionAuditPayload): string {
  const totalQuestions = audit.questions.length
  const uniqueAskers = new Set(
    audit.questions.map(q => (q.sourceType === 'multi_agent' ? q.agentName : 'Judge Engine'))
  ).size
  const wordCount = estimateTranscriptWordCount(audit.transcriptSegments)

  if (totalQuestions === 0) {
    return 'Performance note: no bench questions were captured this round. Extend your argument depth to prompt more judicial engagement.'
  }

  if (totalQuestions >= 8 && uniqueAskers >= 2 && wordCount >= 350) {
    return 'Performance note: strong session. You sustained detailed answers across multiple questioners and kept the argument developed on the record.'
  }

  if (totalQuestions >= 4 && wordCount >= 180) {
    return 'Performance note: solid foundation. You engaged with the court, but can improve by tightening answer structure and adding clearer legal anchors.'
  }

  return 'Performance note: developing. Focus on concise direct answers, then quickly connect each answer back to your core theory of the case.'
}

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
  const performanceSummary = useMemo(
    () => (auditData ? buildPerformanceSummary(auditData) : ''),
    [auditData]
  )

  useEffect(() => {
    if (!auditData) {
      navigate('/', { replace: true })
    }
  }, [auditData, navigate])

  if (!auditData) {
    return null
  }

  return (
    <div className="session-audit-page">
      <div className="session-audit-shell">
        <header className="session-audit-header">
          <p className="session-audit-kicker">Session Closed</p>
          <h1 className="session-audit-title">Court Adjourned</h1>
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
          <p className="session-audit-performance">{performanceSummary}</p>
        </section>
      </div>
    </div>
  )
}
