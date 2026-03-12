/**
 * Judge Configuration Panel
 *
 * Collapsible panel with three tabs:
 *   • Judge Prompt  — base system prompt controlling interrupt / question behaviour
 *   • Reward        — scoring dimensions, weights, and scoring prompt template
 *   • External LLM  — optional OpenAI-compatible API override for LARGE / SMALL tier
 *
 * All state is self-managed; the panel owns its own API calls.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '../multi-agent/components/ui/Button';
import { Alert } from '../multi-agent/components/ui/Alert';
import {
  getDefaultJudgeConfig,
  getJudgeConfig,
  saveJudgeConfig,
  type ExternalLLMConfig,
  type JudgeConfig,
  type RewardDimension,
} from '../features/orchestrated/services/configService';
import './judge-config.css';

type Tab = 'prompt' | 'reward' | 'external';
type SaveStatus = 'idle' | 'success' | 'error';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function JudgeConfigPanel() {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('prompt');
  const [config, setConfig] = useState<JudgeConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState('');
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveStatus === 'success') {
      successTimerRef.current = setTimeout(() => setSaveStatus('idle'), 3000);
    }
    return () => { if (successTimerRef.current) clearTimeout(successTimerRef.current); };
  }, [saveStatus]);

  // ── Load config from backend ──────────────────────────────────────────────

  const loadConfig = useCallback(async () => {
    setIsLoading(true);
    try {
      setConfig(await getJudgeConfig());
    } catch (err) {
      console.error('[JudgeConfigPanel] load failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load on first expand
  const handleToggle = () => {
    if (isCollapsed && config === null) {
      loadConfig();
    }
    setIsCollapsed(prev => !prev);
  };

  // ── Reset to defaults ─────────────────────────────────────────────────────

  const handleReset = async () => {
    try {
      setConfig(await getDefaultJudgeConfig());
      setSaveStatus('idle');
    } catch (err) {
      console.error('[JudgeConfigPanel] reset failed:', err);
    }
  };

  // ── Save ──────────────────────────────────────────────────────────────────

  const weightSum = config
    ? config.reward_dimensions.reduce((s, d) => s + d.weight, 0)
    : 1.0;
  const weightOk = Math.abs(weightSum - 1.0) <= 0.01;

  const handleSave = async () => {
    if (!config || !weightOk) return;
    setIsSaving(true);
    setSaveStatus('idle');
    setSaveError('');
    try {
      await saveJudgeConfig(config);
      setSaveStatus('success');
    } catch (err) {
      setSaveStatus('error');
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  // ── Generic updaters ──────────────────────────────────────────────────────

  const setPrompt = (value: string) =>
    setConfig(c => c ? { ...c, judge_prompt: value } : c);

  const setScoringTemplate = (value: string) =>
    setConfig(c => c ? { ...c, scoring_prompt_template: value } : c);

  const updateDim = (index: number, field: keyof RewardDimension, value: string | number) =>
    setConfig(c => {
      if (!c) return c;
      const dims = c.reward_dimensions.map((d, i) =>
        i === index ? { ...d, [field]: value } : d
      );
      return { ...c, reward_dimensions: dims };
    });

  const addDim = () =>
    setConfig(c => c ? {
      ...c,
      reward_dimensions: [
        ...c.reward_dimensions,
        { name: '', weight: 0, description: '' },
      ],
    } : c);

  const removeDim = (index: number) =>
    setConfig(c => c ? {
      ...c,
      reward_dimensions: c.reward_dimensions.filter((_, i) => i !== index),
    } : c);

  const setExtField = (field: keyof ExternalLLMConfig, value: string | boolean) =>
    setConfig(c => c ? {
      ...c,
      external_llm: { ...c.external_llm, [field]: value },
    } : c);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="jcp-panel">
      <button
        className={`jcp-header${isCollapsed ? '' : ' jcp-header--open'}`}
        onClick={handleToggle}
        aria-expanded={!isCollapsed}
      >
        <span className="jcp-header__label">Judge Configuration</span>
        <span className="jcp-header__chevron">▼</span>
      </button>

      <div className={`jcp-body${isCollapsed ? ' jcp-body--collapsed' : ''}`}>
        <div className="jcp-body__inner">
          {isLoading && (
            <p className="jcp-help" style={{ textAlign: 'center' }}>Loading…</p>
          )}

          {!isLoading && config && (
            <>
              {/* Save status banners */}
              {saveStatus === 'success' && (
                <Alert variant="success">Configuration saved successfully.</Alert>
              )}
              {saveStatus === 'error' && (
                <Alert variant="error">{saveError || 'Save failed.'}</Alert>
              )}

              {/* Tab bar */}
              <div className="jcp-tabs">
                {(['prompt', 'reward', 'external'] as Tab[]).map(tab => (
                  <button
                    key={tab}
                    className={`jcp-tab${activeTab === tab ? ' jcp-tab--active' : ''}`}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab === 'prompt' ? 'Judge Prompt'
                      : tab === 'reward' ? 'Reward Function'
                      : 'External LLM'}
                  </button>
                ))}
              </div>

              {/* ── Tab: Judge Prompt ── */}
              {activeTab === 'prompt' && (
                <div className="jcp-tab-content">
                  <label className="jcp-label" htmlFor="jcp-judge-prompt">
                    Base System Prompt
                  </label>
                  <textarea
                    id="jcp-judge-prompt"
                    className="jcp-textarea"
                    rows={14}
                    value={config.judge_prompt}
                    onChange={e => setPrompt(e.target.value)}
                  />
                  <p className="jcp-help">
                    This prompt controls how the judge decides to interrupt and what questions to ask.
                    When left blank, the backend hardcoded default is used.
                  </p>
                </div>
              )}

              {/* ── Tab: Reward Function ── */}
              {activeTab === 'reward' && (
                <div className="jcp-tab-content">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span className="jcp-label" style={{ marginBottom: 0 }}>Scoring Dimensions</span>
                    <span className={`jcp-weight-total ${weightOk ? 'jcp-weight-total--ok' : 'jcp-weight-total--error'}`}>
                      Σ weights = {weightSum.toFixed(3)} {weightOk ? '✓' : '≠ 1.0'}
                    </span>
                  </div>

                  <div className="jcp-dims-list">
                    {/* Header row */}
                    <div className="jcp-dimension-row">
                      <span className="jcp-help">Name</span>
                      <span className="jcp-help" style={{ textAlign: 'center' }}>Weight</span>
                      <span className="jcp-help">Description</span>
                      <span />
                    </div>

                    {config.reward_dimensions.map((dim, i) => (
                      <div key={i} className="jcp-dimension-row">
                        <input
                          className="jcp-input"
                          value={dim.name}
                          placeholder="e.g. clarity"
                          onChange={e => updateDim(i, 'name', e.target.value)}
                        />
                        <input
                          className="jcp-input jcp-weight-input"
                          type="number"
                          step="0.05"
                          min="0"
                          max="1"
                          value={dim.weight}
                          onChange={e => updateDim(i, 'weight', parseFloat(e.target.value) || 0)}
                        />
                        <input
                          className="jcp-input"
                          value={dim.description}
                          placeholder="Description…"
                          onChange={e => updateDim(i, 'description', e.target.value)}
                        />
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => removeDim(i)}
                          disabled={config.reward_dimensions.length <= 1}
                        >
                          ✕
                        </Button>
                      </div>
                    ))}
                  </div>

                  <Button variant="secondary" size="sm" onClick={addDim}>
                    + Add Dimension
                  </Button>

                  <label className="jcp-label" htmlFor="jcp-scoring-template">
                    Scoring Prompt Template (system message)
                  </label>
                  <textarea
                    id="jcp-scoring-template"
                    className="jcp-textarea"
                    rows={6}
                    value={config.scoring_prompt_template}
                    onChange={e => setScoringTemplate(e.target.value)}
                  />
                  <p className="jcp-help">
                    Used as the system message when scoring each argument turn.
                    Leave blank to use the default.
                  </p>
                </div>
              )}

              {/* ── Tab: External LLM ── */}
              {activeTab === 'external' && (
                <div className="jcp-tab-content">
                  <div className="jcp-toggle-row">
                    <button
                      className={`jcp-toggle${config.external_llm.enabled ? ' jcp-toggle--on' : ''}`}
                      onClick={() => setExtField('enabled', !config.external_llm.enabled)}
                      aria-pressed={config.external_llm.enabled}
                    >
                      <span className="jcp-toggle__thumb" />
                    </button>
                    <span className="jcp-toggle-label">
                      {config.external_llm.enabled ? 'External LLM enabled' : 'Use local model tiers'}
                    </span>
                  </div>

                  {config.external_llm.enabled && (
                    <div className="jcp-external-fields">
                      <div className="jcp-field">
                        <label className="jcp-label" htmlFor="jcp-base-url">Base URL</label>
                        <input
                          id="jcp-base-url"
                          className="jcp-input"
                          type="url"
                          placeholder="https://api.openai.com/v1"
                          value={config.external_llm.base_url}
                          onChange={e => setExtField('base_url', e.target.value)}
                        />
                      </div>

                      <div className="jcp-field">
                        <label className="jcp-label" htmlFor="jcp-model">Model</label>
                        <input
                          id="jcp-model"
                          className="jcp-input"
                          placeholder="gpt-4o"
                          value={config.external_llm.model}
                          onChange={e => setExtField('model', e.target.value)}
                        />
                      </div>

                      <div className="jcp-field">
                        <label className="jcp-label" htmlFor="jcp-tier">Apply to tier</label>
                        <select
                          id="jcp-tier"
                          className="jcp-select"
                          value={config.external_llm.tier_override}
                          onChange={e =>
                            setExtField('tier_override', e.target.value as ExternalLLMConfig['tier_override'])
                          }
                        >
                          <option value="LARGE">LARGE — judge questions &amp; arguments</option>
                          <option value="SMALL">SMALL — scoring &amp; agent analysis</option>
                          <option value="BOTH">BOTH — all tiers</option>
                        </select>
                      </div>
                    </div>
                  )}

                  <p className="jcp-help">
                    When enabled, the selected model tier is routed to the external endpoint for the
                    duration of the session. The backend reverts to local models when disabled.
                    Works with any OpenAI-compatible API (OpenAI, Groq, OpenRouter, etc.).
                  </p>
                </div>
              )}

              {/* ── Actions ── */}
              <div className="jcp-actions">
                <Button variant="ghost" size="sm" onClick={handleReset}>
                  Reset to defaults
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSave}
                  isLoading={isSaving}
                  disabled={!weightOk || isSaving}
                >
                  Save
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
