/**
 * Agent Editor Component
 * 
 * Allows editing agent JSON with Update, Reset, Write, and Undo functionality.
 * Uses modular sub-components for each piece of functionality.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Agent } from '../types';
import { Button, Card, CardHeader, CardContent } from './ui';
import { AgentSelector, EditorActions, JsonEditor, NewAgentForm } from './features';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const LOCAL_STORAGE_KEY = 'multi-agent-local-edits';

interface AgentEditorProps {
  agents: Agent[];
  onAgentsChange: (agents: Agent[]) => void;
}

interface LocalEdits {
  [agentId: string]: Agent;
}

interface VersionHistory {
  [agentId: string]: Agent[];
}

export function AgentEditor({ agents, onAgentsChange }: AgentEditorProps) {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [editedJson, setEditedJson] = useState<string>('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [localEdits, setLocalEdits] = useState<LocalEdits>({});
  const [versionHistory, setVersionHistory] = useState<VersionHistory>({});
  const [isLoading, setIsLoading] = useState(false);
  const [showNewAgentForm, setShowNewAgentForm] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (stored) {
      try {
        setLocalEdits(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse local edits:', e);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(localEdits));
  }, [localEdits]);

  useEffect(() => {
    if (!selectedAgentId) return;
    const agent = localEdits[selectedAgentId] || agents.find(a => a.id === selectedAgentId);
    if (agent) {
      setEditedJson(JSON.stringify(agent, null, 2));
      setJsonError(null);
    }
  }, [selectedAgentId, agents, localEdits]);

  const getEffectiveAgent = useCallback((agentId: string): Agent | undefined => {
    return localEdits[agentId] || agents.find(a => a.id === agentId);
  }, [localEdits, agents]);

  const handleSelectAgent = useCallback((agentId: string) => {
    setSelectedAgentId(agentId);
  }, []);

  const handleJsonChange = useCallback((value: string) => {
    setEditedJson(value);
    try {
      JSON.parse(value);
      setJsonError(null);
    } catch (e) {
      setJsonError('Invalid JSON syntax');
    }
  }, []);

  const handleUpdate = useCallback(() => {
    if (!selectedAgentId || jsonError) return;

    try {
      const updatedAgent = JSON.parse(editedJson) as Agent;
      
      const currentAgent = getEffectiveAgent(selectedAgentId);
      if (currentAgent) {
        setVersionHistory(prev => ({
          ...prev,
          [selectedAgentId]: [...(prev[selectedAgentId] || []), currentAgent]
        }));
      }

      setLocalEdits(prev => ({
        ...prev,
        [selectedAgentId]: updatedAgent
      }));

      const newAgents = agents.map(a => 
        a.id === selectedAgentId ? updatedAgent : a
      );
      onAgentsChange(newAgents);

    } catch (e) {
      setJsonError('Failed to parse JSON');
    }
  }, [selectedAgentId, editedJson, jsonError, agents, onAgentsChange, getEffectiveAgent]);

  const handleReset = useCallback(async () => {
    if (!selectedAgentId) return;

    setIsLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/multi-agent/agents/${selectedAgentId}/reset`);
      if (!response.ok) throw new Error('Failed to fetch original');
      
      const data = await response.json();
      const originalAgent = data.agent as Agent;

      const currentAgent = getEffectiveAgent(selectedAgentId);
      if (currentAgent) {
        setVersionHistory(prev => ({
          ...prev,
          [selectedAgentId]: [...(prev[selectedAgentId] || []), currentAgent]
        }));
      }

      setLocalEdits(prev => {
        const newEdits = { ...prev };
        delete newEdits[selectedAgentId];
        return newEdits;
      });

      setEditedJson(JSON.stringify(originalAgent, null, 2));

      const newAgents = agents.map(a => 
        a.id === selectedAgentId ? originalAgent : a
      );
      onAgentsChange(newAgents);

    } catch (e) {
      console.error('Failed to reset agent:', e);
      setJsonError('Failed to reset to original');
    } finally {
      setIsLoading(false);
    }
  }, [selectedAgentId, agents, onAgentsChange, getEffectiveAgent]);

  const handleWrite = useCallback(async () => {
    if (!selectedAgentId || jsonError) return;

    setIsLoading(true);
    try {
      const agentData = JSON.parse(editedJson) as Agent;
      
      const response = await fetch(`${API_URL}/api/multi-agent/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agentData),
      });

      if (!response.ok) throw new Error('Failed to save');
      
      const data = await response.json();
      const savedAgent = data.agent as Agent;

      setLocalEdits(prev => ({
        ...prev,
        [selectedAgentId]: savedAgent
      }));

      setEditedJson(JSON.stringify(savedAgent, null, 2));

      const newAgents = agents.map(a => 
        a.id === selectedAgentId ? savedAgent : a
      );
      onAgentsChange(newAgents);

    } catch (e) {
      console.error('Failed to write agent:', e);
      setJsonError('Failed to save to server');
    } finally {
      setIsLoading(false);
    }
  }, [selectedAgentId, editedJson, jsonError, agents, onAgentsChange]);

  const handleUndo = useCallback(() => {
    if (!selectedAgentId) return;

    const history = versionHistory[selectedAgentId];
    if (!history || history.length === 0) return;

    const previousVersion = history[history.length - 1];
    setVersionHistory(prev => ({
      ...prev,
      [selectedAgentId]: history.slice(0, -1)
    }));

    setLocalEdits(prev => ({
      ...prev,
      [selectedAgentId]: previousVersion
    }));

    setEditedJson(JSON.stringify(previousVersion, null, 2));

    const newAgents = agents.map(a => 
      a.id === selectedAgentId ? previousVersion : a
    );
    onAgentsChange(newAgents);
  }, [selectedAgentId, versionHistory, agents, onAgentsChange]);

  const handleCreateAgent = useCallback(async (agentData: Partial<Agent>) => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/multi-agent/agents/new`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: agentData.name || 'New Agent',
          color: agentData.color || '#6B7280',
          description: agentData.description || '',
          triggers: agentData.triggers || [],
          example_questions: agentData.example_questions || [],
          extra_prompt: agentData.extra_prompt || '',
        }),
      });

      if (!response.ok) throw new Error('Failed to create agent');
      
      const data = await response.json();
      const newAgent = data.agent as Agent;

      onAgentsChange([...agents, newAgent]);
      setShowNewAgentForm(false);
      
      setSelectedAgentId(newAgent.id);
      setEditedJson(JSON.stringify(newAgent, null, 2));
      setJsonError(null);

    } catch (e) {
      console.error('Failed to create agent:', e);
    } finally {
      setIsLoading(false);
    }
  }, [agents, onAgentsChange]);

  const handleDelete = useCallback(async () => {
    if (!selectedAgentId) return;

    const confirmDelete = window.confirm(
      `Are you sure you want to delete this agent? This cannot be undone.`
    );
    if (!confirmDelete) return;

    setIsLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/multi-agent/agents/${selectedAgentId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to delete agent');
      }

      // Remove from local state
      setLocalEdits(prev => {
        const newEdits = { ...prev };
        delete newEdits[selectedAgentId];
        return newEdits;
      });
      setVersionHistory(prev => {
        const newHistory = { ...prev };
        delete newHistory[selectedAgentId];
        return newHistory;
      });

      // Remove from agents list
      const newAgents = agents.filter(a => a.id !== selectedAgentId);
      onAgentsChange(newAgents);

      // Clear selection
      setSelectedAgentId(null);
      setEditedJson('');
      setJsonError(null);

    } catch (e) {
      console.error('Failed to delete agent:', e);
      setJsonError(e instanceof Error ? e.message : 'Failed to delete agent');
    } finally {
      setIsLoading(false);
    }
  }, [selectedAgentId, agents, onAgentsChange]);


  const selectedAgent = selectedAgentId ? getEffectiveAgent(selectedAgentId) : null;
  const canUndo = selectedAgentId && (versionHistory[selectedAgentId]?.length || 0) > 0;
  const hasLocalEdits = selectedAgentId && !!localEdits[selectedAgentId];
  const canDelete = selectedAgent?.is_custom === true;

  return (
    <Card>
      <CardHeader
        action={
          <Button variant="success" size="sm" onClick={() => setShowNewAgentForm(true)}>
            + New Agent
          </Button>
        }
      >
        Agent Configuration
      </CardHeader>

      <CardContent>
        <AgentSelector
          agents={agents}
          selectedAgentId={selectedAgentId}
          localEdits={localEdits}
          onSelect={handleSelectAgent}
        />

        {showNewAgentForm && (
          <NewAgentForm 
            onSubmit={handleCreateAgent}
            onCancel={() => setShowNewAgentForm(false)}
            isLoading={isLoading}
          />
        )}

        {selectedAgent && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
            <EditorActions
              onUpdate={handleUpdate}
              onReset={handleReset}
              onWrite={handleWrite}
              onUndo={handleUndo}
              onDelete={handleDelete}
              canUpdate={!jsonError}
              canUndo={!!canUndo}
              canDelete={!!canDelete}
              hasLocalEdits={!!hasLocalEdits}
              isLoading={isLoading}
            />

            <JsonEditor
              value={editedJson}
              onChange={handleJsonChange}
              error={jsonError}
            />
          </div>
        )}

        {!selectedAgent && !showNewAgentForm && (
          <p className="ma-section__placeholder">
            Select an agent above to edit its configuration
          </p>
        )}
      </CardContent>
    </Card>
  );
}
