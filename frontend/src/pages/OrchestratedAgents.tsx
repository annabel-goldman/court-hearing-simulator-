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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  Agent,
  AgendaUpdate,
  AgentQuestion,
  ArgumentScore,
  BriefData,
  ChatMessage,
  MCTSNode,
  MCTSTree,
  OpponentResponse,
  SimulationPhase,
} from '../multi-agent/types';
import { Alert, Button } from '../multi-agent/components/ui';
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
import { AboutPanel } from '../orchestrated-agents/AboutPanel';
import { JudgeActivityFeed } from '../orchestrated-agents/JudgeActivityFeed';
import { ScoreLog } from '../orchestrated-agents/ScoreLog';
import { OpponentFeed } from '../orchestrated-agents/OpponentFeed';
import { MCTSTreeViz } from '../orchestrated-agents/MCTSTreeViz';
import type { AgendaItem, PredictedTopic } from '../multi-agent/types';
import {
  fetchTtsVoices,
  loadMultiAgentProfiles,
  requestJudgeIntroduction,
} from '../features/orchestrated/services/multiAgentService';
import {
  getOpponentConfig,
  getTtsConfig,
  saveOpponentConfig,
  saveTtsConfig,
} from '../features/orchestrated/services/configService';
import { requestProjectedTimelineStream } from '../features/orchestrated/services/timelineService';
import '../multi-agent/styles/index.css';
import '../orchestrated-agents/agenda.css';
import '../orchestrated-agents/system-config.css';
import '../orchestrated-agents/playground-theme.css';

function generateSessionId(): string {
  return crypto.randomUUID();
}

