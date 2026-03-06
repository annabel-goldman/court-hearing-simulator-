/**
 * Recording Controls Component
 * 
 * Start/stop recording buttons with status indicator
 * 
 * Styles: styles/recording.css
 */

import { Button } from '../ui';
import type { SimulationPhase } from '../../types';
import '../../styles/recording.css';

interface RecordingControlsProps {
  phase: SimulationPhase;
  hasAgents: boolean;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
}

export function RecordingControls({
  phase,
  hasAgents,
  onStart,
  onStop,
  onReset,
}: RecordingControlsProps) {
  return (
    <div className="ma-recording-controls">
      {phase === 'READY' && (
        <Button
          variant="success"
          size="lg"
          onClick={onStart}
          disabled={!hasAgents}
        >
          Start Recording
        </Button>
      )}

      {phase === 'RECORDING' && (
        <Button
          variant="danger"
          size="lg"
          onClick={onStop}
        >
          Stop Recording
        </Button>
      )}

      {phase === 'FINISHED' && (
        <Button
          variant="primary"
          size="lg"
          onClick={onReset}
        >
          Start New Session
        </Button>
      )}
    </div>
  );
}
