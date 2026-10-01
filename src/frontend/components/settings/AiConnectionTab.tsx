import { useMemo, useState } from 'react';
import { useChat } from '../../context/ChatContext';
import { apiListModelProviders } from '../../lib/api';
import { ModelPull } from './ModelPull';
import { SecretHint } from './SecretHint';
import { customProviderWrites, parseCustomProviders } from './useSettingsStore';
import type { SettingsStore } from './useSettingsStore';
import type { CustomProviderConfig, LlmMode, SettingWrites } from './types';

const LLM_MODES: Array<{ id: LlmMode; label: string }> = [
  { id: 'ollama', label: 'Ollama (Local)' },
  { id: 'custom', label: 'Custom Provider' },
  { id: '9router', label: '9Router' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'openai', label: 'OpenAI' },
];

interface Props {
  store: SettingsStore;
  llmMode: LlmMode;
  onLlmModeChange: (mode: LlmMode) => void;
}

export function AiConnectionTab({ store, llmMode, onLlmModeChange }: Props) {
  const { values } = store;
  const { handleRefreshModels } = useChat();
  const customProviders = useMemo(() => parseCustomProviders(values), [values]);
  const [activeCustomId, setActiveCustomId] = useState<string>(() => customProviders[0]?.id ?? 'custom');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [testedLabel, setTestedLabel] = useState('');

  const openaiWrites = (key: string): SettingWrites => [
    ['openai_api_key', key.trim()],
    ['openai_base_url', 'https://api.openai.com/v1'],
  ];
  const openrouterWrites = (key: string): SettingWrites => [
    ['openrouter_api_key', key.trim()],
    ['openrouter_base_url', 'https://openrouter.ai/api/v1'],
  ];
  const nineRouterWrites = (host: string, key: string): SettingWrites => [
    ['nine_router_host', host.trim()],
    ['nine_router_api_key', key.trim()],
  ];

  const saveCustomProviders = (list: CustomProviderConfig[]) => {
    store.edit({ custom_openai_providers: JSON.stringify(list) }, customProviderWrites(list), 'custom_providers');
  };

  const updateCurrentCustomProvider = (field: keyof CustomProviderConfig, value: string) => {
    saveCustomProviders(customProviders.map((p) => (p.id === activeCustomId ? { ...p, [field]: value } : p)));
  };

  const addCustomProvider = () => {
    const newId = `custom_${Date.now()}`;
    saveCustomProviders([
      ...customProviders,
      { id: newId, name: `Provider ${customProviders.length + 1}`, baseUrl: '', apiKey: '', models: '' },
    ]);
    setActiveCustomId(newId);
  };

  const removeCustomProvider = (idToRemove: string) => {
    if (customProviders.length <= 1) return;
    const name = customProviders.find((p) => p.id === idToRemove)?.name || 'this provider';
    if (!window.confirm(`Remove "${name}"? Its address, key and model list will be deleted.`)) return;
    const updated = customProviders.filter((p) => p.id !== idToRemove);
    saveCustomProviders(updated);
    if (activeCustomId === idToRemove) setActiveCustomId(updated[0]?.id || 'custom');
  };

  const testConnection = async () => {
    setTestStatus('testing');
    try {
      const modeWrites: Record<LlmMode, SettingWrites> = {
        ollama: [['ollama_host', values.ollama_host ?? '']],
        openai: openaiWrites(values.openai_api_key ?? ''),
        openrouter: openrouterWrites(values.openrouter_api_key ?? ''),
        '9router': nineRouterWrites(values.nine_router_host ?? '', values.nine_router_api_key ?? ''),
        custom: customProviderWrites(customProviders),
      };
      await store.persist(modeWrites[llmMode]);

      // Only this provider's models count: another one answering must not make a broken one look fine.
      const models = await apiListModelProviders();
      const matches = (provider: string) => (llmMode === 'custom' ? provider.startsWith('custom') : provider === llmMode);
      setTestedLabel(LLM_MODES.find((m) => m.id === llmMode)?.label ?? '');
      const found = models.some((model) => matches(model.provider));
      setTestStatus(found ? 'ok' : 'fail');
      if (found) void handleRefreshModels();
    } catch {
      setTestStatus('fail');
    }
    setTimeout(() => setTestStatus('idle'), 3000);
  };

  // A dot on a provider tab means something is saved for it (Ollama needs nothing, so it has none).
  const isConfigured = (mode: LlmMode): boolean => {
    switch (mode) {
      case 'openai': return Boolean(values.openai_api_key);
      case 'openrouter': return Boolean(values.openrouter_api_key);
      case '9router': return Boolean(values.nine_router_api_key);
      case 'custom': return customProviders.some((p) => p.baseUrl.trim() || (p.models ?? '').trim());
      default: return false;
    }
  };

  const current = customProviders.find((p) => p.id === activeCustomId) || customProviders[0];

  return (
    <div className="settings-section">
      <div className="settings-llm-tabs">
        {LLM_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className={`settings-llm-tab ${llmMode === mode.id ? 'is-active' : ''}`}
            onClick={() => onLlmModeChange(mode.id)}
          >
            {mode.label}{mode.id === 'custom' && customProviders.length > 1 ? ` (${customProviders.length})` : ''}
            {isConfigured(mode.id) && <span className="settings-llm-tab-dot" role="img" aria-label="configured" title="Configured" />}
          </button>
        ))}
      </div>
      <p className="settings-hint settings-llm-hint">
        Every provider you set up stays available in the model picker. These tabs only choose which provider's settings you are editing; a dot marks the ones that are configured.
      </p>

      {llmMode === 'ollama' && (
        <div className="settings-field">
          <label className="settings-label">Ollama Host URL</label>
          <input className="settings-input" {...store.bindText('ollama_host', { trim: false })} placeholder="http://localhost:11434" />
          <p className="settings-hint">Default works if Ollama is running locally. Change for remote hosts.</p>
        </div>
      )}

      {llmMode === 'ollama' && <ModelPull onPulled={() => void handleRefreshModels()} />}

      {llmMode === 'custom' && (
        <div className="settings-custom-section">
          <div className="settings-custom-picker-row">
            <div className="settings-custom-pills">
              {customProviders.map((p, idx) => (
                <button
                  key={p.id}
                  type="button"
                  className={`settings-custom-pill ${activeCustomId === p.id ? 'is-active' : ''}`}
                  onClick={() => setActiveCustomId(p.id)}
                >
                  <span>{p.name || `Provider ${idx + 1}`}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="settings-custom-add-btn"
              onClick={addCustomProvider}
              title="Add another OpenAI-compatible provider"
            >
              + Add Provider
            </button>
          </div>

          <div className="settings-custom-fields">
            {customProviders.length > 1 && (
              <div className="settings-button-row">
                <button type="button" className="settings-secondary-btn" onClick={() => removeCustomProvider(current.id)}>
                  Remove this provider
                </button>
              </div>
            )}
            <div className="settings-field">
              <label className="settings-label">Provider Name</label>
              <input
                className="settings-input"
                value={current.name}
                onChange={(e) => updateCurrentCustomProvider('name', e.target.value)}
                onBlur={() => void store.flush('custom_providers')}
                placeholder="e.g. Vikey AI, Groq, DeepSeek Direct, LM Studio"
              />
            </div>

            <div className="settings-field">
              <label className="settings-label">Base URL</label>
              <input
                className="settings-input"
                value={current.baseUrl}
                onChange={(e) => updateCurrentCustomProvider('baseUrl', e.target.value)}
                onBlur={() => void store.flush('custom_providers')}
                placeholder="https://api.example.com/v1"
              />
              <p className="settings-hint">
                Any OpenAI-compatible endpoint — Groq, Together, Fireworks, DeepSeek, Mistral, LM Studio, vLLM, etc.
              </p>
            </div>

            <div className="settings-field">
              <label className="settings-label">API Key <span className="settings-optional">(optional for local endpoints)</span></label>
              <input
                className="settings-input"
                type="password"
                onFocus={(e) => e.currentTarget.select()}
                value={current.apiKey || ''}
                onChange={(e) => updateCurrentCustomProvider('apiKey', e.target.value)}
                onBlur={() => void store.flush('custom_providers')}
                placeholder="sk-..."
              />
              <SecretHint value={current.apiKey} />
            </div>

            <div className="settings-field">
              <label className="settings-label">Custom Models (IDs)</label>
              <input
                className="settings-input"
                value={current.models || ''}
                onChange={(e) => updateCurrentCustomProvider('models', e.target.value)}
                onBlur={() => void store.flush('custom_providers')}
                placeholder="gpt-4o, claude-3-7-sonnet-20250219, deepseek-chat"
              />
              <p className="settings-hint">
                Comma-separated model names or IDs. Useful when the provider does not support dynamic discovery via /models.
              </p>
            </div>
          </div>
        </div>
      )}

      {llmMode === '9router' && (
        <>
          <div className="settings-field">
            <label className="settings-label">9Router Host URL</label>
            <input
              className="settings-input"
              {...store.bindText('nine_router_host', {
                group: 'nine_router',
                writes: (host) => nineRouterWrites(host, values.nine_router_api_key ?? ''),
              })}
              placeholder="http://localhost:20128/v1"
            />
            <p className="settings-hint">Default works if 9Router is running locally. Change for remote hosts.</p>
          </div>
          <div className="settings-field">
            <label className="settings-label">9Router API Key</label>
            <input
              className="settings-input"
              type="password"
              onFocus={(e) => e.currentTarget.select()}
              {...store.bindText('nine_router_api_key', {
                group: 'nine_router',
                writes: (key) => nineRouterWrites(values.nine_router_host ?? '', key),
              })}
              placeholder="Copy from 9Router dashboard →"
            />
            <SecretHint value={values.nine_router_api_key} />
            <p className="settings-hint">Get your API key at <a href="http://localhost:20128/dashboard" target="_blank" rel="noreferrer">9Router Dashboard</a></p>
          </div>
        </>
      )}

      {llmMode === 'openrouter' && (
        <div className="settings-field">
          <label className="settings-label">OpenRouter API Key</label>
          <input
            className="settings-input"
            type="password"
            onFocus={(e) => e.currentTarget.select()}
            {...store.bindText('openrouter_api_key', { writes: openrouterWrites })}
            placeholder="sk-or-..."
          />
          <SecretHint value={values.openrouter_api_key} />
          <p className="settings-hint">Access 100+ models at <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">openrouter.ai</a></p>
        </div>
      )}

      {llmMode === 'openai' && (
        <div className="settings-field">
          <label className="settings-label">OpenAI API Key</label>
          <input
            className="settings-input"
            type="password"
            onFocus={(e) => e.currentTarget.select()}
            {...store.bindText('openai_api_key', { writes: openaiWrites })}
            placeholder="sk-..."
          />
          <SecretHint value={values.openai_api_key} />
          <p className="settings-hint">Get your key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com</a></p>
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
        {testStatus === 'fail'    && `❌ No models from ${testedLabel || 'this provider'} — check the address and key`}
      </button>
    </div>
  );
}
