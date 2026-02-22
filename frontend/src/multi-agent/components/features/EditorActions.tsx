/**
 * Editor Actions Component
 * 
 * Action buttons for the agent editor: Update, Reset, Write, Undo
 * 
 * Styles: styles/editor-actions.css
 */

import { Button } from '../ui';
import '../../styles/editor-actions.css';

interface EditorActionsProps {
  onUpdate: () => void;
  onReset: () => void;
  onWrite: () => void;
  onUndo: () => void;
  canUpdate: boolean;
  canUndo: boolean;
  hasLocalEdits: boolean;
  isLoading: boolean;
}

export function EditorActions({
  onUpdate,
  onReset,
  onWrite,
  onUndo,
  canUpdate,
  canUndo,
  hasLocalEdits,
  isLoading,
}: EditorActionsProps) {
  return (
    <div className="ma-editor-actions">
      <Button
        variant="primary"
        onClick={onUpdate}
        disabled={!canUpdate || isLoading}
        title="Save changes locally"
      >
        Update
      </Button>
      
      <Button
        variant="warning"
        onClick={onReset}
        disabled={isLoading}
        title="Reset to original server version"
      >
        Reset
      </Button>
      
      <Button
        variant="success"
        onClick={onWrite}
        disabled={!canUpdate || isLoading}
        title="Save as new version on server"
      >
        Write
      </Button>
      
      <Button
        variant="secondary"
        onClick={onUndo}
        disabled={!canUndo || isLoading}
        title="Undo to previous version"
      >
        Undo
      </Button>
      
      {hasLocalEdits && (
        <span className="ma-editor-actions__unsaved">(unsaved changes)</span>
      )}
    </div>
  );
}
