/**
 * Agent Simulation Page
 * 
 * Main orchestrator for the multi-agent brief analysis and questioning system.
 * Composes all feature components into a cohesive experience.
 * 
 * Styles: styles/page.css
 */

import { useCallback, useEffect, useState } from 'react';
import type { Agent, AgentQuestion, BriefData, SimulationPhase } from '../types';
import { Card, CardHeader, CardContent, Alert } from '../components/ui';
import { 
  RecordingControls, 
  RecordingStatus, 
  TranscriptDisplay, 
  QuestionFeed, 
  ActiveAgents 
} from '../components/features';
import { BriefUpload } from '../components/BriefUpload';
import { AgentEditor } from '../components/AgentEditor';
import { useMultiAgentSocket } from '../hooks/useMultiAgentSocket';
import { useMediaRecording } from '../hooks/useMediaRecording';
import '../styles/index.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function generateSessionId(): string {
  return crypto.randomUUID();
}

export function AgentSimulation() {
  const [sessionId] = useState(() => generateSessionId());
  const [phase, setPhase] = useState<SimulationPhase>('SETUP');
  
  const [, setUserBrief] = useState<BriefData | null>(null);
  const [, setOpposingBrief] = useState<BriefData | null>(null);
  const [briefSummary, setBriefSummary] = useState<string>('');
  
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(true);
  
  const [transcript, setTranscript] = useState<string>('');
  const [questions, setQuestions] = useState<AgentQuestion[]>([]);

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
    setTranscript(prev => prev + ' ' + text);
  }, []);

  const handleAgentQuestion = useCallback((question: AgentQuestion) => {
    setQuestions(prev => [...prev, question]);
  }, []);

  const handlePhaseUpdate = useCallback((newPhase: SimulationPhase) => {
    setPhase(newPhase);
  }, []);

  const {
    isConnected,
    connect,
    sendConfig,
    sendAudio,
    setPhase: sendPhase,
    updateAgents,
  } = useMultiAgentSocket({
    sessionId,
    onTranscriptUpdate: handleTranscriptUpdate,
    onAgentQuestion: handleAgentQuestion,
    onPhaseUpdate: handlePhaseUpdate,
  });

  const { startRecording, stopRecording, error: recordingError } = useMediaRecording({
    onAudioChunk: sendAudio,
  });

  const handleBriefsReady = useCallback((user: BriefData, opposing: BriefData) => {
    setUserBrief(user);
    setOpposingBrief(opposing);
  }, []);

  const handleSummaryGenerated = useCallback((summary: string) => {
    setBriefSummary(summary);
    setPhase('READY');
  }, []);

  const handleStartSimulation = useCallback(async () => {
    if (!briefSummary || agents.length === 0) return;

    if (!isConnected) {
      connect();
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    sendConfig(agents, briefSummary);
    await startRecording();
    sendPhase('RECORDING');
    setPhase('RECORDING');
  }, [briefSummary, agents, isConnected, connect, sendConfig, startRecording, sendPhase]);

  const handleStopSimulation = useCallback(() => {
    stopRecording();
    sendPhase('FINISHED');
    setPhase('FINISHED');
  }, [stopRecording, sendPhase]);

  const handleResetSession = useCallback(() => {
    setPhase('READY');
    setTranscript('');
    setQuestions([]);
  }, []);

  const handleAgentsChange = useCallback((newAgents: Agent[]) => {
    setAgents(newAgents);
    if (isConnected) {
      updateAgents(newAgents);
    }
  }, [isConnected, updateAgents]);

  return (
    <div className="ma-page">
      <header className="ma-header">
        <div className="ma-header__inner">
          <div>
            <h1 className="ma-header__title">Multi-Agent Oral Argument Practice</h1>
            <p className="ma-header__subtitle">
              Upload briefs, configure agents, and practice your argument
            </p>
          </div>
          <div className="ma-header__status">
            <span className={`ma-header__connection ma-header__connection--${isConnected ? 'connected' : 'disconnected'}`}>
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
            <span className="ma-status-badge">{phase}</span>
          </div>
        </div>
      </header>

      <main className="ma-main">
        <div className="ma-main__grid">
          <div className="ma-main__column">
            <BriefUpload
              onBriefsReady={handleBriefsReady}
              onSummaryGenerated={handleSummaryGenerated}
            />

            {!isLoadingAgents && (
              <AgentEditor
                agents={agents}
                onAgentsChange={handleAgentsChange}
              />
            )}
          </div>

          <div className="ma-main__column ma-main__column--right">
            <Card>
              <CardHeader action={<RecordingStatus phase={phase} />}>
                Recording
              </CardHeader>
              
              <CardContent>
                {recordingError && <Alert variant="error">{recordingError}</Alert>}

                {phase === 'SETUP' && (
                  <p className="ma-section__help">
                    Upload both briefs and generate a summary to enable recording.
                  </p>
                )}

                <RecordingControls
                  phase={phase}
                  hasAgents={agents.length > 0}
                  onStart={handleStartSimulation}
                  onStop={handleStopSimulation}
                  onReset={handleResetSession}
                />

                <TranscriptDisplay transcript={transcript} />
                
                <ActiveAgents agents={agents} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>Agent Questions</CardHeader>
              <CardContent>
                <QuestionFeed questions={questions} />
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}

export default AgentSimulation;
