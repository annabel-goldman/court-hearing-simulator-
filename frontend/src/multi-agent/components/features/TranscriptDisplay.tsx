/**
 * Transcript Display Component
 *
 * Chat-bubble transcript that converts plain speech into conversation
 * bubbles when judges or opposing counsel interrupt.
 *
 * Styles: styles/transcript.css
 */

import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../types';
import '../../styles/transcript.css';

interface TranscriptDisplayProps {
  transcript: string;
  chatMessages?: ChatMessage[];
  placeholder?: string;
}

export function TranscriptDisplay({
  transcript,
  chatMessages = [],
  placeholder = "Start recording to see your transcript appear here in real-time..."
}: TranscriptDisplayProps) {
  const [showHistory, setShowHistory] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [transcript, chatMessages.length, showHistory]);

  const hasMessages = chatMessages.length > 0;
  const hasLiveSpeech = transcript.trim().length > 0;
  const isEmpty = !hasMessages && !hasLiveSpeech;

  return (
    <div className="ma-transcript">
      <div className="ma-transcript__header">
        <h3 className="ma-transcript__title">Your Transcript</h3>
        {hasMessages && (
          <button
            className="ma-transcript__toggle"
            onClick={() => setShowHistory(h => !h)}
          >
            {showHistory ? 'Hide history' : `See previous statements (${chatMessages.length})`}
          </button>
        )}
      </div>
      <div className="ma-transcript__content" ref={contentRef}>
        {isEmpty && (
          <p className="ma-transcript__placeholder">{placeholder}</p>
        )}

        {showHistory && (
          <>
            {chatMessages.map(msg => (
              <div key={msg.id} className={`ma-transcript__bubble ma-transcript__bubble--${msg.role}`}>
                {msg.role !== 'user' && (
                  <span
                    className="ma-transcript__bubble-sender"
                    style={msg.agentColor ? { color: msg.agentColor } : undefined}
                  >
                    {msg.agentName || (msg.role === 'judge' ? 'Judge' : 'Opposing Counsel')}
                  </span>
                )}
                <p className="ma-transcript__bubble-text">{msg.text}</p>
              </div>
            ))}
            {hasLiveSpeech && (
              <div className="ma-transcript__divider">
                <span className="ma-transcript__divider-text">now</span>
              </div>
            )}
          </>
        )}

        {hasLiveSpeech && (
          <div className="ma-transcript__bubble ma-transcript__bubble--user ma-transcript__bubble--live">
            <p className="ma-transcript__bubble-text">{transcript}</p>
          </div>
        )}
      </div>
    </div>
  );
}
