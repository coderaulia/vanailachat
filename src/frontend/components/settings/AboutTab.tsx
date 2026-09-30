import { apiUpdateSetting } from '../../lib/api';

const ONBOARDING_STORAGE_KEY = 'vanaila_onboarding_done';

export function AboutTab() {
  const rerunSetup = async () => {
    await apiUpdateSetting('onboarding_done', 'false');
    localStorage.removeItem(ONBOARDING_STORAGE_KEY);
    window.location.reload();
  };

  return (
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
        <button type="button" className="settings-danger-btn" onClick={rerunSetup}>
          Re-run Setup Wizard
        </button>
      </div>
    </div>
  );
}
