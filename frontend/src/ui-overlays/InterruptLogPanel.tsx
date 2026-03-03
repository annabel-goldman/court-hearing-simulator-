/**
 * InterruptLogPanel
 *
 * Live feed of judicial questions fired during the session, merged with
 * questions agents wanted to ask but didn't get to (shown grayed out).
 */

import { useEffect, useRef } from 'react'
import type { SessionQuestionRecord, MissedQuestionRecord } from '../types/sessionAudit'

const MAX_SHOWN = 8

interface InterruptLogPanelProps {
  questions: SessionQuestionRecord[]
  missedQuestions: MissedQuestionRecord[]
  isVisible: boolean
}

type LogEntry =
  | { kind: 'asked'; record: SessionQuestionRecord }
  | { kind: 'missed'; record: MissedQuestionRecord }

export function InterruptLogPanel({ questions, missedQuestions, isVisible }: InterruptLogPanelProps) {
  const listRef = useRef<HTMLDivElement>(null)

  const combined: LogEntry[] = [
    ...questions.map(r => ({ kind: 'asked' as const, record: r })),
    ...missedQuestions.map(r => ({ kind: 'missed' as const, record: r })),
  ].sort((a, b) => a.record.timestamp.localeCompare(b.record.timestamp))

  const recent = combined.slice(-MAX_SHOWN)

  // Scroll to bottom whenever the list changes
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [combined.length])

  if (!isVisible) return null

  return (
    <div className="interrupt-log-panel">
      <div className="interrupt-log-header">
        <span className="interrupt-log-title">Questions from Bench</span>
        <div className="interrupt-log-counts">
          <span className="interrupt-log-count">{questions.length} asked</span>
          {missedQuestions.length > 0 && (
            <span className="interrupt-log-count-missed">{missedQuestions.length} unasked</span>
          )}
        </div>
      </div>

      {recent.length === 0 ? (
        <p className="interrupt-log-empty">Waiting for first question…</p>
      ) : (
        <div className="interrupt-log-list" ref={listRef}>
          {recent.map((entry) => {
            if (entry.kind === 'asked') {
              const record = entry.record
              const color = record.agentColor || 'var(--primary)'
              return (
                <div key={record.id} className="interrupt-log-entry">
                  <span
                    className="interrupt-log-agent-dot"
                    style={{ background: color }}
                    aria-hidden
                  />
                  <div className="interrupt-log-entry-body">
                    <div className="interrupt-log-entry-meta">
                      <span className="interrupt-log-agent-name" style={{ color }}>
                        {record.agentName}
                      </span>
                    </div>
                    <p className="interrupt-log-question">
                      {record.question.length > 90
                        ? record.question.slice(0, 90) + '…'
                        : record.question}
                    </p>
                  </div>
                </div>
              )
            } else {
              const record = entry.record
              const reasonLabel = record.reason === 'duplicate' ? 'duplicate' : 'not selected'
              return (
                <div key={record.id} className="interrupt-log-entry interrupt-log-entry--missed">
                  <span
                    className="interrupt-log-agent-dot interrupt-log-agent-dot--missed"
                    aria-hidden
                  />
                  <div className="interrupt-log-entry-body">
                    <div className="interrupt-log-entry-meta">
                      <span className="interrupt-log-agent-name interrupt-log-agent-name--missed">
                        {record.agentName}
                      </span>
                      <span className="interrupt-log-missed-badge">{reasonLabel}</span>
                    </div>
                    <p className="interrupt-log-question interrupt-log-question--missed">
                      {record.question.length > 90
                        ? record.question.slice(0, 90) + '…'
                        : record.question}
                    </p>
                  </div>
                </div>
              )
            }
          })}
        </div>
      )}
    </div>
  )
}
