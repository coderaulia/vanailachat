import { useState, useEffect } from 'react';
import './OnboardingWizard.css';

interface OnboardingStep {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
}

const STEPS: OnboardingStep[] = [
  { id: 'welcome',  title: 'Welcome to Vanaila Chat', subtitle: "Let's get you set up in a few quick steps.", icon: '👋' },
  { id: 'llm',      title: 'Connect your AI',         subtitle: 'Choose how you want to run your language model.', icon: '🧠' },
  { id: 'profile',  title: 'Your Profile',             subtitle: 'Tell the assistant a bit about yourself.', icon: '🪪' },
  { id: 'memory',   title: 'Memory & Instructions',   subtitle: 'Set baseline instructions the AI always follows.', icon: '🗂️' },
  { id: 'done',     title: 'All set!',                 subtitle: 'You\'re ready to start chatting.', icon: '🚀' },
];

const STORAGE_KEY = 'vanaila_onboarding_done';

async function saveSetting(key: string, value: string) {
  try {
    const response = await fetch(`/api/settings/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    // Best-effort, but a silent failure here looks like setup simply not
    // sticking — so at least leave a trace when the backend rejects the write.
    if (!response.ok) console.error(`[SETUP] Failed to save ${key} (HTTP ${response.status})`);
  } catch (error) {
    console.error(`[SETUP] Failed to save ${key}`, error);
  }
}

export function OnboardingWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);

  // LLM step state
  const [llmMode, setLlmMode] = useState<'ollama' | 'openai' | 'openrouter' | '9router' | 'custom'>('ollama');
  const [ollamaHost, setOllamaHost] = useState('http://localhost:11434');
  const [openaiKey, setOpenaiKey] = useState('');
  const [openrouterKey, setOpenrouterKey] = useState('');
  const [nineRouterHost, setNineRouterHost] = useState('http://localhost:20128/v1');
  const [nineRouterKey, setNineRouterKey] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customKey, setCustomKey] = useState('');

  // Profile step state
  const [userName, setUserName] = useState('');
  const [userRole, setUserRole] = useState('');

  // Memory step state
  const [baseInstructions, setBaseInstructions] = useState('');

  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];

  const next = async () => {
    // Save data for each step before advancing
    if (current.id === 'llm') {
      if (llmMode === 'ollama') {
        await saveSetting('ollama_host', ollamaHost.trim());
      } else if (llmMode === 'openai') {
        await saveSetting('openai_api_key', openaiKey.trim());
        await saveSetting('openai_base_url', 'https://api.openai.com/v1');
      } else if (llmMode === 'openrouter') {
        await saveSetting('openrouter_api_key', openrouterKey.trim());
        await saveSetting('openrouter_base_url', 'https://openrouter.ai/api/v1');
        await saveSetting('openai_api_key', openrouterKey.trim());
        await saveSetting('openai_base_url', 'https://openrouter.ai/api/v1');
      } else if (llmMode === '9router') {
        await saveSetting('nine_router_host', nineRouterHost.trim());
        await saveSetting('nine_router_api_key', nineRouterKey.trim());
      } else if (llmMode === 'custom') {
        await saveSetting('custom_openai_base_url', customBaseUrl.trim());
        await saveSetting('custom_openai_api_key', customKey.trim());
      }
    }

    if (current.id === 'profile') {
      if (userName.trim()) await saveSetting('user_name', userName.trim());
      if (userRole.trim()) await saveSetting('user_role', userRole.trim());
    }

    if (current.id === 'memory') {
      if (baseInstructions.trim()) await saveSetting('base_instructions', baseInstructions.trim());
    }

    if (isLast) {
      await saveSetting('onboarding_done', 'true');
      localStorage.setItem(STORAGE_KEY, 'true');
      onDone();
    } else {
      setStep((s) => s + 1);
    }
  };

  const skip = async () => {
    await saveSetting('onboarding_done', 'true');
    localStorage.setItem(STORAGE_KEY, 'true');
    onDone();
  };

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-label="Setup wizard">
      <div className="onboarding-card">
        {/* Progress dots */}
        <div className="onboarding-progress">
          {STEPS.map((s, i) => (
            <span
              key={s.id}
              className={`onboarding-dot ${i === step ? 'is-active' : ''} ${i < step ? 'is-done' : ''}`}
            />
          ))}
        </div>

        {/* Header */}
        <div className="onboarding-header">
          <span className="onboarding-icon">{current.icon}</span>
          <h1 className="onboarding-title">{current.title}</h1>
          <p className="onboarding-subtitle">{current.subtitle}</p>
        </div>

        {/* Step content */}
        <div className="onboarding-body">
          {current.id === 'welcome' && (
            <div className="onboarding-welcome">
              <ul className="onboarding-feature-list">
                <li>🤖 Chat with local Ollama models or cloud AI</li>
                <li>🧠 Semantic memory across conversations</li>
                <li>💻 Coder & Creator assistant personas</li>
                <li>🔍 Web search + file tools built in</li>
              </ul>
            </div>
          )}

          {current.id === 'llm' && (
            <div className="onboarding-llm">
              <div className="onboarding-tabs">
                <button
                  className={`onboarding-tab ${llmMode === 'ollama' ? 'is-active' : ''}`}
                  onClick={() => setLlmMode('ollama')}
                  type="button"
                >
                  🦙 Ollama (Local)
                </button>
                <button
                  className={`onboarding-tab ${llmMode === 'openai' ? 'is-active' : ''}`}
                  onClick={() => setLlmMode('openai')}
                  type="button"
                >
                  ⚡ OpenAI
                </button>
                <button
                  className={`onboarding-tab ${llmMode === 'openrouter' ? 'is-active' : ''}`}
                  onClick={() => setLlmMode('openrouter')}
                  type="button"
                >
                  🔀 OpenRouter
                </button>
                <button
                  className={`onboarding-tab ${llmMode === '9router' ? 'is-active' : ''}`}
                  onClick={() => setLlmMode('9router')}
                  type="button"
                >
                  🔄 9Router
                </button>
                <button
                  className={`onboarding-tab ${llmMode === 'custom' ? 'is-active' : ''}`}
                  onClick={() => setLlmMode('custom')}
                  type="button"
                >
                  🧩 Custom
                </button>
              </div>

              {llmMode === 'ollama' && (
                <div className="onboarding-field">
                  <label>Ollama Host URL</label>
                  <input
                    className="onboarding-input"
                    value={ollamaHost}
                    onChange={(e) => setOllamaHost(e.target.value)}
                    placeholder="http://localhost:11434"
                  />
                  <p className="onboarding-hint">
                    Default works if Ollama is running locally. Change for remote hosts.
                  </p>
                </div>
              )}

              {llmMode === 'openai' && (
                <div className="onboarding-field">
                  <label>OpenAI API Key</label>
                  <input
                    className="onboarding-input"
                    type="password"
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    placeholder="sk-..."
                  />
                  <p className="onboarding-hint">
                    Get your key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com</a>
                  </p>
                </div>
              )}

              {llmMode === 'openrouter' && (
                <div className="onboarding-field">
                  <label>OpenRouter API Key</label>
                  <input
                    className="onboarding-input"
                    type="password"
                    value={openrouterKey}
                    onChange={(e) => setOpenrouterKey(e.target.value)}
                    placeholder="sk-or-..."
                  />
                  <p className="onboarding-hint">
                    Access 100+ models at <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">openrouter.ai</a>
                  </p>
                </div>
              )}

              {llmMode === '9router' && (
                <div className="onboarding-field">
                  <label>9Router Host URL</label>
                  <input
                    className="onboarding-input"
                    value={nineRouterHost}
                    onChange={(e) => setNineRouterHost(e.target.value)}
                    placeholder="http://localhost:20128/v1"
                  />
                  <p className="onboarding-hint">
                    Default works if 9Router is running locally.
                  </p>
                </div>
              )}

              {llmMode === '9router' && (
                <div className="onboarding-field">
                  <label>9Router API Key</label>
                  <input
                    className="onboarding-input"
                    type="password"
                    value={nineRouterKey}
                    onChange={(e) => setNineRouterKey(e.target.value)}
                    placeholder="Copy from 9Router dashboard →"
                  />
                  <p className="onboarding-hint">
                    Get your key at <a href="http://localhost:20128/dashboard" target="_blank" rel="noreferrer">9Router Dashboard</a>
                  </p>
                </div>
              )}

              {llmMode === 'custom' && (
                <div className="onboarding-field">
                  <label>Base URL</label>
                  <input
                    className="onboarding-input"
                    value={customBaseUrl}
                    onChange={(e) => setCustomBaseUrl(e.target.value)}
                    placeholder="https://api.example.com/v1"
                  />
                  <p className="onboarding-hint">
                    Any OpenAI-compatible endpoint — Groq, Together, Fireworks, DeepSeek, Mistral, LM Studio, vLLM, etc.
                  </p>
                </div>
              )}

              {llmMode === 'custom' && (
                <div className="onboarding-field">
                  <label>API Key</label>
                  <input
                    className="onboarding-input"
                    type="password"
                    value={customKey}
                    onChange={(e) => setCustomKey(e.target.value)}
                    placeholder="sk-..."
                  />
                </div>
              )}
            </div>
          )}

          {current.id === 'profile' && (
            <div className="onboarding-profile">
              <div className="onboarding-field">
                <label>Your Name <span className="onboarding-optional">(optional)</span></label>
                <input
                  className="onboarding-input"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="e.g. Alex"
                />
              </div>
              <div className="onboarding-field">
                <label>Your Role <span className="onboarding-optional">(optional)</span></label>
                <input
                  className="onboarding-input"
                  value={userRole}
                  onChange={(e) => setUserRole(e.target.value)}
                  placeholder="e.g. Software engineer, Product manager..."
                />
                <p className="onboarding-hint">Helps the AI tailor responses to your background.</p>
              </div>
            </div>
          )}

          {current.id === 'memory' && (
            <div className="onboarding-memory">
              <div className="onboarding-field">
                <label>Base Instructions <span className="onboarding-optional">(optional)</span></label>
                <textarea
                  className="onboarding-textarea"
                  value={baseInstructions}
                  onChange={(e) => setBaseInstructions(e.target.value)}
                  rows={5}
                  placeholder={`e.g. Always respond concisely. Prefer TypeScript over JavaScript. When writing code, add comments for non-obvious logic.`}
                />
                <p className="onboarding-hint">These instructions are injected into every conversation.</p>
              </div>
            </div>
          )}

          {current.id === 'done' && (
            <div className="onboarding-done">
              <p>Your setup is saved. You can always change these in Settings.</p>
              <div className="onboarding-tips">
                <div className="onboarding-tip">
                  <span>💡</span>
                  <span>Select <strong>💻 Coder</strong> persona in the composer for coding tasks</span>
                </div>
                <div className="onboarding-tip">
                  <span>💡</span>
                  <span>Select <strong>✨ Creator</strong> persona for content planning and social media</span>
                </div>
                <div className="onboarding-tip">
                  <span>💡</span>
                  <span>Enable 🔍 web search in the toolbar for real-time information</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="onboarding-footer">
          {!isLast && (
            <button type="button" className="onboarding-skip" onClick={skip}>
              Skip setup
            </button>
          )}
          <button type="button" className="onboarding-next btn btn-primary" onClick={next}>
            {isLast ? 'Start Chatting →' : step === 0 ? 'Get Started →' : 'Continue →'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Check if onboarding has been completed (localStorage fast-path) */
// eslint-disable-next-line react-refresh/only-export-components
export function useOnboarding() {
  const [show, setShow] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // Fast path: localStorage
    if (localStorage.getItem(STORAGE_KEY) === 'true') {
      setChecked(true);
      return;
    }
    // Slow path: check backend settings
    fetch('/api/settings/onboarding_done')
      .then((r) => r.json())
      .then((data: { value?: string }) => {
        if (data.value === 'true') {
          localStorage.setItem(STORAGE_KEY, 'true');
          setChecked(true);
        } else {
          setShow(true);
          setChecked(true);
        }
      })
      .catch(() => {
        setShow(true);
        setChecked(true);
      });
  }, []);

  const markDone = () => setShow(false);

  return { show, checked, markDone };
}
