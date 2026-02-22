/**
 * Editor Actions Component
 * 
 * Action buttons for the agent editor: Update, Reset, Write, Undo, Delete
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
  onDelete?: () => void;
  canUpdate: boolean;
  canUndo: boolean;
  canDelete: boolean;
  hasLocalEdits: boolean;
  isLoading: boolean;
}

export function EditorActions({
  onUpdate,
  onReset,
  onWrite,
  onUndo,
  onDelete,
  canUpdate,
  canUndo,
  canDelete,
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

      {canDelete && onDelete && (
        <Button
          variant="danger"
          onClick={onDelete}
          disabled={isLoading}
          title="Delete this custom agent permanently"
        >
          Delete
        </Button>
      )}
      
      {hasLocalEdits && (
        <span className="ma-editor-actions__unsaved">(unsaved changes)</span>
      )}
    </div>
  );
}
