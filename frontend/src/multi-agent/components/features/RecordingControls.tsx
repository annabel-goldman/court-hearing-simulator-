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
  /** Optional labels for orchestrated/hearing context */
  startLabel?: string;
  stopLabel?: string;
  resetLabel?: string;
}

export function RecordingControls({
  phase,
  hasAgents,
  onStart,
  onStop,
  onReset,
  startLabel = 'Start Recording',
  stopLabel = 'Stop Recording',
  resetLabel = 'Start New Session',
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
          {startLabel}
        </Button>
      )}

      {phase === 'RECORDING' && (
        <Button
          variant="danger"
          size="lg"
          onClick={onStop}
        >
          {stopLabel}
        </Button>
      )}

      {phase === 'FINISHED' && (
        <Button
          variant="primary"
          size="lg"
          onClick={onReset}
        >
          {resetLabel}
        </Button>
      )}
    </div>
  );
}
