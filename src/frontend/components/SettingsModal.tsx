import { useState, useEffect, useCallback, useRef } from 'react';
import './SettingsModal.css';

interface AllSettings {
  ollama_host?: string;
  openai_api_key?: string;
  openai_base_url?: string;
  openrouter_api_key?: string;
  openrouter_base_url?: string;
  nine_router_host?: string;
  nine_router_api_key?: string;
  custom_openai_base_url?: string;
  custom_openai_api_key?: string;
  anthropic_api_key?: string;
  fcc_server_url?: string;
  user_name?: string;
  user_role?: string;
  base_instructions?: string;
  require_tool_approval?: string;
  skills_inline?: string;
  model_pricing?: string;
  onboarding_done?: string;
}

interface MemoryEntry {
  id: string;
  type: string;
  content: string;
  embedding: string;
  metadata: string | null;
  sourceId: string | null;
  createdAt: number;
}

type Tab = 'ai' | 'profile' | 'instructions' | 'behaviour' | 'memories' | 'training' | 'about';

interface TrainingStats {
  pairs: number;
  explicit: number;
  edited: number;
  implicit: number;
  distillation: number;
  topChats: number;
  oldest: number | null;
  newest: number | null;
}
type LlmMode = 'ollama' | 'openai' | 'openrouter' | '9router' | 'custom';

const STORAGE_KEY = 'vanaila_onboarding_done';