export default function OrchestratedAgents() {
  const [sessionId, setSessionId] = useState(() => generateSessionId());
  const [phase, setPhase] = useState<SimulationPhase>('SETUP');
  const [setupCollapsed, setSetupCollapsed] = useState(false);
  const [agentQuestionsCollapsed, setAgentQuestionsCollapsed] = useState(false);
  const [mctsHidden, setMctsHidden] = useState(false);

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
  const [opponentResponses, setOpponentResponses] = useState<OpponentResponse[]>([]);
  const [scores, setScores] = useState<ArgumentScore[]>([]);
  const [inactiveAgentIds, setInactiveAgentIds] = useState<Set<string>>(new Set());
  const [agendaUpdate, setAgendaUpdate] = useState<AgendaUpdate | null>(null);
  const [mctsTree, setMctsTree] = useState<MCTSTree | null>(null);
  const [clearTrigger, setClearTrigger] = useState(0);

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

  // ── Turn indicator — tracks who is currently speaking via audio ──────────
  const [activeSpeaker, setActiveSpeaker] = useState<{
    type: 'judge' | 'opponent';
    name: string;
    color: string;
  } | null>(null);

  // ── Silence detection — hands turn to the bench after ~4s of quiet ─────
  const SILENCE_TURN_TIMEOUT = 4000;
  const [silenceDetected, setSilenceDetected] = useState(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetSilenceTimer = useCallback(() => {
    setSilenceDetected(false);
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => setSilenceDetected(true), SILENCE_TURN_TIMEOUT);
  }, []);

  const clearSilenceTimer = useCallback(() => {
    setSilenceDetected(false);
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
  }, []);

  useEffect(() => {
    if (phase === 'RECORDING') {
      resetSilenceTimer();
    } else {
      clearSilenceTimer();
    }
    return () => { if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current); };
  }, [phase, resetSilenceTimer, clearSilenceTimer]);

  useEffect(() => {
    if (activeSpeaker) {
      setSilenceDetected(false);
      if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    } else if (phase === 'RECORDING') {
      resetSilenceTimer();
    }
  }, [activeSpeaker, phase, resetSilenceTimer]);

  // ── Shared audio queue — serializes agent questions + opponent responses ─
  interface AudioQueueItem {
    play: () => Promise<void>;
    speaker: { type: 'judge' | 'opponent'; name: string; color: string };
  }
  const audioQueueRef   = useRef<AudioQueueItem[]>([]);
  const audioPlayingRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  const drainAudioQueueRef = useRef<() => void>(() => {});
  drainAudioQueueRef.current = () => {
    if (audioPlayingRef.current || audioQueueRef.current.length === 0) return;
    audioPlayingRef.current = true;
    const next = audioQueueRef.current.shift()!;
    setActiveSpeaker(next.speaker);
    next.play().finally(() => {
      currentAudioRef.current = null;
      audioPlayingRef.current = false;
      setActiveSpeaker(null);
      drainAudioQueueRef.current();
    });
  };

  const enqueueAudio = useCallback((
    playFn: () => Promise<void>,
    speaker: { type: 'judge' | 'opponent'; name: string; color: string },
  ) => {
    audioQueueRef.current.push({ play: playFn, speaker });
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

  const [voices, setVoices] = useState<{ id: string; name: string }[]>([]);
  const [opponentVoiceId, setOpponentVoiceId] = useState('');
  const [judgeVoiceId, setJudgeVoiceId] = useState('');

  useEffect(() => {
    fetchTtsVoices()
      .then(setVoices)
      .catch(() => {});
    getOpponentConfig()
      .then(cfg => { if (cfg?.voice_id !== undefined) setOpponentVoiceId(cfg.voice_id); })
      .catch(() => {});
    getTtsConfig()
      .then(cfg => { if (cfg?.voice !== undefined) setJudgeVoiceId(cfg.voice); })
      .catch(() => {});
  }, []);

  const handleOpponentVoiceChange = useCallback(async (voiceId: string) => {
    setOpponentVoiceId(voiceId);
    try {
      const cfg = await getOpponentConfig();
      await saveOpponentConfig({ ...cfg, voice_id: voiceId });
    } catch (e) {
      console.error('Failed to save opponent voice:', e);
    }
  }, []);

  const handleJudgeVoiceChange = useCallback(async (voiceId: string) => {
    setJudgeVoiceId(voiceId);
    try {
      const cfg = await getTtsConfig();
      await saveTtsConfig({ ...cfg, voice: voiceId });
    } catch (e) {
      console.error('Failed to save judge voice:', e);
    }
  }, []);

  useEffect(() => {
    async function loadAgents() {
      try {
        setAgents(await loadMultiAgentProfiles());
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
    resetSilenceTimer();
  }, [resetSilenceTimer]);

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
      enqueueAudio(
        () => new Promise<void>((resolve) => {
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
        }),
        { type: 'judge', name: question.agent_name, color: question.color },
      );
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
      enqueueAudio(
        () => new Promise<void>((resolve) => {
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
        }),
        { type: 'opponent', name: 'Opposing Counsel', color: '#e67e22' },
      );
    }
  }, [freezeCurrentSpeech, enqueueAudio]);

  const toggleAgentActive = useCallback((id: string) => {
    setInactiveAgentIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const activeAgents = useMemo(
    () => agents.filter(a => !inactiveAgentIds.has(a.id)),
    [agents, inactiveAgentIds],
  );

  const { isConnected, connect, disconnect, sendConfig, sendAudio, setPhase: sendPhase, updateAgents, sendAgenda } =
    useMultiAgentSocket({
      sessionId,
      onTranscriptUpdate: handleTranscriptUpdate,
      onAgentQuestion: handleAgentQuestion,
      onPhaseUpdate: handlePhaseUpdate,
      onAgendaUpdate: handleAgendaUpdate,
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
    // Queue: accumulate agendas by prediction_id, display in sorted order
    const agendaByPredId = new Map<number, AgendaItem>();
    // Buffer preview nodes by pred_id, flush in order so MCTS viz matches agenda
    const previewNodesByPred = new Map<number, Array<{ id: number; p: number; d: number; label?: string }>>();
    let nextPredToFlush = 1;
    if (mctsFlushRef.current) clearInterval(mctsFlushRef.current);
    setMctsTree({ nodes: [], edges: [] });

    // Flush up to BATCH_SIZE pending nodes every FLUSH_MS ms.
    // Small batches for gradual visible growth, tuned to agenda arrival.
    const BATCH_SIZE = 2;
    const FLUSH_MS   = 100;
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
      const res = await requestProjectedTimelineStream({
        appellant_brief: user.text,
        appellee_brief: opposing.text,
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
            // One lens agenda just completed — queue by prediction_id, display in order
            const ag = event.data as {
              prediction_id: number; lens: string; rationale: string; topics: PredictedTopic[];
            };
            if (ag.topics.length > 0 && ag.rationale !== 'Parse error.') {
              const item: AgendaItem = {
                id: String(ag.prediction_id),
                lens: ag.lens,
                rationale: ag.rationale,
                topics: ag.topics,
                agentId: null,
              };
              agendaByPredId.set(ag.prediction_id, item);
              const sorted = Array.from(agendaByPredId.entries())
                .sort(([a], [b]) => a - b)
                .map(([, v]) => v);
              setAgendaItems(sorted);

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
              const nodesForThisPred: Array<{ id: number; p: number; d: number; label?: string }> = [
                { id: lensId, p: 10000, d: 1, label: ag.lens },
              ];
              for (const topic of newTopics) {
                nodesForThisPred.push({
                  id: previewIdRef.current++,
                  p: lensId,
                  d: 2,
                  label: topic.title,
                });
              }
              previewNodesByPred.set(ag.prediction_id, nodesForThisPred);
              while (previewNodesByPred.has(nextPredToFlush)) {
                const batch = previewNodesByPred.get(nextPredToFlush)!;
                previewNodesByPred.delete(nextPredToFlush);
                pendingNodesRef.current.push(...batch);
                nextPredToFlush++;
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
            const rawPreds = (data.predictions as Array<{ prediction_id: number; lens: string; rationale: string; topics: PredictedTopic[] }>) ?? [];
            const filtered = rawPreds.filter(p => p.topics.length > 0 && p.rationale !== 'Parse error.');
            setPredictedTopicSets(data);
            if (data.mcts_tree) setMctsTree(data.mcts_tree as MCTSTree);

            // Auto-populate brief summary from the prediction's case_summary
            // so the user doesn't need a separate "Generate Summary" step.
            if (data.case_summary && typeof data.case_summary === 'string') {
              setBriefSummary(data.case_summary);
            }

            const items: AgendaItem[] = filtered.map((p) => ({
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
    try {
    // ── Phase 1: Connect WebSocket and send config ────────────────────
    if (!isConnected) {
      try {
        await connect();
      } catch (e) {
        console.error('[handleStartSimulation] WebSocket connection failed:', e);
        setPhase('SETUP');
        return;
      }
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
      const data = await requestJudgeIntroduction(
        briefSummary || 'An appellate moot-court hearing.',
        topicTitles.slice(0, 8),
      );
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
    }
    } finally {
      startingRef.current = false;
    }
  }, [
    briefSummary, activeAgents, isConnected, connect, sendConfig,
    predictedTopicSets, agendaItems, sendAgenda,
    startRecording, sendPhase, opposingBriefText,
  ]);

  const handleStopSimulation = useCallback(() => {
    freezeCurrentSpeech();
    stopRecording();
    sendPhase('FINISHED');
    setPhase('FINISHED');
  }, [freezeCurrentSpeech, stopRecording, sendPhase]);

  const handleResetSession = useCallback(() => {
    setPhase('READY');
    setTranscript('');
    setChatMessages([]);
    currentSpeechRef.current = '';
    chatIdRef.current = 0;
    setQuestions([]);
    setOpponentResponses([]);
    setScores([]);
    setAgendaUpdate(null);
    setMctsTree(null);
  }, []);

  /** Full session clear — wipes agenda and hearing state, preserves briefs.
   *  User returns to SETUP and can click Start to generate a new agenda. */
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
    setActiveSpeaker(null);
    clearSilenceTimer();
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }

    // Cancel any running MCTS flush timer
    if (mctsFlushRef.current) { clearInterval(mctsFlushRef.current); mctsFlushRef.current = null; }
    pendingNodesRef.current = [];

    // Fresh session ID so the backend doesn't confuse old and new session data.
    setSessionId(generateSessionId());

    // Clear hearing state and agenda; preserve briefs so user can regenerate.
    setTranscript('');
    setChatMessages([]);
    currentSpeechRef.current = '';
    chatIdRef.current = 0;
    setQuestions([]);
    setOpponentResponses([]);
    setScores([]);
    setAgendaUpdate(null);
    setMctsTree(null);
    setAgendaItems([]);
    setPredictedTopicSets(null);
    setElapsedSeconds(0);
    setJudgeIntroText(null);
    setClearTrigger((c) => c + 1);

    // Return to SETUP so user sees Start button to generate a new agenda
    setPhase('SETUP');
  }, [stopRecording, disconnect, clearSilenceTimer]);

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

  // ── Stable derived values for MCTSTreeViz (avoids new refs every render) ──
  const addressedTopics = useMemo(
    () => agendaUpdate?.agenda_confidences
      .flatMap(ac => ac.topics_coverage.filter(t => t.addressed).map(t => t.title))
      ?? [],
    [agendaUpdate],
  );
  const predictedNext = useMemo(
    () => agendaUpdate?.predicted_next_topics ?? [],
    [agendaUpdate],
  );
  const currentTopic = agendaUpdate?.last_human_matched_topic ?? null;
  const mctsTitle = agendaUpdate ? 'Tree Projection (Dynamic Topics)' : 'Topic Tree';
  const weakTopics = useMemo(
    () => agendaUpdate?.agenda_confidences
      .flatMap(ac => ac.weak_titles ?? [])
      ?? [],
    [agendaUpdate],
  );
  const topicQualities = useMemo(
    () => agendaUpdate?.agenda_confidences
      .flatMap(ac => ac.topics_coverage)
      .reduce<Record<string, number>>((acc, tc) => {
        if (tc.addressed && tc.quality > 0) {
          acc[tc.title] = Math.max(acc[tc.title] ?? 0, tc.quality);
        }
        return acc;
      }, {})
      ?? {},
    [agendaUpdate],
  );

  return (
    <div className="ma-page oa-page ma-invisible-scroll">
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
                to="/"
                state={{ returnToWelcome: true }}
                className="oa-header-nav__link"
              >
                ← Back to The Bench
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

      <AboutPanel />

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
            clearTrigger={clearTrigger}
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
          {/* Left column — Agenda + MCTS viz */}
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

            {/* ── MCTS viz (square, collapsible) ── */}
            <div className={`oa-panel oa-mcts-panel${mctsHidden ? ' oa-mcts-panel--hidden' : ''}`}>
              <button
                className="oa-panel__header oa-panel__header--toggle"
                onClick={() => setMctsHidden(v => !v)}
              >
                <span className="oa-panel__title">MCTS Topic Tree</span>
                <span className="oa-panel__chevron">{mctsHidden ? '▶' : '▼'}</span>
              </button>
              {!mctsHidden && (
                <div className="oa-mcts-panel__body">
                  <MCTSTreeViz
                    tree={mctsTree}
                    agendaItems={agendaItems}
                    addressedTopics={addressedTopics}
                    predictedNext={predictedNext}
                    currentTopic={currentTopic}
                    title={mctsTitle}
                    weakTopics={weakTopics}
                    topicQualities={topicQualities}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Middle column — Your argument + parallel agent evaluations */}
          <div className="ma-main__column ma-main__column--mid">
            {/* ── Sticky hearing bar: turn indicator + recording controls during session ── */}
            {(phase === 'INTRO' || phase === 'RECORDING' || phase === 'FINISHED') && (
              <div className="oa-hearing-bar">
                <div
                  className={`oa-turn ${
                  phase === 'INTRO'
                    ? 'oa-turn--judge'
                    : phase === 'FINISHED'
                      ? 'oa-turn--finished'
                      : activeSpeaker
                        ? `oa-turn--${activeSpeaker.type}`
                        : silenceDetected
                          ? 'oa-turn--silence'
                          : 'oa-turn--advocate'
                }`}
                style={
                  activeSpeaker
                    ? { '--oa-turn-color': activeSpeaker.color } as React.CSSProperties
                    : undefined
                }
              >
                <span className="oa-turn__pulse" />
                <span className="oa-turn__label">
                  {phase === 'INTRO' ? (
                    'Chief Justice is speaking'
                  ) : phase === 'FINISHED' ? (
                    'Hearing concluded'
                  ) : activeSpeaker?.type === 'judge' ? (
                    <>
                      <span className="oa-turn__name">{activeSpeaker.name}</span> is questioning you
                    </>
                  ) : activeSpeaker?.type === 'opponent' ? (
                    <>
                      <span className="oa-turn__name">Opposing Counsel</span> is responding
                    </>
                  ) : silenceDetected ? (
                    'Silence — the bench may interject'
                  ) : (
                    'Your turn — present your argument'
                  )}
                </span>
              </div>
                {(phase === 'RECORDING' || phase === 'FINISHED') && (
                  <div className="oa-hearing-bar__controls">
                    {phase === 'RECORDING' && (
                      <Button
                        variant="danger"
                        size="lg"
                        onClick={handleStopSimulation}
                      >
                        End Hearing
                      </Button>
                    )}
                    {phase === 'FINISHED' && (
                      <Button
                        variant="primary"
                        size="lg"
                        onClick={handleResetSession}
                      >
                        Start New Hearing
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}

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
                  <p className="oa-setup-guide">
                    Upload both briefs, then click <strong>Start</strong> to create your agenda. Assign agents to topics, then start the hearing.
                  </p>
                )}
                {phase === 'READY' && (
                  <p className="oa-ready-hint">Agenda ready. Click <strong>Start Hearing</strong> when you&apos;re ready to argue.</p>
                )}

                <RecordingControls
                  phase={phase}
                  hasAgents={agents.length > 0}
                  onStart={handleStartSimulation}
                  onStop={handleStopSimulation}
                  onReset={handleResetSession}
                  startLabel="Start Hearing"
                  stopLabel="End Hearing"
                  resetLabel="Start New Hearing"
                />

                <TranscriptDisplay transcript={transcript} chatMessages={chatMessages} />

                {/* ── Toggleable agent chips ── */}
                {agents.length > 0 && (
                  <div className="oa-agent-toggles">
                    <p className="oa-agent-toggles__label">Panel judges — click to mute or unmute</p>
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
              <div className="oa-panel__header oa-panel__header--with-action">
                <span className="oa-panel__title">Judge Activity</span>
                {voices.length > 0 && (
                  <select
                    className="oa-voice-select"
                    value={judgeVoiceId}
                    onChange={e => handleJudgeVoiceChange(e.target.value)}
                    title="Voice for judge questions"
                  >
                    <option value="">Default voice</option>
                    {voices.map(v => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="oa-panel__body">
                <JudgeActivityFeed questions={questions} />
              </div>
            </div>

            <div className="oa-panel">
              <div className="oa-panel__header oa-panel__header--with-action">
                <span className="oa-panel__title">Opposing Counsel</span>
                {voices.length > 0 && (
                  <select
                    className="oa-voice-select"
                    value={opponentVoiceId}
                    onChange={e => handleOpponentVoiceChange(e.target.value)}
                    title="Voice for opposing counsel"
                  >
                    <option value="">Default voice</option>
                    {voices.map(v => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="oa-panel__body">
                <OpponentFeed responses={opponentResponses} />
              </div>
            </div>

            {/* ── Agent Questions (vertical list, below Opposing Counsel) ── */}
            <div className={`oa-panel${agentQuestionsCollapsed ? ' oa-panel--collapsed' : ''}`}>
              <button
                className="oa-panel__header oa-panel__header--toggle"
                onClick={() => setAgentQuestionsCollapsed(c => !c)}
              >
                <span className="oa-panel__title">
                  Questions the bench may ask
                  {questions.length > 0 && (
                    <span className="oa-panel__count">{questions.length}</span>
                  )}
                </span>
                <span className="oa-panel__chevron">{agentQuestionsCollapsed ? '▶' : '▼'}</span>
              </button>
              {!agentQuestionsCollapsed && (
                <div className="oa-panel__body">
                  <p className="oa-panel__hint">
                    This is a range of questions the judge is thinking from right now.
                  </p>
                  <QuestionFeed agents={agents} questions={questions} />
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
