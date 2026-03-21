/**
 * InterruptLogPanel
 *
 * Live feed of judicial questions fired during the session.
 */

import { useEffect, useRef } from 'react'
import type { SessionQuestionRecord } from '../types/sessionAudit'

const MAX_SHOWN = 8

interface InterruptLogPanelProps {
  questions: SessionQuestionRecord[]
  isVisible: boolean
}

export function InterruptLogPanel({ questions, isVisible }: InterruptLogPanelProps) {
  const listRef = useRef<HTMLDivElement>(null)

  const recent = questions.slice(-MAX_SHOWN)

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [questions.length])

  if (!isVisible) return null

  return (
    <div className="interrupt-log-panel">
      <div className="interrupt-log-header">
        <span className="interrupt-log-title">Questions from Bench</span>
        <div className="interrupt-log-counts">
          <span className="interrupt-log-count">{questions.length} asked</span>
        </div>
      </div>

      {recent.length === 0 ? (
        <p className="interrupt-log-empty">Waiting for first question…</p>
      ) : (
        <div className="interrupt-log-list" ref={listRef}>
          {recent.map((record) => {
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
          })}
        </div>
      )}
    </div>
  )
}
