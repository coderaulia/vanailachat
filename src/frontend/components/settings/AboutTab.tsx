import { apiUpdateSetting, isTauri } from '../../lib/api';

const ONBOARDING_STORAGE_KEY = 'vanaila_onboarding_done';

export function AboutTab() {
  const rerunSetup = async () => {
    if (!window.confirm('Show the setup wizard again? Your chats, memories and saved settings are kept.')) return;
    await apiUpdateSetting('onboarding_done', 'false');
    localStorage.removeItem(ONBOARDING_STORAGE_KEY);
    window.location.reload();
  };

  return (
    <div className="settings-section">
      <div className="settings-about-row">
        <span className="settings-about-label">App</span>
        <span className="settings-about-value">VanailaChat {__APP_VERSION__}</span>
      </div>
      <div className="settings-about-row">
        <span className="settings-about-label">Edition</span>
        <span className="settings-about-value">{isTauri ? 'Desktop (Tauri + Rust + SQLite)' : 'Web (Hono + SQLite)'}</span>
      </div>
      <div className="settings-about-row">
        <span className="settings-about-label">LLM Runtime</span>
        <span className="settings-about-value">Ollama / OpenAI-compatible</span>
      </div>

      <div className="settings-divider" />

      <div className="settings-danger-zone">
        <p className="settings-danger-title">Setup</p>
        <p className="settings-hint">Opens the first-run wizard again so you can pick a provider and model. Nothing is deleted.</p>
        <button type="button" className="settings-danger-btn" onClick={rerunSetup}>
          Re-run Setup Wizard
        </button>
      </div>
    </div>
  );
}
