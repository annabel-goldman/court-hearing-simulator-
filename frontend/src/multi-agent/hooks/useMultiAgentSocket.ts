/**
 * WebSocket hook for multi-agent simulation
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Agent, AgentQuestion, SimulationPhase, MultiAgentSocketMessage } from '../types';

// Get base WS URL and remove trailing /ws if present (for consistency with main project)
const WS_BASE = (import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws').replace(/\/ws\/?$/, '');

interface UseMultiAgentSocketProps {
  sessionId: string;
  onTranscriptUpdate?: (text: string) => void;
  onAgentQuestion?: (question: AgentQuestion) => void;
  onPhaseUpdate?: (phase: SimulationPhase) => void;
  onAgendaUpdate?: (data: unknown) => void;
  onArgumentScore?: (data: unknown) => void;
  onOpponentResponse?: (data: unknown) => void;
}

const CONNECT_TIMEOUT_MS = 10_000;

interface UseMultiAgentSocketReturn {
  isConnected: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  sendConfig: (agents: Agent[], briefSummary: string, opposingBrief?: string) => void;
  sendAgenda: (predictedTopicSets: unknown, agendaItems: unknown[]) => void;
  sendAudio: (audioBase64: string) => void;
  setPhase: (phase: SimulationPhase) => void;
  updateAgents: (agents: Agent[]) => void;
}

export function useMultiAgentSocket({
  sessionId,
  onTranscriptUpdate,
  onAgentQuestion,
  onPhaseUpdate,
  onAgendaUpdate,
  onArgumentScore,
  onOpponentResponse,
}: UseMultiAgentSocketProps): UseMultiAgentSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const connect = useCallback((): Promise<void> => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(`${WS_BASE}/ws/multi-agent/${sessionId}`);
      const timeout = setTimeout(() => {
        if (!settled && ws.readyState !== WebSocket.OPEN) {
          settled = true;
          ws.close();
          reject(new Error('WebSocket connection timed out'));
        }
      }, CONNECT_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(timeout);
        ws.onopen = null;
        ws.onclose = null;
        ws.onerror = null;
      };

      ws.onopen = () => {
        if (settled) return;
        settled = true;
        cleanup();
        console.log('[MultiAgentSocket] Connected');
        setIsConnected(true);
        resolve();
      };

      ws.onclose = () => {
        cleanup();
        if (wsRef.current === ws) {
          wsRef.current = null;
          setIsConnected(false);
        }
        if (!settled) {
          settled = true;
          reject(new Error('WebSocket closed before opening'));
        }
      };

      ws.onerror = (error) => {
        console.error('[MultiAgentSocket] Error:', error);
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      ws.onmessage = (event) => {
      try {
        const message: MultiAgentSocketMessage = JSON.parse(event.data);
        
        switch (message.type) {
          case 'transcript_update':
            onTranscriptUpdate?.(message.data.text as string);
            break;
          case 'agent_question':
            onAgentQuestion?.(message.data as unknown as AgentQuestion);
            break;
          case 'phase_update':
            onPhaseUpdate?.(message.data.phase as SimulationPhase);
            break;
          case 'agenda_update':
            onAgendaUpdate?.(message.data);
            break;
          case 'argument_score':
            onArgumentScore?.(message.data);
            break;
          case 'opponent_response':
            onOpponentResponse?.(message.data);
            break;
          case 'config_ack':
            console.log('[MultiAgentSocket] Config acknowledged:', message.data);
            break;
          case 'agents_updated':
            console.log('[MultiAgentSocket] Agents updated:', message.data);
            break;
          default:
            console.log('[MultiAgentSocket] Unknown message type:', message.type);
        }
      } catch (e) {
        console.error('[MultiAgentSocket] Failed to parse message:', e);
      }
    };

    wsRef.current = ws;
    });
  }, [sessionId, onTranscriptUpdate, onAgentQuestion, onPhaseUpdate, onAgendaUpdate, onArgumentScore, onOpponentResponse]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setIsConnected(false);
  }, []);

  const sendMessage = useCallback((type: string, data: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, data }));
    }
  }, []);

  const sendConfig = useCallback((agents: Agent[], briefSummary: string, opposingBrief?: string) => {
    const payload: Record<string, unknown> = { agents, brief_summary: briefSummary };
    if (opposingBrief !== undefined && opposingBrief !== '') {
      payload.opposing_brief = opposingBrief;
    }
    sendMessage('config', payload);
  }, [sendMessage]);

  const sendAgenda = useCallback((predictedTopicSets: unknown, agendaItems: unknown[]) => {
    sendMessage('set_agenda', {
      predicted_topic_sets: predictedTopicSets,
      agenda_items: agendaItems,
    });
  }, [sendMessage]);

  const sendAudio = useCallback((audioBase64: string) => {
    sendMessage('audio', { audio: audioBase64 });
  }, [sendMessage]);

  const setPhase = useCallback((phase: SimulationPhase) => {
    sendMessage('phase_change', { phase });
  }, [sendMessage]);

  const updateAgents = useCallback((agents: Agent[]) => {
    sendMessage('update_agents', { agents });
  }, [sendMessage]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    connect,
    disconnect,
    sendConfig,
    sendAgenda,
    sendAudio,
    setPhase,
    updateAgents,
  };
}
