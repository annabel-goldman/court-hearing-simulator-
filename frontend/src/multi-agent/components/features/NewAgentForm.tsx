/**
 * New Agent Form Component
 * 
 * Form for creating a new agent with basic details
 * 
 * Styles: styles/new-agent-form.css
 */

import { useState } from 'react';
import { Button, Input, ColorPicker } from '../ui';
import type { Agent } from '../../types';
import '../../styles/new-agent-form.css';

interface NewAgentFormProps {
  onSubmit: (data: Partial<Agent>) => void;
  onCancel: () => void;
  isLoading: boolean;
}

export function NewAgentForm({ onSubmit, onCancel, isLoading }: NewAgentFormProps) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#6B7280');
  const [description, setDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      color,
      description,
      triggers: [],
      example_questions: [],
      extra_prompt: '',
    });
  };

  return (
    <form onSubmit={handleSubmit} className="ma-new-agent-form">
      <h3 className="ma-new-agent-form__title">Create New Agent</h3>
      
      <Input
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        placeholder="e.g., Skeptical Judge"
      />
      
      <ColorPicker
        label="Color"
        value={color}
        onChange={setColor}
      />
      
      <div>
        <label className="ma-input__label">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="ma-textarea"
          rows={3}
          placeholder="Describe this agent's personality and role..."
        />
      </div>

      <div className="ma-new-agent-form__actions">
        <Button
          type="submit"
          variant="success"
          disabled={!name}
          isLoading={isLoading}
        >
          Create
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
