/**
 * Opponent Configuration Panel
 *
 * Collapsible panel with two tabs:
 *   • Prompt     — system prompt controlling the opponent's persona & behaviour
 *   • Strategy   — aggressiveness slider + enabled response types
 *
 * Follows the same self-managed pattern as JudgeConfigPanel.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '../multi-agent/components/ui/Button';
import { Alert } from '../multi-agent/components/ui/Alert';
import './opponent-config.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// ---------------------------------------------------------------------------
// Types (mirror backend dataclasses)
// ---------------------------------------------------------------------------

interface OpponentConfig {
  system_prompt: string;
  aggressiveness: number;
  enabled_types: string[];
  voice_id: string;
}

type Tab = 'prompt' | 'strategy';
type SaveStatus = 'idle' | 'success' | 'error';

const RESPONSE_TYPES = [
  { id: 'rebuttal',     label: 'Rebuttal',     desc: 'Directly counters petitioner arguments' },
  { id: 'exploitation', label: 'Exploitation',  desc: 'Leverages weaknesses judges exposed' },
  { id: 'affirmative',  label: 'Affirmative',   desc: 'Proactively argues missed points' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OpponentConfigPanel() {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('prompt');
  const [config, setConfig] = useState<OpponentConfig | null>(null);
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

  // ── Load config from backend ──────────────────────────────────────────

  const loadConfig = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/opponent-config`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: OpponentConfig = await res.json();
      setConfig(data);
    } catch (err) {
      console.error('[OpponentConfigPanel] load failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleToggle = () => {
    if (isCollapsed && config === null) {
      loadConfig();
    }
    setIsCollapsed(prev => !prev);
  };

  // ── Reset to defaults ─────────────────────────────────────────────────

  const handleReset = async () => {
    try {
      const res = await fetch(`${API_URL}/api/opponent-config/default`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: OpponentConfig = await res.json();
      setConfig(data);
      setSaveStatus('idle');
    } catch (err) {
      console.error('[OpponentConfigPanel] reset failed:', err);
    }
  };

  // ── Save ──────────────────────────────────────────────────────────────

  const hasEnabledType = config ? config.enabled_types.length > 0 : true;

  const handleSave = async () => {
    if (!config || !hasEnabledType) return;
    setIsSaving(true);
    setSaveStatus('idle');
    setSaveError('');
    try {
      const res = await fetch(`${API_URL}/api/opponent-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(detail.detail || res.statusText);
      }
      setSaveStatus('success');
    } catch (err) {
      setSaveStatus('error');
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  // ── Updaters ──────────────────────────────────────────────────────────

  const setPrompt = (value: string) =>
    setConfig(c => c ? { ...c, system_prompt: value } : c);

  const setAggressiveness = (value: number) =>
    setConfig(c => c ? { ...c, aggressiveness: value } : c);

  const toggleType = (typeId: string) =>
    setConfig(c => {
      if (!c) return c;
      const has = c.enabled_types.includes(typeId);
      return {
        ...c,
        enabled_types: has
          ? c.enabled_types.filter(t => t !== typeId)
          : [...c.enabled_types, typeId],
      };
    });


  // ── Aggressiveness label ──────────────────────────────────────────────

  function aggressivenessLabel(v: number): string {
    if (v <= 0.25) return 'Mild';
    if (v <= 0.5)  return 'Moderate';
    if (v <= 0.75) return 'Assertive';
    return 'Aggressive';
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="ocp-panel">
      <button
        className={`ocp-header${isCollapsed ? '' : ' ocp-header--open'}`}
        onClick={handleToggle}
        aria-expanded={!isCollapsed}
      >
        <span className="ocp-header__label">Opponent Configuration</span>
        <span className="ocp-header__chevron">▼</span>
      </button>

      <div className={`ocp-body${isCollapsed ? ' ocp-body--collapsed' : ''}`}>
        <div className="ocp-body__inner">
          {isLoading && (
            <p className="ocp-help" style={{ textAlign: 'center' }}>Loading…</p>
          )}

          {!isLoading && config && (
            <>
              {saveStatus === 'success' && (
                <Alert variant="success">Opponent configuration saved.</Alert>
              )}
              {saveStatus === 'error' && (
                <Alert variant="error">{saveError || 'Save failed.'}</Alert>
              )}

              {/* Tab bar */}
              <div className="ocp-tabs">
                {(['prompt', 'strategy'] as Tab[]).map(tab => (
                  <button
                    key={tab}
                    className={`ocp-tab${activeTab === tab ? ' ocp-tab--active' : ''}`}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab === 'prompt' ? 'Opponent Prompt' : 'Strategy'}
                  </button>
                ))}
              </div>

              {/* ── Tab: Prompt ── */}
              {activeTab === 'prompt' && (
                <div className="ocp-tab-content">
                  <label className="ocp-label" htmlFor="ocp-system-prompt">
                    System Prompt
                  </label>
                  <textarea
                    id="ocp-system-prompt"
                    className="ocp-textarea"
                    rows={12}
                    value={config.system_prompt}
                    onChange={e => setPrompt(e.target.value)}
                  />
                  <p className="ocp-help">
                    Controls the opponent's persona, tone, and argument style.
                    The opponent always receives the opposing brief as context.
                  </p>
                </div>
              )}

              {/* ── Tab: Strategy ── */}
              {activeTab === 'strategy' && (
                <div className="ocp-tab-content">
                  {/* Aggressiveness slider */}
                  <div className="ocp-field">
                    <div className="ocp-slider-header">
                      <label className="ocp-label" htmlFor="ocp-aggressiveness">
                        Aggressiveness
                      </label>
                      <span className="ocp-slider-value">
                        {config.aggressiveness.toFixed(2)} — {aggressivenessLabel(config.aggressiveness)}
                      </span>
                    </div>
                    <input
                      id="ocp-aggressiveness"
                      className="ocp-slider"
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={config.aggressiveness}
                      onChange={e => setAggressiveness(parseFloat(e.target.value))}
                    />
                    <p className="ocp-help">
                      Low = cautious, measured responses. High = sharp, aggressive rebuttals.
                      Maps to LLM temperature (0.3–1.0).
                    </p>
                  </div>

                  {/* Response types */}
                  <div className="ocp-field">
                    <span className="ocp-label">Enabled Response Types</span>
                    {!hasEnabledType && (
                      <p className="ocp-error-text">At least one type must be enabled.</p>
                    )}
                    <div className="ocp-types-list">
                      {RESPONSE_TYPES.map(rt => {
                        const checked = config.enabled_types.includes(rt.id);
                        return (
                          <label key={rt.id} className="ocp-type-row">
                            <input
                              type="checkbox"
                              className="ocp-checkbox"
                              checked={checked}
                              onChange={() => toggleType(rt.id)}
                            />
                            <div className="ocp-type-info">
                              <span className="ocp-type-name">{rt.label}</span>
                              <span className="ocp-type-desc">{rt.desc}</span>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Actions ── */}
              <div className="ocp-actions">
                <Button variant="ghost" size="sm" onClick={handleReset}>
                  Reset to defaults
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSave}
                  isLoading={isSaving}
                  disabled={!hasEnabledType || isSaving}
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
