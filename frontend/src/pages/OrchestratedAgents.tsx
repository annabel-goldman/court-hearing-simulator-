/**
 * Orchestrated Agents Page
 *
 * Mirrors the Multi-Agent Practice UI but adds a Hearing Agenda panel
 * that lets you define agenda items, assign agents to each topic, and
 * view agent details inline on a vertical timeline.
 *
 * New in this version:
 *  - Stores the raw PredictedTopicSets so it can be sent to the backend
 *    tracker when the simulation starts.
 *  - Sends `set_agenda` over WebSocket → backend initialises TrajectoryTracker
 *    + MCTS projector.
 *  - Handles `agenda_update` (coverage/confidence/next-topics) and
 *    `agent_counter_argument` messages for live feedback.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  Agent,
  AgendaUpdate,
  AgentQuestion,
  ArgumentScore,
  BriefData,
  ChatMessage,
  CounterArgument,
  MCTSNode,
  MCTSTree,
  OpponentResponse,
  SimulationPhase,
} from '../multi-agent/types';
import { Alert } from '../multi-agent/components/ui';
import {
  RecordingControls,
  RecordingStatus,
  TranscriptDisplay,
  QuestionFeed,
} from '../multi-agent/components/features';
import { BriefUpload } from '../multi-agent/components/BriefUpload';
import { AgentEditor } from '../multi-agent/components/AgentEditor';
import { useMultiAgentSocket } from '../multi-agent/hooks/useMultiAgentSocket';
import { useMediaRecording } from '../multi-agent/hooks/useMediaRecording';
import { AgendaPanel } from '../orchestrated-agents/AgendaPanel';
import { JudgeConfigPanel } from '../orchestrated-agents/JudgeConfigPanel';
import { OpponentConfigPanel } from '../orchestrated-agents/OpponentConfigPanel';
import { SystemConfigPanel } from '../orchestrated-agents/SystemConfigPanel';
import { JudgeActivityFeed } from '../orchestrated-agents/JudgeActivityFeed';
import { ScoreLog } from '../orchestrated-agents/ScoreLog';
import { OpponentFeed } from '../orchestrated-agents/OpponentFeed';
import { MCTSTreeViz } from '../orchestrated-agents/MCTSTreeViz';
import type { AgendaItem, PredictedTopic } from '../multi-agent/types';
import '../multi-agent/styles/index.css';
import '../orchestrated-agents/agenda.css';
import '../orchestrated-agents/system-config.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function generateSessionId(): string {
  return crypto.randomUUID();
}

export default function OrchestratedAgents() {
  const [sessionId, setSessionId] = useState(() => generateSessionId());
  const [phase, setPhase] = useState<SimulationPhase>('SETUP');
  const [setupCollapsed, setSetupCollapsed] = useState(false);

  const [, setUserBrief] = useState<BriefData | null>(null);
  const [opposingBriefText, setOpposingBriefText] = useState<string>('');
  const [briefSummary, setBriefSummary] = useState<string>('');

  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(true);

  const [agendaItems, setAgendaItems] = useState<AgendaItem[]>([]);
  const [isGeneratingAgenda, setIsGeneratingAgenda] = useState(false);
  const [, setAgendaError] = useState<string | null>(null);
  const [generationStatus, setGenerationStatus] = useState<string>('');
  // Raw API response kept so we can send it to the backend tracker on start
  const [predictedTopicSets, setPredictedTopicSets] = useState<unknown>(null);

  const [transcript, setTranscript] = useState<string>('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const currentSpeechRef = useRef('');
  const chatIdRef = useRef(0);
  const [questions, setQuestions] = useState<AgentQuestion[]>([]);
  const [counterArguments, setCounterArguments] = useState<CounterArgument[]>([]);
  const [opponentResponses, setOpponentResponses] = useState<OpponentResponse[]>([]);
  const [scores, setScores] = useState<ArgumentScore[]>([]);
  const [inactiveAgentIds, setInactiveAgentIds] = useState<Set<string>>(new Set());
  const [agendaUpdate, setAgendaUpdate] = useState<AgendaUpdate | null>(null);
  const [mctsTree, setMctsTree] = useState<MCTSTree | null>(null);

  // Queue of node events waiting to be flushed into mctsTree state at a
  // controlled rate so the tree visibly grows rather than snapping in at once.
  const pendingNodesRef = useRef<Array<{ id: number; p: number; d: number; label?: string }>>([]);
  const mctsFlushRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Counter for preview-tree node IDs (10 000+) so they never clash with MCTS IDs. */
  const previewIdRef    = useRef(10001);
  /** Track topic titles already placed in the preview tree — prevents cross-lens duplicates. */
  const seenPreviewTopicsRef = useRef(new Set<string>());

  // ── Session timer — counts elapsed seconds while recording ────────────
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Judge introduction ────────────────────────────────────────────────
  const [judgeIntroText, setJudgeIntroText] = useState<string | null>(null);
  const judgeAudioRef = useRef<HTMLAudioElement | null>(null);

  // ── Shared audio queue — serializes agent questions + opponent responses ─
  const audioQueueRef   = useRef<Array<() => Promise<void>>>([]);
  const audioPlayingRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  // drainAudioQueueRef is reassigned each render so the recursive call always
  // uses the latest closure (avoids stale-ref issues with useCallback + recursion).
  const drainAudioQueueRef = useRef<() => void>(() => {});
  drainAudioQueueRef.current = () => {
    if (audioPlayingRef.current || audioQueueRef.current.length === 0) return;
    audioPlayingRef.current = true;
    const next = audioQueueRef.current.shift()!;
    next().finally(() => {
      currentAudioRef.current = null;
      audioPlayingRef.current = false;
      drainAudioQueueRef.current();
    });
  };

  const enqueueAudio = useCallback((playFn: () => Promise<void>) => {
    audioQueueRef.current.push(playFn);
    drainAudioQueueRef.current();
  }, []);

  // ── Guard against double-click on Start Hearing ───────────────────────
  const startingRef = useRef(false);

  useEffect(() => {
    if (phase === 'RECORDING') {
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase]);

  // Clean up flush timer on unmount
  useEffect(() => {
    return () => { if (mctsFlushRef.current) clearInterval(mctsFlushRef.current); };
  }, []);

  useEffect(() => {
    async function loadAgents() {
      try {
        const response = await fetch(`${API_URL}/api/multi-agent/agents`);
        if (!response.ok) throw new Error('Failed to load agents');
        const data = await response.json();
        setAgents(data.agents);
      } catch (e) {
        console.error('Failed to load agents:', e);
      } finally {
        setIsLoadingAgents(false);
      }
    }
    loadAgents();
  }, []);

  const handleTranscriptUpdate = useCallback((text: string) => {
    currentSpeechRef.current += ' ' + text;
    setTranscript(currentSpeechRef.current);
  }, []);

  /** Freeze the current live speech into a chat message and reset for next segment. */
  const freezeCurrentSpeech = useCallback(() => {
    const trimmed = currentSpeechRef.current.trim();
    if (trimmed) {
      const id = ++chatIdRef.current;
      setChatMessages(prev => [...prev, { id, role: 'user', text: trimmed, timestamp: Date.now() }]);
    }
    currentSpeechRef.current = '';
    setTranscript('');
  }, []);

  const handleAgentQuestion = useCallback((question: AgentQuestion) => {
    setQuestions((prev) => [...prev, question]);

    // Freeze current speech when a judge interrupts; do NOT add to chatMessages —
    // the "Your Transcript" panel only shows the advocate's own speech.
    if (question.selected !== false) {
      freezeCurrentSpeech();
    }

    // Enqueue TTS audio for serialized playback (won't overlap opponent audio)
    if (question.audio) {
      enqueueAudio(() => new Promise<void>((resolve) => {
        const format = question.audio_format || 'mp3';
        const mimeMap: Record<string, string> = { opus: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav' };
        const mime = mimeMap[format] || 'audio/mpeg';
        const blob = new Blob(
          [Uint8Array.from(atob(question.audio!), c => c.charCodeAt(0))],
          { type: mime },
        );
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        currentAudioRef.current = audio;
        audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
        audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
        audio.play().catch(() => resolve());
      }));
    }
  }, [freezeCurrentSpeech, enqueueAudio]);

  const handlePhaseUpdate = useCallback((newPhase: SimulationPhase) => {
    setPhase(newPhase);
  }, []);

  const handleAgendaUpdate = useCallback((update: AgendaUpdate) => {
    setAgendaUpdate(update);
    // Only update the tree when we have a valid structure (backend may send null or {})
    if (update.mcts_tree && (update.mcts_tree as unknown as { nodes?: unknown }).nodes) {
      setMctsTree(update.mcts_tree);
    }
  }, []);

  const handleCounterArgument = useCallback((arg: CounterArgument) => {
    setCounterArguments((prev) => [...prev, arg]);
  }, []);

  const handleArgumentScore = useCallback((score: ArgumentScore) => {
    setScores((prev) => [...prev, score]);
  }, []);

  const handleOpponentResponse = useCallback((response: OpponentResponse) => {
    setOpponentResponses((prev) => [...prev, response]);

    // Freeze current speech so the advocate's argument is segmented; do NOT add
    // the opponent response to chatMessages — transcript only shows user speech.
    freezeCurrentSpeech();

    // Enqueue TTS audio if the backend included it
    if (response.audio) {
      enqueueAudio(() => new Promise<void>((resolve) => {
        const format = response.audio_format || 'mp3';
        const mimeMap: Record<string, string> = { opus: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav' };
        const mime = mimeMap[format] || 'audio/mpeg';
        const blob = new Blob(
          [Uint8Array.from(atob(response.audio!), c => c.charCodeAt(0))],
          { type: mime },
        );
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        currentAudioRef.current = audio;
        audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
        audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
        audio.play().catch(() => resolve());
      }));
    }
  }, [freezeCurrentSpeech, enqueueAudio]);

  const toggleAgentActive = useCallback((id: string) => {
    setInactiveAgentIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const activeAgents = agents.filter(a => !inactiveAgentIds.has(a.id));

  const { isConnected, connect, disconnect, sendConfig, sendAudio, setPhase: sendPhase, updateAgents, sendAgenda } =
    useMultiAgentSocket({
      sessionId,
      onTranscriptUpdate: handleTranscriptUpdate,
      onAgentQuestion: handleAgentQuestion,
      onPhaseUpdate: handlePhaseUpdate,
      onAgendaUpdate: handleAgendaUpdate,
      onCounterArgument: handleCounterArgument,
      onArgumentScore: handleArgumentScore,
      onOpponentResponse: handleOpponentResponse,
    });

  const { startRecording, stopRecording, error: recordingError } = useMediaRecording({
    onAudioChunk: sendAudio,
  });

  const handleBriefsReady = useCallback(async (user: BriefData, opposing: BriefData) => {
    setUserBrief(user);
    setOpposingBriefText(opposing.text);
    setAgendaError(null);
    setIsGeneratingAgenda(true);
    setGenerationStatus('Starting…');
    setAgendaItems([]);

    // Reset queue and seed an empty tree so the viz panel mounts immediately
    pendingNodesRef.current = [];
    previewIdRef.current = 10001;
    seenPreviewTopicsRef.current.clear();
    if (mctsFlushRef.current) clearInterval(mctsFlushRef.current);
    setMctsTree({ nodes: [], edges: [] });

    // Flush up to BATCH_SIZE pending nodes into state every FLUSH_MS ms.
    // This rate-limits visual growth so the tree visibly builds rather than
    // snapping in all at once (MCTS runs in sub-second time on CPU).
    const BATCH_SIZE = 1;
    const FLUSH_MS   = 120;
    mctsFlushRef.current = setInterval(() => {
      const batch = pendingNodesRef.current.splice(0, BATCH_SIZE);
      if (batch.length === 0) return;
      setMctsTree(prev => {
        if (!prev) return prev;
        const newNodes = batch.map(
          (n): MCTSNode => ({ id: n.id, label: n.label ?? '', visits: 1, avg_value: 0, depth: n.d })
        );
        const newEdges = batch
          .filter(n => n.p !== -1)
          .map(n => ({ source: n.p, target: n.id }));
        const existingIds = new Set(prev.nodes.map(n => n.id));
        const uniqueNodes = newNodes.filter(n => !existingIds.has(n.id));
        const existingEdgeKeys = new Set(prev.edges.map(e => `${e.source}-${e.target}`));
        const uniqueEdges = newEdges.filter(e => !existingEdgeKeys.has(`${e.source}-${e.target}`));
        return { nodes: [...prev.nodes, ...uniqueNodes], edges: [...prev.edges, ...uniqueEdges] };
      });
    }, FLUSH_MS);

    try {
      const res = await fetch(`${API_URL}/api/projected-timeline/generate-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appellant_brief: user.text,
          appellee_brief: opposing.text,
        }),
      });
      if (!res.ok || !res.body) throw new Error('Failed to start timeline generation');

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE frames are delimited by "\n\n"
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data: ')) continue;

          let event: { type: string; data?: unknown; phase?: string; detail?: string };
          try { event = JSON.parse(line.slice('data: '.length)); }
          catch { continue; }

          if (event.type === 'node') {
            // MCTS streaming nodes — skip; the final tree arrives in the 'done' event.
            // The preview tree stays visible until then.

          } else if (event.type === 'status') {
            // Phase progress — update the status text shown in the AgendaPanel
            const { detail } = event.data as { phase: string; detail: string };
            setGenerationStatus(detail || '');

          } else if (event.type === 'agenda') {
            // One lens agenda just completed — add it immediately
            const ag = event.data as {
              prediction_id: number; lens: string; rationale: string; topics: PredictedTopic[];
            };
            if (ag.topics.length > 0 && ag.rationale !== 'Parse error.') {
              setAgendaItems(prev => [
                ...prev,
                {
                  id: String(ag.prediction_id),
                  lens: ag.lens,
                  rationale: ag.rationale,
                  topics: ag.topics,
                  agentId: null,
                },
              ]);

              // Ensure preview root exists before enqueueing children
              setMctsTree(prev => {
                const tree = prev || { nodes: [], edges: [] };
                if (tree.nodes.some(n => n.depth === 0)) return tree;
                return {
                  nodes: [{ id: 10000, label: '', visits: 0, avg_value: 0, depth: 0 }],
                  edges: [],
                };
              });

              // Create a lens vertex node (depth 1) then attach topics as its children (depth 2).
              // Deduplicate: skip topics already shown from earlier lenses so the preview
              // node count stays consistent with the final MCTS tree.
              const newTopics = ag.topics.filter(t => !seenPreviewTopicsRef.current.has(t.title));
              if (newTopics.length === 0) continue; // all topics from this lens were duplicates

              for (const t of newTopics) seenPreviewTopicsRef.current.add(t.title);

              const lensId = previewIdRef.current++;
              pendingNodesRef.current.push({
                id: lensId,
                p: 10000,
                d: 1,
                label: ag.lens,
              });

              for (const topic of newTopics) {
                pendingNodesRef.current.push({
                  id: previewIdRef.current++,
                  p: lensId,
                  d: 2,
                  label: topic.title,
                });
              }
            }

          } else if (event.type === 'done') {
            // Stop the flush timer and discard any remaining queued stubs —
            // the final labeled tree from the server replaces them.
            clearInterval(mctsFlushRef.current!);
            mctsFlushRef.current  = null;
            pendingNodesRef.current = [];
            setGenerationStatus('');

            const data = event.data as Record<string, unknown>;
            setPredictedTopicSets(data);
            if (data.mcts_tree) setMctsTree(data.mcts_tree as MCTSTree);

            // Auto-populate brief summary from the prediction's case_summary
            // so the user doesn't need a separate "Generate Summary" step.
            if (data.case_summary && typeof data.case_summary === 'string') {
              setBriefSummary(data.case_summary);
            }

            const items: AgendaItem[] = (
              (data.predictions as Array<{
                prediction_id: number; lens: string; rationale: string; topics: PredictedTopic[];
              }>) ?? []
            )
              .filter(p => p.topics.length > 0 && p.rationale !== 'Parse error.')
              .map((p) => ({
                id: String(p.prediction_id),
                lens: p.lens,
                rationale: p.rationale,
                topics: p.topics,
                agentId: null,
              }));

            setAgendaItems(items);

            // Agenda is ready — allow recording to start
            setPhase('READY');

          } else if (event.type === 'error') {
            throw new Error(event.detail ?? 'Generation failed');
          }
        }
      }
    } catch (e) {
      console.error('Failed to generate agenda:', e);
      setAgendaError(e instanceof Error ? e.message : 'Failed to generate agenda');
    } finally {
      if (mctsFlushRef.current) { clearInterval(mctsFlushRef.current); mctsFlushRef.current = null; }
      pendingNodesRef.current = [];
      setIsGeneratingAgenda(false);
    }
  }, []);


  const handleStartSimulation = useCallback(async () => {
    if (agents.length === 0) {
      console.warn('[handleStartSimulation] No agents loaded');
      return;
    }
    if (startingRef.current) return;  // prevent double-click
    startingRef.current = true;

    // ── Phase 1: Connect WebSocket and send config ────────────────────
    if (!isConnected) {
      connect();
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    
    sendConfig(activeAgents, briefSummary, opposingBriefText);
    if (predictedTopicSets && agendaItems.length > 0) {
      sendAgenda(predictedTopicSets, agendaItems);
    }

    // ── Phase 2: Judge introduction ──────────────────────────────────
    setPhase('INTRO');
    setJudgeIntroText(null);

    // Gather topic titles for the judge's intro
    const topicTitles = agendaItems.flatMap(item => item.topics.map(t => t.title));

    try {
      const res = await fetch(`${API_URL}/api/multi-agent/judge-intro`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          case_summary: briefSummary || 'An appellate moot-court hearing.',
          agenda_topics: topicTitles.slice(0, 8),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setJudgeIntroText(data.text);

        // Add the judge introduction to the questions feed
        if (data.text) {
          setQuestions(prev => [{
            agent_id: '__judge__',
            agent_name: 'Chief Justice',
            color: '#f0c040',
            question: data.text,
            timestamp: new Date().toISOString(),
          }, ...prev]);
        }

        // Play TTS audio if available
        if (data.audio) {
          const audioFormat = data.format || 'opus';
          const mimeMap: Record<string, string> = { opus: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav' };
          const mime = mimeMap[audioFormat] || 'audio/ogg';
          const audioBlob = new Blob(
            [Uint8Array.from(atob(data.audio), c => c.charCodeAt(0))],
            { type: mime },
          );
          const audioUrl = URL.createObjectURL(audioBlob);
          const audio = new Audio(audioUrl);
          judgeAudioRef.current = audio;

          await new Promise<void>((resolve) => {
            audio.onended = () => { URL.revokeObjectURL(audioUrl); resolve(); };
            audio.onerror = () => { URL.revokeObjectURL(audioUrl); resolve(); };
            audio.play().catch(() => resolve());
          });
        } else {
          // No audio — just show the text for a few seconds
          await new Promise(resolve => setTimeout(resolve, 4000));
        }
      } else {
        // Endpoint failed — use a quick fallback
        const fallback = 'This court is now in session. Counsel, you may proceed.';
        setJudgeIntroText(fallback);
        setQuestions(prev => [{
          agent_id: '__judge__',
          agent_name: 'Chief Justice',
          color: '#f0c040',
          question: fallback,
          timestamp: new Date().toISOString(),
        }, ...prev]);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    } catch (e) {
      console.error('Judge intro failed:', e);
      const fallback = 'This court is now in session. Counsel, you may proceed.';
      setJudgeIntroText(fallback);
      setQuestions(prev => [{
        agent_id: '__judge__',
        agent_name: 'Chief Justice',
        color: '#f0c040',
        question: fallback,
        timestamp: new Date().toISOString(),
      }, ...prev]);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    // ── Phase 3: Start recording ─────────────────────────────────────
    try {
      await startRecording();
      sendPhase('RECORDING');
      setPhase('RECORDING');
    } catch (e) {
      console.error('Recording start failed:', e);
      setPhase('READY');
    } finally {
      startingRef.current = false;
    }
  }, [
    briefSummary, activeAgents, isConnected, connect, sendConfig,
    predictedTopicSets, agendaItems, sendAgenda,
    startRecording, sendPhase, opposingBriefText,
  ]);

  const handleStopSimulation = useCallback(() => {
    stopRecording();
    sendPhase('FINISHED');
    setPhase('FINISHED');
  }, [stopRecording, sendPhase]);

  const handleResetSession = useCallback(() => {
    setPhase('READY');
    setTranscript('');
    setChatMessages([]);
    currentSpeechRef.current = '';
    chatIdRef.current = 0;
    setQuestions([]);
    setCounterArguments([]);
    setOpponentResponses([]);
    setScores([]);
    setAgendaUpdate(null);
    setMctsTree(null);
  }, []);

  /** Full session clear — resets everything back to SETUP. */
  const handleClearSession = useCallback(() => {
    // Stop any in-flight recording / connection
    stopRecording();
    disconnect();
    startingRef.current = false;

    // Stop any playing judge audio
    if (judgeAudioRef.current) {
      judgeAudioRef.current.pause();
      judgeAudioRef.current = null;
    }

    // Stop any playing queued audio (agent question or opponent response)
    audioQueueRef.current = [];
    audioPlayingRef.current = false;
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }

    // Cancel any running MCTS flush timer
    if (mctsFlushRef.current) { clearInterval(mctsFlushRef.current); mctsFlushRef.current = null; }
    pendingNodesRef.current = [];
    previewIdRef.current = 10001;
    seenPreviewTopicsRef.current.clear();

    // Reset all state back to initial — including a fresh session ID so the
    // backend doesn't confuse old and new session data.
    setSessionId(generateSessionId());
    setPhase('SETUP');
    setUserBrief(null);
    setOpposingBriefText('');
    setBriefSummary('');
    setAgendaItems([]);
    setIsGeneratingAgenda(false);
    setAgendaError(null);
    setGenerationStatus('');
    setPredictedTopicSets(null);
    setTranscript('');
    setChatMessages([]);
    currentSpeechRef.current = '';
    chatIdRef.current = 0;
    setQuestions([]);
    setCounterArguments([]);
    setOpponentResponses([]);
    setScores([]);
    setInactiveAgentIds(new Set());
    setAgendaUpdate(null);
    setMctsTree(null);
    setElapsedSeconds(0);
    setJudgeIntroText(null);
  }, [stopRecording, disconnect]);

  const handleAgentsChange = useCallback(
    (newAgents: Agent[]) => {
      setAgents(newAgents);
      if (isConnected) updateAgents(newAgents.filter(a => !inactiveAgentIds.has(a.id)));
    },
    [isConnected, updateAgents, inactiveAgentIds]
  );

  // Sync active-agent toggles to backend while a session is live
  useEffect(() => {
    if (isConnected && agents.length > 0) {
      updateAgents(agents.filter(a => !inactiveAgentIds.has(a.id)));
    }
  }, [inactiveAgentIds]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="ma-page ma-invisible-scroll">
      {/* ── Header ── */}
      <header className="ma-header">
        <div className="ma-header__inner">
          <div>
            <h1 className="ma-header__title">Orchestrated Agents</h1>
            <p className="ma-header__subtitle">
              Define a hearing agenda, assign agents to each topic, and run your oral argument
            </p>
          </div>
          <div className="ma-header__status">
            <nav className="oa-header-nav">
              <Link
                to="/multi-agent"
                className="oa-header-nav__link"
              >
                Multi-Agent Practice
              </Link>
              <Link
                to="/orchestrated-agents"
                className="oa-header-nav__link oa-header-nav__link--active"
              >
                Orchestrated Agents
              </Link>
            </nav>
            <span
              className={`ma-header__connection ma-header__connection--${
                isConnected ? 'connected' : 'disconnected'
              }`}
            >
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
            <span className="ma-status-badge">{phase}</span>
            {(phase === 'RECORDING' || phase === 'FINISHED') && (
              <span className="ma-session-timer" title="Session elapsed time">
                {String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:
                {String(elapsedSeconds % 60).padStart(2, '0')}
              </span>
            )}
            {phase !== 'SETUP' && (
              <button className="ma-clear-session-btn" onClick={handleClearSession}>
                Clear Session
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── Setup & Configuration (full-width, collapsible) ── */}
      <div className={`oa-setup-section oa-setup-section--fullwidth${
        setupCollapsed || phase === 'RECORDING' || phase === 'INTRO' ? ' oa-setup-section--collapsed' : ''
      }`}>
        <button
          className="oa-setup-section__toggle"
          onClick={() => setSetupCollapsed(c => !c)}
        >
          <span className="oa-setup-section__label">Setup &amp; Configuration</span>
          <span className="oa-setup-section__chevron">▼</span>
        </button>
        <div className="oa-setup-section__body oa-setup-section__body--horizontal">
          <BriefUpload
            onBriefsReady={handleBriefsReady}
          />

          {!isLoadingAgents && (
            <AgentEditor agents={agents} onAgentsChange={handleAgentsChange} />
          )}

          <JudgeConfigPanel />
          <OpponentConfigPanel />
          <SystemConfigPanel />
        </div>
      </div>

      {/* ── Main grid ── */}
      <main className="ma-main">
        <div className="ma-main__grid">
          {/* Left column */}
          <div className="ma-main__column">
            {/* ── Live Tracking (always visible) ── */}
            <AgendaPanel
              agents={agents}
              items={agendaItems}
              onItemsChange={setAgendaItems}
              isLoading={isGeneratingAgenda}
              statusText={generationStatus}
              coverage={agendaUpdate}
            />

            <MCTSTreeViz
              tree={mctsTree}
              agendaItems={agendaItems}
              addressedTopics={
                agendaUpdate?.agenda_confidences
                  .flatMap(ac => ac.topics_coverage.filter(t => t.addressed).map(t => t.title))
                ?? []
              }
              predictedNext={agendaUpdate?.predicted_next_topics ?? []}
              currentTopic={agendaUpdate?.last_human_matched_topic ?? null}
              title={agendaUpdate ? 'Tree Projection (Dynamic Topics)' : 'Topic Tree'}
              weakTopics={
                agendaUpdate?.agenda_confidences
                  .flatMap(ac => ac.weak_titles ?? [])
                ?? []
              }
              topicQualities={
                agendaUpdate?.agenda_confidences
                  .flatMap(ac => ac.topics_coverage)
                  .reduce<Record<string, number>>((acc, tc) => {
                    if (tc.addressed && tc.quality > 0) {
                      acc[tc.title] = Math.max(acc[tc.title] ?? 0, tc.quality);
                    }
                    return acc;
                  }, {})
                ?? {}
              }
            />
          </div>

          {/* Middle column — Your argument + parallel agent evaluations */}
          <div className="ma-main__column ma-main__column--mid">
            {/* Judge Introduction Banner */}
            {phase === 'INTRO' && (
              <div className="oa-panel">
                <div className="oa-panel__body">
                  <div className="oa-judge-intro">
                    <div className="oa-judge-intro__icon">⚖️</div>
                    <div>
                      <p className="oa-judge-intro__speaker">Chief Justice Speaking</p>
                      <p className="oa-judge-intro__text">
                        {judgeIntroText ? `"${judgeIntroText}"` : 'The court is assembling…'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Your Argument ── */}
            <div className="oa-panel">
              <div className="oa-panel__header">
                <span className="oa-panel__title">Your Argument</span>
                <div className="oa-panel__action"><RecordingStatus phase={phase} /></div>
              </div>
              <div className="oa-panel__body">
                {recordingError && <Alert variant="error">{recordingError}</Alert>}

                {phase === 'SETUP' && (
                  <p className="ma-section__help">
                    Upload both briefs and generate the agenda to begin the hearing.
                  </p>
                )}

                <RecordingControls
                  phase={phase}
                  hasAgents={agents.length > 0}
                  onStart={handleStartSimulation}
                  onStop={handleStopSimulation}
                  onReset={handleResetSession}
                />

                <TranscriptDisplay transcript={transcript} chatMessages={chatMessages} />

                {/* ── Toggleable agent chips ── */}
                {agents.length > 0 && (
                  <div className="oa-agent-toggles">
                    <p className="oa-agent-toggles__label">Active Judges — click to toggle</p>
                    <div className="oa-agent-toggles__list">
                      {agents.map(agent => {
                        const active = !inactiveAgentIds.has(agent.id);
                        return (
                          <button
                            key={agent.id}
                            className={`oa-agent-toggle${active ? '' : ' oa-agent-toggle--off'}`}
                            style={{ borderColor: active ? agent.color : undefined }}
                            onClick={() => toggleAgentActive(agent.id)}
                            title={active ? 'Click to deactivate' : 'Click to activate'}
                          >
                            <span
                              className="oa-agent-toggle__dot"
                              style={{ background: active ? agent.color : undefined }}
                            />
                            {agent.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Agent Questions (parallel evaluations) ── */}
            <div className="oa-panel">
              <div className="oa-panel__header">
                <span className="oa-panel__title">Agent Questions</span>
              </div>
              <div className="oa-panel__body">
                <QuestionFeed agents={agents} questions={questions} />
              </div>
            </div>

            {/* ── Argument Scores ── */}
            <div className="oa-panel">
              <div className="oa-panel__header">
                <span className="oa-panel__title">Argument Scores</span>
              </div>
              <div className="oa-panel__body">
                <ScoreLog scores={scores} />
              </div>
            </div>
          </div>

          {/* Right column — Judge output + Opponent output */}
          <div className="ma-main__column ma-main__column--right">
            <div className="oa-panel">
              <div className="oa-panel__header">
                <span className="oa-panel__title">Judge Activity</span>
              </div>
              <div className="oa-panel__body">
                <JudgeActivityFeed questions={questions} counterArguments={counterArguments} />
              </div>
            </div>

            <div className="oa-panel">
              <div className="oa-panel__header">
                <span className="oa-panel__title">Opposing Counsel</span>
              </div>
              <div className="oa-panel__body">
                <OpponentFeed responses={opponentResponses} />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