async function saveSetting(key: string, value: string) {
  const response = await fetch(`/api/settings/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  // Swallowing this hid every write made while the backend was down, which
  // looked like settings silently resetting themselves.
  if (!response.ok) throw new Error(`Failed to save ${key} (HTTP ${response.status})`);
}

/**
 * Persists shortly after the user stops typing, skipping the initial render.
 * Saving on blur alone lost edits whenever the modal was dismissed with Escape
 * or a backdrop click, neither of which fires a blur first.
 */
function useAutosave(value: string, action: () => void | Promise<void>, ready: boolean) {
  const actionRef = useRef(action);
  actionRef.current = action;
  const baseline = useRef<string | null>(null);
  const pendingValueRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    // First pass after load records the stored value rather than re-saving it.
    if (baseline.current === null) {
      baseline.current = value;
      return;
    }
    if (baseline.current === value) return;

    pendingValueRef.current = value;
    const timer = setTimeout(() => {
      baseline.current = value;
      pendingValueRef.current = null;
      void actionRef.current();
    }, 400);

    return () => {
      clearTimeout(timer);
      if (pendingValueRef.current !== null && pendingValueRef.current !== baseline.current) {
        baseline.current = pendingValueRef.current;
        pendingValueRef.current = null;
        void actionRef.current();
      }
    };
  }, [value, ready]);
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<Tab>('ai');
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<string | null>(null);

  // AI Connection
  const [llmMode, setLlmMode] = useState<LlmMode>('ollama');
  const [ollamaHost, setOllamaHost] = useState('http://localhost:11434');
  const [openaiKey, setOpenaiKey] = useState('');
  const [openrouterKey, setOpenrouterKey] = useState('');
  const [nineRouterHost, setNineRouterHost] = useState('http://localhost:20128/v1');
  const [nineRouterKey, setNineRouterKey] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customKey, setCustomKey] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');

  // Profile
  const [userName, setUserName] = useState('');
  const [userRole, setUserRole] = useState('');

  // Claude Code & Free Claude Code (FCC)
  const [anthropicKey, setAnthropicKey] = useState('');
  const [fccServerUrl, setFccServerUrl] = useState('');

  // Instructions
  const [baseInstructions, setBaseInstructions] = useState('');

  // Behaviour
  const [requireApproval, setRequireApproval] = useState(true);
  const [skillsInline, setSkillsInline] = useState(false);
  const [modelPricing, setModelPricing] = useState('');
  const [pricingError, setPricingError] = useState<string | null>(null);

  // Memories
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(false);
  const [memoriesDeleting, setMemoriesDeleting] = useState<string | null>(null);
  const memoriesFetched = useRef(false);

  // Training
  const [trainingStats, setTrainingStats] = useState<TrainingStats | null>(null);
  const [trainingLoading, setTrainingLoading] = useState(false);
  const [trainingExporting, setTrainingExporting] = useState(false);
  const [trainingResult, setTrainingResult] = useState<{ path: string; pairs: number; explicit: number; distilled: number; format: string } | null>(null);
  const [trainingError, setTrainingError] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<'sharegpt' | 'alpaca'>('sharegpt');
  const [includeDistillation, setIncludeDistillation] = useState(false);
  const trainingFetched = useRef(false);

  const flash = (label: string) => {
    setSaved(label);
    setTimeout(() => setSaved(null), 1800);
  };

  // Load all settings at once on open
  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data: { settings?: AllSettings }) => {
        const s = data.settings ?? {};
        if (s.ollama_host) setOllamaHost(s.ollama_host);
        if (s.openrouter_api_key) {
          setLlmMode('openrouter');
          setOpenrouterKey(s.openrouter_api_key);
        } else if (s.nine_router_api_key) {
          setLlmMode('9router');
          setNineRouterKey(s.nine_router_api_key);
        } else if (s.custom_openai_api_key || s.custom_openai_base_url) {
          setLlmMode('custom');
          if (s.custom_openai_api_key) setCustomKey(s.custom_openai_api_key);
        } else if (s.openai_api_key) {
          if (s.openai_base_url?.includes('openrouter')) {
            setLlmMode('openrouter');
            setOpenrouterKey(s.openai_api_key);
          } else {
            setLlmMode('openai');
            setOpenaiKey(s.openai_api_key);
          }
        } else {
          setLlmMode('ollama');
        }
        if (s.openrouter_api_key) setOpenrouterKey(s.openrouter_api_key);
        if (s.openai_api_key && !s.openai_base_url?.includes('openrouter')) setOpenaiKey(s.openai_api_key);
        if (s.nine_router_host) setNineRouterHost(s.nine_router_host);
        if (s.nine_router_api_key) setNineRouterKey(s.nine_router_api_key);
        if (s.custom_openai_base_url) setCustomBaseUrl(s.custom_openai_base_url);
        if (s.custom_openai_api_key) setCustomKey(s.custom_openai_api_key);
        if (s.anthropic_api_key) setAnthropicKey(s.anthropic_api_key);
        if (s.fcc_server_url) setFccServerUrl(s.fcc_server_url);
        if (s.user_name) setUserName(s.user_name);
        if (s.user_role) setUserRole(s.user_role);
        if (s.base_instructions) setBaseInstructions(s.base_instructions);
        // Approval defaults to on, so only an explicit 'false' turns it off.
        setRequireApproval(s.require_tool_approval !== 'false');
        setSkillsInline(s.skills_inline === 'true');
        if (s.model_pricing) setModelPricing(s.model_pricing);
      })
      .catch(() => {/* best-effort */})
      .finally(() => setLoading(false));
  }, []);

  // Fetch memories when tab opens
  useEffect(() => {
    if (activeTab !== 'memories' || memoriesFetched.current) return;
    setMemoriesLoading(true);
    fetch('/api/memory')
      .then((r) => r.json())
      .then((data: { memories: MemoryEntry[] }) => setMemories(data.memories ?? []))
      .catch(() => {})
      .finally(() => {
        setMemoriesLoading(false);
        memoriesFetched.current = true;
      });
  }, [activeTab]);

  // Fetch training stats when tab opens
  useEffect(() => {
    if (activeTab !== 'training' || trainingFetched.current) return;
    setTrainingLoading(true);
    fetch('/api/training/stats')
      .then((r) => r.json())
      .then((data: TrainingStats) => setTrainingStats(data))
      .catch(() => setTrainingError('Failed to load stats'))
      .finally(() => {
        setTrainingLoading(false);
        trainingFetched.current = true;
      });
  }, [activeTab]);

  const refreshTrainingStats = async () => {
    setTrainingLoading(true);
    setTrainingError(null);
    try {
      const r = await fetch('/api/training/stats');
      const data = (await r.json()) as TrainingStats;
      setTrainingStats(data);
    } catch {
      setTrainingError('Failed to load stats');
    } finally {
      setTrainingLoading(false);
    }
  };

  const exportTrainingData = async () => {
    setTrainingExporting(true);
    setTrainingError(null);
    setTrainingResult(null);
    try {
      const response = await fetch('/api/training/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: exportFormat, includeDistillation }),
      });
      const data = (await response.json()) as { path?: string; pairs?: number; explicit?: number; distilled?: number; format?: string; error?: string };
      if (!response.ok || data.error) {
        setTrainingError(data.error ?? `Export failed (HTTP ${response.status})`);
        return;
      }
      if (data.path && typeof data.pairs === 'number' && data.format) {
        setTrainingResult({ path: data.path, pairs: data.pairs, explicit: data.explicit ?? data.pairs, distilled: data.distilled ?? 0, format: data.format });
      }
    } catch (err) {
      setTrainingError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setTrainingExporting(false);
    }
  };

  const refreshMemories = async () => {
    setMemoriesLoading(true);
    try {
      const r = await fetch('/api/memory');
      const data = (await r.json()) as { memories: MemoryEntry[] };
      setMemories(data.memories ?? []);
    } catch {
      // best-effort
    }
    setMemoriesLoading(false);
  };

  const deleteMemory = async (id: string) => {
    setMemoriesDeleting(id);
    try {
      await fetch(`/api/memory/${id}`, { method: 'DELETE' });
      setMemories((prev) => prev.filter((m) => m.id !== id));
    } catch {
      // best-effort
    }
    setMemoriesDeleting(null);
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  /** Runs a group of writes, reporting failure instead of dropping it. */
  const persist = useCallback(async (writes: Array<[string, string]>) => {
    try {
      for (const [key, value] of writes) await saveSetting(key, value);
      flash('Saved');
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Save failed');
    }
  }, []);

  const saveOllamaHost = useCallback(
    () => persist([['ollama_host', ollamaHost]]),
    [persist, ollamaHost],
  );

  const saveOpenaiKey = useCallback(
    () => persist([
      ['openai_api_key', openaiKey.trim()],
      ['openai_base_url', 'https://api.openai.com/v1'],
    ]),
    [persist, openaiKey],
  );

  const saveOpenrouterKey = useCallback(
    () => persist([
      ['openrouter_api_key', openrouterKey.trim()],
      ['openrouter_base_url', 'https://openrouter.ai/api/v1'],
    ]),
    [persist, openrouterKey],
  );

  const saveNineRouterConfig = useCallback(
    () => persist([
      ['nine_router_host', nineRouterHost.trim()],
      ['nine_router_api_key', nineRouterKey.trim()],
    ]),
    [persist, nineRouterHost, nineRouterKey],
  );

  const saveCustomConfig = useCallback(
    () => persist([
      ['custom_openai_base_url', customBaseUrl.trim()],
      ['custom_openai_api_key', customKey.trim()],
    ]),
    [persist, customBaseUrl, customKey],
  );

  const saveAnthropicKey = useCallback(
    () => persist([['anthropic_api_key', anthropicKey.trim()]]),
    [persist, anthropicKey],
  );

  const saveFccServerUrl = useCallback(
    () => persist([['fcc_server_url', fccServerUrl.trim()]]),
    [persist, fccServerUrl],
  );

  // Profile fields save even when emptied, so clearing one actually sticks.
  const saveUserName = useCallback(
    () => persist([['user_name', userName.trim()]]),
    [persist, userName],
  );

  const saveUserRole = useCallback(
    () => persist([['user_role', userRole.trim()]]),
    [persist, userRole],
  );

  const saveBaseInstructions = useCallback(
    () => persist([['base_instructions', baseInstructions.trim()]]),
    [persist, baseInstructions],
  );

  const toggleApproval = useCallback(
    (next: boolean) => {
      setRequireApproval(next);
      void persist([['require_tool_approval', next ? 'true' : 'false']]);
    },
    [persist],
  );

  const toggleSkillsInline = useCallback(
    (next: boolean) => {
      setSkillsInline(next);
      void persist([['skills_inline', next ? 'true' : 'false']]);
    },
    [persist],
  );

  // Saved only when it parses, so a half-typed object cannot break cost display.
  const saveModelPricing = useCallback(() => {
    const raw = modelPricing.trim();
    if (!raw) {
      setPricingError(null);
      return persist([['model_pricing', '']]);
    }

    try {
      JSON.parse(raw);
      setPricingError(null);
      return persist([['model_pricing', raw]]);
    } catch (error) {
      setPricingError(error instanceof Error ? error.message : 'Invalid JSON');
      return Promise.resolve();
    }
  }, [persist, modelPricing]);

  // Autosave every field so an Escape or backdrop dismissal cannot lose edits.
  const ready = !loading;
  useAutosave(ollamaHost, saveOllamaHost, ready);
  useAutosave(openaiKey, saveOpenaiKey, ready);
  useAutosave(openrouterKey, saveOpenrouterKey, ready);
  useAutosave(nineRouterHost, saveNineRouterConfig, ready);
  useAutosave(nineRouterKey, saveNineRouterConfig, ready);
  useAutosave(customBaseUrl, saveCustomConfig, ready);
  useAutosave(customKey, saveCustomConfig, ready);
  useAutosave(anthropicKey, saveAnthropicKey, ready);
  useAutosave(fccServerUrl, saveFccServerUrl, ready);
  useAutosave(userName, saveUserName, ready);
  useAutosave(userRole, saveUserRole, ready);
  useAutosave(baseInstructions, saveBaseInstructions, ready);

  const testConnection = async () => {
    setTestStatus('testing');
    try {
      if (llmMode === 'ollama') await saveOllamaHost();
      else if (llmMode === 'openai') await saveOpenaiKey();
      else if (llmMode === 'openrouter') await saveOpenrouterKey();
      else if (llmMode === '9router') await saveNineRouterConfig();
      else if (llmMode === 'custom') await saveCustomConfig();

      const res = await fetch('/api/models');
      if (res.ok) {
        const data = (await res.json()) as { models?: string[] };
        const count = Array.isArray(data.models) ? data.models.length : 0;
        setTestStatus(count > 0 ? 'ok' : 'fail');
      } else {
        setTestStatus('fail');
      }
    } catch {
      setTestStatus('fail');
    }
    setTimeout(() => setTestStatus('idle'), 3000);
  };

  const rerunSetup = async () => {
    await saveSetting('onboarding_done', 'false');
    localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  };

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: 'ai',           label: 'AI Connection',  icon: '🧠' },
    { id: 'profile',      label: 'Profile',         icon: '🪪' },
    { id: 'instructions', label: 'Instructions',    icon: '📋' },
    { id: 'behaviour',    label: 'Behaviour',       icon: '⚙️' },
    { id: 'memories',     label: 'Memories',        icon: '🧩' },
    { id: 'training',     label: 'Training',        icon: '🧪' },
    { id: 'about',        label: 'About',           icon: 'ℹ️' },
  ];

  return (
    <div
      className="settings-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="settings-card">
        {/* Header */}
        <div className="settings-header">
          <h2 className="settings-title">Settings</h2>
          {saved && <span className="settings-saved-badge">✓ {saved}</span>}
          <button
            type="button"
            className="settings-close"
            aria-label="Close settings"
            onClick={onClose}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tab bar */}
        <div className="settings-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeTab === t.id}
              className={`settings-tab ${activeTab === t.id ? 'is-active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="settings-body">
          {loading ? (
            <div className="settings-loading">Loading…</div>
          ) : (
            <>
              {/* ── AI Connection ── */}
              {activeTab === 'ai' && (
                <div className="settings-section">
                  <div className="settings-llm-tabs">
                    <button
                      type="button"
                      className={`settings-llm-tab ${llmMode === 'ollama' ? 'is-active' : ''}`}
                      onClick={() => setLlmMode('ollama')}
                    >🦙 Ollama (Local)</button>
                    <button
                      type="button"
                      className={`settings-llm-tab ${llmMode === 'openai' ? 'is-active' : ''}`}
                      onClick={() => setLlmMode('openai')}
                    >⚡ OpenAI</button>
                    <button
                      type="button"
                      className={`settings-llm-tab ${llmMode === 'openrouter' ? 'is-active' : ''}`}
                      onClick={() => setLlmMode('openrouter')}
                    >🔀 OpenRouter</button>
                    <button
                      type="button"
                      className={`settings-llm-tab ${llmMode === '9router' ? 'is-active' : ''}`}
                      onClick={() => setLlmMode('9router')}
                    >🔄 9Router</button>
                    <button
                      type="button"
                      className={`settings-llm-tab ${llmMode === 'custom' ? 'is-active' : ''}`}
                      onClick={() => setLlmMode('custom')}
                    >🧩 Custom</button>
                  </div>

                  {llmMode === 'ollama' && (
                    <div className="settings-field">
                      <label className="settings-label">Ollama Host URL</label>
                      <input
                        className="settings-input"
                        value={ollamaHost}
                        onChange={(e) => setOllamaHost(e.target.value)}
                        onBlur={saveOllamaHost}
                        placeholder="http://localhost:11434"
                      />
                      <p className="settings-hint">Default works if Ollama is running locally. Change for remote hosts.</p>
                    </div>
                  )}

                  {llmMode === 'openai' && (
                    <div className="settings-field">
                      <label className="settings-label">OpenAI API Key</label>
                      <input
                        className="settings-input"
                        type="password"
                        value={openaiKey}
                        onChange={(e) => setOpenaiKey(e.target.value)}
                        onBlur={saveOpenaiKey}
                        placeholder="sk-..."
                      />
                      <p className="settings-hint">Get your key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com</a></p>
                    </div>
                  )}

                  {llmMode === 'openrouter' && (
                    <div className="settings-field">
                      <label className="settings-label">OpenRouter API Key</label>
                      <input
                        className="settings-input"
                        type="password"
                        value={openrouterKey}
                        onChange={(e) => setOpenrouterKey(e.target.value)}
                        onBlur={saveOpenrouterKey}
                        placeholder="sk-or-..."
                      />
                      <p className="settings-hint">Access 100+ models at <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">openrouter.ai</a></p>
                    </div>
                  )}

                  {llmMode === '9router' && (
                    <div className="settings-field">
                      <label className="settings-label">9Router Host URL</label>
                      <input
                        className="settings-input"
                        value={nineRouterHost}
                        onChange={(e) => setNineRouterHost(e.target.value)}
                        onBlur={saveNineRouterConfig}
                        placeholder="http://localhost:20128/v1"
                      />
                      <p className="settings-hint">Default works if 9Router is running locally. Change for remote hosts.</p>
                    </div>
                  )}

                  {llmMode === '9router' && (
                    <div className="settings-field">
                      <label className="settings-label">9Router API Key</label>
                      <input
                        className="settings-input"
                        type="password"
                        value={nineRouterKey}
                        onChange={(e) => setNineRouterKey(e.target.value)}
                        onBlur={saveNineRouterConfig}
                        placeholder="Copy from 9Router dashboard →"
                      />
                      <p className="settings-hint">Get your API key at <a href="http://localhost:20128/dashboard" target="_blank" rel="noreferrer">9Router Dashboard</a></p>
                    </div>
                  )}

                  {llmMode === 'custom' && (
                    <div className="settings-field">
                      <label className="settings-label">Base URL</label>
                      <input
                        className="settings-input"
                        value={customBaseUrl}
                        onChange={(e) => setCustomBaseUrl(e.target.value)}
                        onBlur={saveCustomConfig}
                        placeholder="https://api.example.com/v1"
                      />
                      <p className="settings-hint">Any OpenAI-compatible endpoint — Groq, Together, Fireworks, DeepSeek, Mistral, LM Studio, vLLM, etc.</p>
                    </div>
                  )}

                  {llmMode === 'custom' && (
                    <div className="settings-field">
                      <label className="settings-label">API Key</label>
                      <input
                        className="settings-input"
                        type="password"
                        value={customKey}
                        onChange={(e) => setCustomKey(e.target.value)}
                        onBlur={saveCustomConfig}
                        placeholder="sk-..."
                      />
                    </div>
                  )}

                  {/* Coding Workspace / Free Claude Code Integration */}
                  <div className="settings-field settings-field--fcc">
                    <div className="settings-fcc-badge-row">
                      <label className="settings-label">Coding Workspace Engine</label>
                      <span className="settings-fcc-badge">
                        ⚡ Powered by <a href="https://github.com/alishahryar1/free-claude-code" target="_blank" rel="noreferrer">Free Claude Code</a>
                      </span>
                    </div>
                    <p className="settings-hint" style={{ marginTop: '2px', marginBottom: '8px' }}>
                      By default, Claude Code runs directly in the browser using your connected providers (Ollama, OpenRouter, 9Router, Custom) with zero extra setup.
                    </p>

                    <div className="settings-subfields">
                      <div className="settings-subfield">
                        <label className="settings-sublabel">Direct Anthropic API Key <span className="settings-optional">(optional)</span></label>
                        <input
                          className="settings-input"
                          type="password"
                          value={anthropicKey}
                          onChange={(e) => setAnthropicKey(e.target.value)}
                          onBlur={saveAnthropicKey}
                          placeholder="sk-ant-... (leave blank to use Free Claude Code)"
                        />
                        <p className="settings-subhint">Leave blank to route Claude Code through your active provider.</p>
                      </div>

                      <div className="settings-subfield" style={{ marginTop: '8px' }}>
                        <label className="settings-sublabel">External FCC Server URL <span className="settings-optional">(optional)</span></label>
                        <input
                          className="settings-input"
                          value={fccServerUrl}
                          onChange={(e) => setFccServerUrl(e.target.value)}
                          onBlur={saveFccServerUrl}
                          placeholder="http://127.0.0.1:8082 (leave blank to use built-in FCC proxy)"
                        />
                        <p className="settings-subhint">Only needed if running a standalone <code>fcc-server</code> daemon.</p>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    className={`settings-test-btn ${testStatus}`}
                    onClick={testConnection}
                    disabled={testStatus === 'testing'}
                  >
                    {testStatus === 'idle'    && '🔌 Test Connection'}
                    {testStatus === 'testing' && '⏳ Testing…'}
                    {testStatus === 'ok'      && '✅ Connected'}
                    {testStatus === 'fail'    && '❌ Failed — check settings'}
                  </button>
                </div>
              )}

              {/* ── Profile ── */}
              {activeTab === 'profile' && (
                <div className="settings-section">
                  <div className="settings-field">
                    <label className="settings-label">Your Name <span className="settings-optional">(optional)</span></label>
                    <input
                      className="settings-input"
                      value={userName}
                      onChange={(e) => setUserName(e.target.value)}
                      onBlur={saveUserName}
                      placeholder="e.g. Alex"
                    />
                  </div>
                  <div className="settings-field">
                    <label className="settings-label">Your Role <span className="settings-optional">(optional)</span></label>
                    <input
                      className="settings-input"
                      value={userRole}
                      onChange={(e) => setUserRole(e.target.value)}
                      onBlur={saveUserRole}
                      placeholder="e.g. Software engineer, Product manager…"
                    />
                    <p className="settings-hint">Helps the AI tailor responses to your background.</p>
                  </div>
                </div>
              )}

              {/* ── Instructions ── */}
              {activeTab === 'instructions' && (
                <div className="settings-section">
                  <div className="settings-field">
                    <label className="settings-label">
                      Base Instructions <span className="settings-optional">(optional)</span>
                    </label>
                    <textarea
                      className="settings-textarea"
                      rows={8}
                      value={baseInstructions}
                      onChange={(e) => setBaseInstructions(e.target.value)}
                      onBlur={saveBaseInstructions}
                      placeholder={`e.g. Always respond concisely. Prefer TypeScript over JavaScript. When writing code, add comments for non-obvious logic.`}
                    />
                    <p className="settings-hint">These instructions are injected into every conversation as system context.</p>
                  </div>
                </div>
              )}

              {/* ── Behaviour ── */}
              {activeTab === 'behaviour' && (
                <div className="settings-section">
                  <div className="settings-field">
                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={requireApproval}
                        onChange={(e) => toggleApproval(e.target.checked)}
                      />
                      <span>Ask before the AI writes files or runs commands</span>
                    </label>
                    <p className="settings-hint">
                      Applies to write_file, edit_file and run_command. Reading files, listing
                      directories and web search are never gated. Turning this off lets an agent
                      turn change files on disk with no prompt.
                    </p>
                  </div>

                  <div className="settings-field">
                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={skillsInline}
                        onChange={(e) => toggleSkillsInline(e.target.checked)}
                      />
                      <span>Send full skill text with every message</span>
                    </label>
                    <p className="settings-hint">
                      Off by default: skills are listed by name and the model loads the full text
                      only when it needs it. Turning this on costs the whole skill body in every
                      request — reasonable on a local model, expensive on a metered one.
                    </p>
                  </div>

                  <div className="settings-field">
                    <label className="settings-label">
                      Model pricing <span className="settings-optional">(optional)</span>
                    </label>
                    <textarea
                      className="settings-textarea"
                      rows={6}
                      spellCheck={false}
                      value={modelPricing}
                      onChange={(e) => setModelPricing(e.target.value)}
                      onBlur={saveModelPricing}
                      placeholder={'{\n  "deepseek-v4-flash": { "input": 0.27, "output": 1.1 }\n}'}
                    />
                    {pricingError && <p className="settings-error">Not saved — {pricingError}</p>}
                    <p className="settings-hint">
                      USD per 1M tokens, keyed by model id without the provider prefix. Needed for
                      models a built-in price list cannot know; without a rate the app shows token
                      counts only rather than guessing a cost.
                    </p>
                  </div>
                </div>
              )}

              {/* ── Memories ── */}
              {activeTab === 'memories' && (
                <div className="settings-section">
                  <p className="settings-hint" style={{ marginBottom: 12 }}>
                    Vector memories are automatically extracted from your conversations. They are used to give the AI context about you across different chats.
                  </p>

                  <div className="memories-header">
                    <span className="memories-count">
                      {memories.length} {memories.length === 1 ? 'memory' : 'memories'} stored
                    </span>
                    <button
                      type="button"
                      className="settings-refresh-btn"
                      onClick={refreshMemories}
                      disabled={memoriesLoading}
                    >
                      {memoriesLoading ? '⏳ Refreshing…' : '🔄 Refresh'}
                    </button>
                  </div>

                  {memoriesLoading && memories.length === 0 ? (
                    <div className="memories-empty">
                      <span className="memories-empty-icon">🧩</span>
                      <p className="memories-empty-title">No memories yet</p>
                      <p className="memories-empty-hint">
                        Memories are created automatically as you chat. You can also manually add them via the API.
                      </p>
                    </div>
                  ) : (
                    <div className="memories-list">
                      {memories.map((m) => (
                        <div key={m.id} className="memories-item">
                          <div className="memories-item__meta">
                            <span className={`memories-type-badge memories-type--${m.type}`}>{m.type}</span>
                            <span className="memories-date">
                              {new Date(m.createdAt).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <p className="memories-item__content">{m.content.slice(0, 300)}{m.content.length > 300 ? '…' : ''}</p>
                          <button
                            type="button"
                            className="memories-delete-btn"
                            onClick={() => deleteMemory(m.id)}
                            disabled={memoriesDeleting === m.id}
                            title="Delete memory"
                          >
                            {memoriesDeleting === m.id ? '⏳' : '🗑️'}
                          </button>
                        </div>
                      ))}

                      {memories.length === 0 && !memoriesLoading && (
                        <div className="memories-empty">
                          <span className="memories-empty-icon">🧩</span>
                          <p className="memories-empty-title">No memories yet</p>
                          <p className="memories-empty-hint">
                            Memories are created automatically as you chat.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Training ── */}
              {activeTab === 'training' && (
                <div className="settings-section">
                  <p className="settings-hint">
                    Export your thumbs-up'd assistant messages as a dataset for LoRA fine-tuning.
                    Run <code>scripts/finetune/train_lora.py</code> on the file to produce a personal
                    model adapter that Ollama can load. See <code>scripts/finetune/README.md</code>
                    for the full pipeline.
                  </p>

                  {trainingLoading ? (
                    <p className="settings-hint">Loading…</p>
                  ) : trainingStats ? (
                    <div className="settings-training-stats">
                      <div className="settings-about-row">
                        <span className="settings-about-label">Explicit 👍 pairs</span>
                        <span className="settings-about-value"><strong>{trainingStats.pairs}</strong></span>
                      </div>
                      <div className="settings-about-row">
                        <span className="settings-about-label">Auto-positive (implicit)</span>
                        <span className="settings-about-value">{trainingStats.implicit ?? 0}</span>
                      </div>
                      <div className="settings-about-row">
                        <span className="settings-about-label">User-edited answers</span>
                        <span className="settings-about-value">{trainingStats.edited}</span>
                      </div>
                      <div className="settings-about-row">
                        <span className="settings-about-label">Distillation pairs available</span>
                        <span className="settings-about-value">{trainingStats.distillation ?? 0} from {trainingStats.topChats ?? 0} top chats</span>
                      </div>
                      {trainingStats.oldest && trainingStats.newest && (
                        <>
                          <div className="settings-about-row">
                            <span className="settings-about-label">Oldest pair</span>
                            <span className="settings-about-value">{new Date(trainingStats.oldest).toLocaleString()}</span>
                          </div>
                          <div className="settings-about-row">
                            <span className="settings-about-label">Newest pair</span>
                            <span className="settings-about-value">{new Date(trainingStats.newest).toLocaleString()}</span>
                          </div>
                        </>
                      )}

                      {trainingStats.pairs < 50 && trainingStats.pairs > 0 && (
                        <p className="settings-hint">
                          ⚠️ Only <strong>{trainingStats.pairs}</strong> pairs available.
                          Fine-tuning is most useful past ~200 examples. Keep using the app
                          and rating answers with 👍 to build the dataset.
                        </p>
                      )}
                      {trainingStats.pairs === 0 && (
                        <p className="settings-hint">
                          No positive-rated messages yet. Click 👍 on assistant replies you like
                          to populate the dataset.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="settings-hint">No stats available.</p>
                  )}

                  <div className="settings-divider" />

                  <div className="settings-field">
                    <label className="settings-field-label" htmlFor="train-format">Export format</label>
                    <select
                      id="train-format"
                      className="settings-input"
                      value={exportFormat}
                      onChange={(e) => setExportFormat(e.target.value as 'sharegpt' | 'alpaca')}
                    >
                      <option value="sharegpt">ShareGPT — {`{messages: [...]}`} (recommended)</option>
                      <option value="alpaca">Alpaca — {`{instruction, input, output}`}</option>
                    </select>
                  </div>

                  <div className="settings-field">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={includeDistillation}
                        onChange={(e) => setIncludeDistillation(e.target.checked)}
                      />
                      <span className="settings-label">Include distillation pairs</span>
                    </label>
                    <p className="settings-hint">
                      Blends pairs from your highest-rated conversations (~30%) to reduce catastrophic forgetting.
                      {trainingStats && trainingStats.distillation > 0
                        ? ` ${trainingStats.distillation} pairs available from ${trainingStats.topChats} top chats.`
                        : ' Needs ≥2 rated messages per chat.'}
                    </p>
                  </div>

                  <div className="settings-button-row">
                    <button
                      type="button"
                      className="settings-primary-btn"
                      onClick={exportTrainingData}
                      disabled={trainingExporting || !trainingStats || trainingStats.pairs === 0}
                    >
                      {trainingExporting ? 'Exporting…' : 'Export dataset'}
                    </button>
                    <button
                      type="button"
                      className="settings-secondary-btn"
                      onClick={refreshTrainingStats}
                      disabled={trainingLoading}
                    >
                      Refresh
                    </button>
                  </div>

                  {trainingError && (
                    <p className="settings-error">{trainingError}</p>
                  )}

                  {trainingResult && (
                    <div className="settings-training-result">
                      <p className="settings-hint">
                        ✓ Wrote <strong>{trainingResult.pairs}</strong> pair{trainingResult.pairs === 1 ? '' : 's'}
                        {' '}({trainingResult.explicit} explicit{trainingResult.distilled > 0 ? ` + ${trainingResult.distilled} distilled` : ''}, {trainingResult.format}) to:
                      </p>
                      <code className="settings-code-block">{trainingResult.path}</code>
                      <p className="settings-hint">
                        Next: run <code>python scripts/finetune/train_lora.py --data &quot;{trainingResult.path}&quot; --base &lt;model&gt; --out data/adapters/v1</code>
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* ── About / Danger Zone ── */}
              {activeTab === 'about' && (
                <div className="settings-section">
                  <div className="settings-about-row">
                    <span className="settings-about-label">App</span>
                    <span className="settings-about-value">VanailaChat</span>
                  </div>
                  <div className="settings-about-row">
                    <span className="settings-about-label">Backend</span>
                    <span className="settings-about-value">Hono + SQLite</span>
                  </div>
                  <div className="settings-about-row">
                    <span className="settings-about-label">LLM Runtime</span>
                    <span className="settings-about-value">Ollama / OpenAI-compatible</span>
                  </div>

                  <div className="settings-divider" />

                  <div className="settings-danger-zone">
                    <p className="settings-danger-title">⚠️ Danger Zone</p>
                    <p className="settings-hint">Re-running setup will clear your current configuration and restart the onboarding wizard.</p>
                    <button
                      type="button"
                      className="settings-danger-btn"
                      onClick={rerunSetup}
                    >
                      Re-run Setup Wizard
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
