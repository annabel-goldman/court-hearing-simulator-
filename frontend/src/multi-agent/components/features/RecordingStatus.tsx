/**
 * Recording Status Component
 * 
 * Shows recording indicator and phase status
 * 
 * Styles: styles/recording.css
 */

import type { SimulationPhase } from '../../types';
import '../../styles/recording.css';

interface RecordingStatusProps {
  phase: SimulationPhase;
}

export function RecordingStatus({ phase }: RecordingStatusProps) {
  if (phase !== 'RECORDING') return null;
  
  return (
    <div className="ma-recording-status">
      <span className="ma-recording-status__dot" />
      <span className="ma-recording-status__text">Recording...</span>
    </div>
  );
}
