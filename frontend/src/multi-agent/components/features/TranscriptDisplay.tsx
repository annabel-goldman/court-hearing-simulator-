/**
 * Transcript Display Component
 * 
 * Shows the live transcript as the user speaks
 * 
 * Styles: styles/transcript.css
 */

import '../../styles/transcript.css';

interface TranscriptDisplayProps {
  transcript: string;
  placeholder?: string;
}

export function TranscriptDisplay({ 
  transcript, 
  placeholder = "Start recording to see your transcript appear here in real-time..." 
}: TranscriptDisplayProps) {
  return (
    <div className="ma-transcript">
      <h3 className="ma-transcript__title">Your Transcript</h3>
      <div className="ma-transcript__content">
        {transcript ? (
          <p className="ma-transcript__text">{transcript}</p>
        ) : (
          <p className="ma-transcript__text ma-transcript__placeholder">{placeholder}</p>
        )}
      </div>
    </div>
  );
}
