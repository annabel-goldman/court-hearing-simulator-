/**
 * WebSocket hook for multi-agent simulation
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Agent,
  AgendaItem,
  AgendaUpdate,
  AgentQuestion,
  ArgumentScore,
  CounterArgument,
  OpponentResponse,
  SimulationPhase,
  MultiAgentSocketMessage,
} from '../types';

// Get base WS URL and remove trailing /ws if present (for consistency with main project)
const WS_BASE = (import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws').replace(/\/ws\/?$/, '');

interface UseMultiAgentSocketProps {
  sessionId: string;
  onTranscriptUpdate?: (text: string) => void;
  onAgentQuestion?: (question: AgentQuestion) => void;
  onPhaseUpdate?: (phase: SimulationPhase) => void;
  onAgendaUpdate?: (update: AgendaUpdate) => void;
  onCounterArgument?: (arg: CounterArgument) => void;
  onArgumentScore?: (score: ArgumentScore) => void;
  onOpponentResponse?: (response: OpponentResponse) => void;
}

interface UseMultiAgentSocketReturn {
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;
  sendConfig: (agents: Agent[], briefSummary: string, opposingBrief?: string) => void;
  sendAudio: (audioBase64: string) => void;
  setPhase: (phase: SimulationPhase) => void;
  updateAgents: (agents: Agent[]) => void;
  sendAgenda: (predictedTopicSets: unknown, agendaItems: AgendaItem[]) => void;
}

export function useMultiAgentSocket({
  sessionId,
  onTranscriptUpdate,
  onAgentQuestion,
  onPhaseUpdate,
  onAgendaUpdate,
  onCounterArgument,
  onArgumentScore,
  onOpponentResponse,
}: UseMultiAgentSocketProps): UseMultiAgentSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Store callbacks in refs so `connect` never needs to be recreated when
  // handler identity changes.  This keeps the WebSocket stable across renders.
  const cbRef = useRef({
    onTranscriptUpdate,
    onAgentQuestion,
    onPhaseUpdate,
    onAgendaUpdate,
    onCounterArgument,
    onArgumentScore,
    onOpponentResponse,
  });
  cbRef.current = {
    onTranscriptUpdate,
    onAgentQuestion,
    onPhaseUpdate,
    onAgendaUpdate,
    onCounterArgument,
    onArgumentScore,
    onOpponentResponse,
  };

  const connect = useCallback(() => {
    // Guard both OPEN and CONNECTING states to prevent duplicate sockets
    const state = wsRef.current?.readyState;
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;

    const ws = new WebSocket(`${WS_BASE}/ws/multi-agent/${sessionId}`);

    ws.onopen = () => {
      console.log('[MultiAgentSocket] Connected');
      setIsConnected(true);
    };

    ws.onclose = () => {
      console.log('[MultiAgentSocket] Disconnected');
      setIsConnected(false);
    };

    ws.onerror = (error) => {
      console.error('[MultiAgentSocket] Error:', error);
    };

    ws.onmessage = (event) => {
      try {
        const message: MultiAgentSocketMessage = JSON.parse(event.data);
        const cb = cbRef.current;

        switch (message.type) {
          case 'transcript_update':
            cb.onTranscriptUpdate?.(message.data.text as string);
            break;
          case 'agent_question':
            cb.onAgentQuestion?.(message.data as unknown as AgentQuestion);
            break;
          case 'phase_update':
            cb.onPhaseUpdate?.(message.data.phase as SimulationPhase);
            break;
          case 'agenda_update':
            cb.onAgendaUpdate?.(message.data as unknown as AgendaUpdate);
            break;
          case 'agent_counter_argument':
            cb.onCounterArgument?.(message.data as unknown as CounterArgument);
            break;
          case 'argument_score':
            cb.onArgumentScore?.(message.data as unknown as ArgumentScore);
            break;
          case 'opponent_response':
            cb.onOpponentResponse?.(message.data as unknown as OpponentResponse);
            break;
          case 'config_ack':
            console.log('[MultiAgentSocket] Config acknowledged:', message.data);
            break;
          case 'agenda_set_ack':
            console.log('[MultiAgentSocket] Agenda set:', message.data);
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
  }, [sessionId]);  // Only depends on sessionId — callbacks read from ref

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
    sendMessage('config', { agents, brief_summary: briefSummary, opposing_brief: opposingBrief || '' });
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

  const sendAgenda = useCallback(
    (predictedTopicSets: unknown, agendaItems: AgendaItem[]) => {
      sendMessage('set_agenda', {
        predicted_topic_sets: predictedTopicSets,
        agenda_items: agendaItems as unknown as Record<string, unknown>[],
      });
    },
    [sendMessage],
  );

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
    sendAudio,
    setPhase,
    updateAgents,
    sendAgenda,
  };
}
