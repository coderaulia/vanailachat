import type { SettingsStore } from './useSettingsStore';

// Profile fields save even when emptied, so clearing one actually sticks.
export function PersonalizationTab({ store }: { store: SettingsStore }) {
  const { bindText } = store;
  return (
    <div className="settings-section">
      <div className="settings-field">
        <label className="settings-label">Your Name <span className="settings-optional">(optional)</span></label>
        <input className="settings-input" {...bindText('user_name')} placeholder="e.g. Alex" />
      </div>
      <div className="settings-field">
        <label className="settings-label">Your Role <span className="settings-optional">(optional)</span></label>
        <input className="settings-input" {...bindText('user_role')} placeholder="e.g. Software engineer, Product manager…" />
        <p className="settings-hint">Helps the AI tailor responses to your background.</p>
      </div>
      <div className="settings-field">
        <label className="settings-label">
          Base Instructions <span className="settings-optional">(optional)</span>
        </label>
        <textarea
          className="settings-textarea"
          rows={8}
          {...bindText('base_instructions')}
          placeholder={`e.g. Always respond concisely. Prefer TypeScript over JavaScript. When writing code, add comments for non-obvious logic.`}
        />
        <p className="settings-hint">These instructions are injected into every conversation as system context.</p>
      </div>
    </div>
  );
}
