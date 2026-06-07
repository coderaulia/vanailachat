import { useState, useEffect, useCallback, useRef } from 'react';
import './SettingsModal.css';

interface AllSettings {
  ollama_host?: string;
  openai_api_key?: string;
  openai_base_url?: string;
  nine_router_host?: string;
  nine_router_api_key?: string;
  user_name?: string;
  user_role?: string;
  base_instructions?: string;
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

type Tab = 'ai' | 'profile' | 'instructions' | 'memories' | 'about';
type LlmMode = 'ollama' | 'openai' | 'openrouter' | '9router';

const STORAGE_KEY = 'vanaila_onboarding_done';

async function saveSetting(key: string, value: string) {
  await fetch(`/api/settings/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
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
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');

  // Profile
  const [userName, setUserName] = useState('');
  const [userRole, setUserRole] = useState('');

  // Instructions
  const [baseInstructions, setBaseInstructions] = useState('');

  // Memories
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(false);
  const [memoriesDeleting, setMemoriesDeleting] = useState<string | null>(null);
  const memoriesFetched = useRef(false);

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
        if (s.nine_router_api_key) {
          setLlmMode('9router');
          setNineRouterKey(s.nine_router_api_key);
        } else if (s.openai_api_key) {
          // Detect mode from base_url
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
        if (s.nine_router_host) setNineRouterHost(s.nine_router_host);
        if (s.user_name) setUserName(s.user_name);
        if (s.user_role) setUserRole(s.user_role);
        if (s.base_instructions) setBaseInstructions(s.base_instructions);
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

  const saveOllamaHost = useCallback(async () => {
    await saveSetting('ollama_host', ollamaHost);
    flash('Saved');
  }, [ollamaHost]);

  const saveOpenaiKey = useCallback(async () => {
    await saveSetting('openai_api_key', openaiKey);
    await saveSetting('openai_base_url', 'https://api.openai.com/v1');
    flash('Saved');
  }, [openaiKey]);

  const saveOpenrouterKey = useCallback(async () => {
    await saveSetting('openai_api_key', openrouterKey);
    await saveSetting('openai_base_url', 'https://openrouter.ai/api/v1');
    flash('Saved');
  }, [openrouterKey]);

  const saveNineRouterConfig = useCallback(async () => {
    await saveSetting('nine_router_host', nineRouterHost);
    await saveSetting('nine_router_api_key', nineRouterKey);
    flash('Saved');
  }, [nineRouterHost, nineRouterKey]);

  const saveUserName = useCallback(async () => {
    if (userName.trim()) { await saveSetting('user_name', userName.trim()); flash('Saved'); }
  }, [userName]);

  const saveUserRole = useCallback(async () => {
    if (userRole.trim()) { await saveSetting('user_role', userRole.trim()); flash('Saved'); }
  }, [userRole]);

  const saveBaseInstructions = useCallback(async () => {
    await saveSetting('base_instructions', baseInstructions.trim());
    flash('Saved');
  }, [baseInstructions]);

  const testConnection = async () => {
    setTestStatus('testing');
    try {
      const res = await fetch('/api/models');
      setTestStatus(res.ok ? 'ok' : 'fail');
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
    { id: 'memories',     label: 'Memories',        icon: '🧩' },
    { id: 'about',        label: 'About',           icon: '⚙️' },
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
