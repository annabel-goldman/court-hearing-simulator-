/**
 * Transcript Display Component
 *
 * Shows previous speech segments (frozen when judge/opponent interrupts) and
 * the live transcript of the current segment.
 *
 * Styles: styles/transcript.css
 */

import '../../styles/transcript.css';
import type { ChatMessage } from '../../types';

interface TranscriptDisplayProps {
  transcript: string;
  chatMessages?: ChatMessage[];
  placeholder?: string;
}

export function TranscriptDisplay({
  transcript,
  chatMessages = [],
  placeholder = 'Start recording to see your transcript appear here in real-time…',
}: TranscriptDisplayProps) {
  const hasContent = chatMessages.length > 0 || transcript.trim().length > 0;

  return (
    <div className="ma-transcript">
      <h3 className="ma-transcript__title">Your Transcript</h3>
      <div className="ma-transcript__content">
        {hasContent ? (
          <>
            {chatMessages.map((msg) => (
              <p key={msg.id} className="ma-transcript__segment">
                {msg.text}
              </p>
            ))}
            {transcript.trim() && (
              <p className="ma-transcript__text ma-transcript__current">{transcript}</p>
            )}
          </>
        ) : (
          <p className="ma-transcript__text ma-transcript__placeholder">{placeholder}</p>
        )}
      </div>
    </div>
  );
}
