/**
 * System Configuration Panel
 *
 * Collapsible panel with three tabs:
 *   • Models  — per-tier runtime overrides for LARGE / SMALL / TINY
 *   • TTS     — voice, model, base URL
 *   • STT     — provider (openai / local), model, device, compute type
 *
 * API keys are never shown or accepted here; they are set via env vars on the server.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '../multi-agent/components/ui/Button';
import { Alert } from '../multi-agent/components/ui/Alert';
import './system-config.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TierConfig {
  enabled: boolean;
  base_url: string;
  model: string;
}

interface ModelRuntimeConfig {
  large: TierConfig;
  small: TierConfig;
  tiny:  TierConfig;
}

interface TTSConfig {
  enabled: boolean;
  base_url: string;
  voice: string;
  model: string;
}

interface STTConfig {
  provider: string;
  base_url: string;
  model: string;
  whisper_model: string;
  device: string;
  compute_type: string;
}

type Tab = 'models' | 'tts' | 'stt';
type SaveStatus = 'idle' | 'saving' | 'success' | 'error';

const TTS_VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'onyx', 'nova', 'shimmer', 'verse'] as const;
const WHISPER_MODELS = ['tiny', 'base', 'small', 'medium', 'large-v3'] as const;
const COMPUTE_TYPES = ['float16', 'int8_float16', 'int8'] as const;

const TIER_META: Record<keyof ModelRuntimeConfig, { label: string; desc: string }> = {
  large: { label: 'LARGE',  desc: 'judge questions, counter-arguments' },
  small: { label: 'SMALL',  desc: 'scoring, agent analysis, summaries' },
  tiny:  { label: 'TINY',   desc: 'issue extraction, agenda generation' },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SystemConfigPanel() {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('models');

  const [models, setModels] = useState<ModelRuntimeConfig | null>(null);
  const [tts, setTts] = useState<TTSConfig | null>(null);
  const [stt, setStt] = useState<STTConfig | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState('');

  // ── Load all three configs on first expand ────────────────────────────

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [mRes, tRes, sRes] = await Promise.all([
        fetch(`${API_URL}/api/model-config`),
        fetch(`${API_URL}/api/tts-config`),
        fetch(`${API_URL}/api/stt-config`),
      ]);
      if (!mRes.ok || !tRes.ok || !sRes.ok) throw new Error('Failed to load config');
      const [mData, tData, sData] = await Promise.all([mRes.json(), tRes.json(), sRes.json()]);
      setModels(mData);
      setTts(tData);
      setStt(sData);
    } catch (err) {
      console.error('[SystemConfigPanel] load failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleToggle = () => {
    if (isCollapsed && models === null) {
      loadAll();
    }
    setIsCollapsed(prev => !prev);
  };

  // ── Reset ─────────────────────────────────────────────────────────────

  const handleReset = async () => {
    try {
      const [mRes, tRes, sRes] = await Promise.all([
        fetch(`${API_URL}/api/model-config/default`),
        fetch(`${API_URL}/api/tts-config/default`),
        fetch(`${API_URL}/api/stt-config/default`),
      ]);
      const [mData, tData, sData] = await Promise.all([mRes.json(), tRes.json(), sRes.json()]);
      setModels(mData);
      setTts(tData);
      setStt(sData);
      setSaveStatus('idle');
    } catch (err) {
      console.error('[SystemConfigPanel] reset failed:', err);
    }
  };

  // ── Success auto-clear (cleanup safe on unmount) ─────────────────────

  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveStatus === 'success') {
      successTimerRef.current = setTimeout(() => setSaveStatus('idle'), 3000);
    }
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, [saveStatus]);

  // ── Save all three configs in parallel ───────────────────────────────

  const handleSave = async () => {
    if (!models && !tts && !stt) return;
    setSaveStatus('saving');
    setSaveError('');
    try {
      const posts: Promise<Response>[] = [];
      if (models) posts.push(fetch(`${API_URL}/api/model-config`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(models),
      }));
      if (tts) posts.push(fetch(`${API_URL}/api/tts-config`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tts),
      }));
      if (stt) posts.push(fetch(`${API_URL}/api/stt-config`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stt),
      }));
      const results = await Promise.all(posts);
      for (const res of results) {
        if (!res.ok) {
          const detail = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error(detail.detail || res.statusText);
        }
      }
      setSaveStatus('success');
    } catch (err) {
      setSaveStatus('error');
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  };

  // ── Tier updaters ─────────────────────────────────────────────────────

  const setTierField = (tier: keyof ModelRuntimeConfig, field: keyof TierConfig, value: string | boolean) =>
    setModels(m => m ? { ...m, [tier]: { ...m[tier], [field]: value } } : m);

  // ── TTS updaters ──────────────────────────────────────────────────────

  const setTtsField = (field: keyof TTSConfig, value: string | boolean) =>
    setTts(t => t ? { ...t, [field]: value } : t);

  // ── STT updaters ──────────────────────────────────────────────────────

  const setSttField = (field: keyof STTConfig, value: string) =>
    setStt(s => s ? { ...s, [field]: value } : s);

  // ── Render ────────────────────────────────────────────────────────────

  const isSaving = saveStatus === 'saving';

  return (
    <div className="scp-panel">
      <button
        className={`scp-header${isCollapsed ? '' : ' scp-header--open'}`}
        onClick={handleToggle}
        aria-expanded={!isCollapsed}
      >
        <span className="scp-header__label">System Configuration</span>
        <span className="scp-header__chevron">▼</span>
      </button>

      <div className={`scp-body${isCollapsed ? ' scp-body--collapsed' : ''}`}>
        <div className="scp-body__inner">
          {isLoading && (
            <p className="scp-help" style={{ textAlign: 'center' }}>Loading…</p>
          )}

          {!isLoading && models && tts && stt && (
            <>
              {saveStatus === 'success' && (
                <Alert variant="success">Configuration saved.</Alert>
              )}
              {saveStatus === 'error' && (
                <Alert variant="error">{saveError || 'Save failed.'}</Alert>
              )}

              {/* Tab bar */}
              <div className="scp-tabs">
                {(['models', 'tts', 'stt'] as Tab[]).map(tab => (
                  <button
                    key={tab}
                    className={`scp-tab${activeTab === tab ? ' scp-tab--active' : ''}`}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab === 'models' ? 'Models' : tab === 'tts' ? 'TTS' : 'STT'}
                  </button>
                ))}
              </div>

              {/* ── Tab: Models ── */}
              {activeTab === 'models' && (
                <div className="scp-tab-content">
                  <p className="scp-help">
                    Override each model tier at runtime without restarting the server.
                    Disabled tiers fall back to env-var configuration.
                  </p>

                  {(Object.entries(models) as [keyof ModelRuntimeConfig, TierConfig][]).map(([key, tier]) => (
                    <div
                      key={key}
                      className={`scp-tier${tier.enabled ? ' scp-tier--enabled' : ''}`}
                    >
                      <div className="scp-tier__header">
                        <span className="scp-tier__name">{TIER_META[key].label}</span>
                        <span className="scp-tier__desc">{TIER_META[key].desc}</span>
                        <button
                          className={`scp-toggle${tier.enabled ? ' scp-toggle--on' : ''}`}
                          onClick={() => setTierField(key, 'enabled', !tier.enabled)}
                          aria-pressed={tier.enabled}
                        >
                          <span className="scp-toggle__thumb" />
                        </button>
                      </div>

                      {tier.enabled && (
                        <div className="scp-tier__fields">
                          <div className="scp-field">
                            <label className="scp-label">Base URL</label>
                            <input
                              className="scp-input"
                              type="url"
                              placeholder="https://openrouter.ai/api/v1"
                              value={tier.base_url}
                              onChange={e => setTierField(key, 'base_url', e.target.value)}
                            />
                          </div>
                          <div className="scp-field">
                            <label className="scp-label">Model</label>
                            <input
                              className="scp-input"
                              placeholder="openai/gpt-4o"
                              value={tier.model}
                              onChange={e => setTierField(key, 'model', e.target.value)}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* ── Tab: TTS ── */}
              {activeTab === 'tts' && (
                <div className="scp-tab-content">
                  <div className="scp-toggle-row">
                    <button
                      className={`scp-toggle${tts.enabled ? ' scp-toggle--on' : ''}`}
                      onClick={() => setTtsField('enabled', !tts.enabled)}
                      aria-pressed={tts.enabled}
                    >
                      <span className="scp-toggle__thumb" />
                    </button>
                    <span className="scp-toggle-label">
                      {tts.enabled ? 'TTS enabled' : 'TTS disabled'}
                    </span>
                  </div>

                  {tts.enabled && (
                    <>
                      <div className="scp-tier__fields">
                        <div className="scp-field">
                          <label className="scp-label" htmlFor="scp-tts-voice">Voice</label>
                          <select
                            id="scp-tts-voice"
                            className="scp-select"
                            value={tts.voice}
                            onChange={e => setTtsField('voice', e.target.value)}
                          >
                            {TTS_VOICES.map(v => (
                              <option key={v} value={v}>{v}</option>
                            ))}
                          </select>
                        </div>
                        <div className="scp-field">
                          <label className="scp-label" htmlFor="scp-tts-model">Model</label>
                          <input
                            id="scp-tts-model"
                            className="scp-input"
                            placeholder="openai/gpt-audio-mini"
                            value={tts.model}
                            onChange={e => setTtsField('model', e.target.value)}
                          />
                        </div>
                        <div className="scp-field" style={{ gridColumn: '1 / -1' }}>
                          <label className="scp-label" htmlFor="scp-tts-url">Base URL</label>
                          <input
                            id="scp-tts-url"
                            className="scp-input"
                            type="url"
                            placeholder="https://openrouter.ai/api/v1"
                            value={tts.base_url}
                            onChange={e => setTtsField('base_url', e.target.value)}
                          />
                        </div>
                      </div>
                      <p className="scp-help">
                        Leave Base URL blank to use the default OpenAI endpoint.
                        API keys are configured via server env vars.
                      </p>
                    </>
                  )}

                  {!tts.enabled && (
                    <p className="scp-help">
                      Judge questions and introductions will be delivered as text only.
                    </p>
                  )}
                </div>
              )}

              {/* ── Tab: STT ── */}
              {activeTab === 'stt' && (
                <div className="scp-tab-content">
                  <div className="scp-field">
                    <span className="scp-label">Provider</span>
                    <div className="scp-radios">
                      {(['openai', 'local'] as const).map(p => (
                        <label
                          key={p}
                          className={`scp-radio-option${stt.provider === p ? ' scp-radio-option--selected' : ''}`}
                        >
                          <input
                            type="radio"
                            name="scp-stt-provider"
                            value={p}
                            checked={stt.provider === p}
                            onChange={() => setSttField('provider', p)}
                          />
                          {p === 'openai' ? 'OpenAI (cloud)' : 'Local (faster-whisper)'}
                        </label>
                      ))}
                    </div>
                  </div>

                  {stt.provider === 'openai' && (
                    <>
                      <div className="scp-field">
                        <label className="scp-label" htmlFor="scp-stt-model">Model</label>
                        <input
                          id="scp-stt-model"
                          className="scp-input"
                          placeholder="openai/gpt-audio-mini"
                          value={stt.model}
                          onChange={e => setSttField('model', e.target.value)}
                        />
                      </div>
                      <div className="scp-field">
                        <label className="scp-label" htmlFor="scp-stt-url">Base URL</label>
                        <input
                          id="scp-stt-url"
                          className="scp-input"
                          type="url"
                          placeholder="https://openrouter.ai/api/v1"
                          value={stt.base_url}
                          onChange={e => setSttField('base_url', e.target.value)}
                        />
                      </div>
                      <p className="scp-help">
                        Leave Base URL blank to use the default OpenAI endpoint.
                        API keys are configured via server env vars.
                      </p>
                    </>
                  )}

                  {stt.provider === 'local' && (
                    <>
                      <div className="scp-tier__fields">
                        <div className="scp-field">
                          <label className="scp-label" htmlFor="scp-whisper-model">Model size</label>
                          <select
                            id="scp-whisper-model"
                            className="scp-select"
                            value={stt.whisper_model}
                            onChange={e => setSttField('whisper_model', e.target.value)}
                          >
                            {WHISPER_MODELS.map(m => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>
                        </div>
                        <div className="scp-field">
                          <label className="scp-label" htmlFor="scp-stt-device">Device</label>
                          <select
                            id="scp-stt-device"
                            className="scp-select"
                            value={stt.device}
                            onChange={e => setSttField('device', e.target.value)}
                          >
                            <option value="cuda">cuda (GPU)</option>
                            <option value="cpu">cpu</option>
                          </select>
                        </div>
                        <div className="scp-field" style={{ gridColumn: '1 / -1' }}>
                          <label className="scp-label" htmlFor="scp-compute-type">Compute type</label>
                          <select
                            id="scp-compute-type"
                            className="scp-select"
                            value={stt.compute_type}
                            onChange={e => setSttField('compute_type', e.target.value)}
                          >
                            {COMPUTE_TYPES.map(c => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <p className="scp-help">
                        Changes take effect on the next recording session.
                        The model is loaded lazily on first use.
                      </p>
                    </>
                  )}
                </div>
              )}

              {/* ── Actions ── */}
              <div className="scp-actions">
                <Button variant="ghost" size="sm" onClick={handleReset}>
                  Reset to defaults
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSave}
                  isLoading={isSaving}
                  disabled={isSaving}
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
