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
}

interface UseMultiAgentSocketReturn {
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;
  sendConfig: (agents: Agent[], briefSummary: string) => void;
  sendAudio: (audioBase64: string) => void;
  setPhase: (phase: SimulationPhase) => void;
  updateAgents: (agents: Agent[]) => void;
}

export function useMultiAgentSocket({
  sessionId,
  onTranscriptUpdate,
  onAgentQuestion,
  onPhaseUpdate,
}: UseMultiAgentSocketProps): UseMultiAgentSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

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
  }, [sessionId, onTranscriptUpdate, onAgentQuestion, onPhaseUpdate]);

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

  const sendConfig = useCallback((agents: Agent[], briefSummary: string) => {
    sendMessage('config', { agents, brief_summary: briefSummary });
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
    sendAudio,
    setPhase,
    updateAgents,
  };
}
