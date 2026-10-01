import { useState } from 'react';
import { CodingEngineSettings } from './CodingEngineSettings';
import type { SettingsStore } from './useSettingsStore';
import type { SettingKey } from './types';

export function BehaviourTab({ store }: { store: SettingsStore }) {
  const { values } = store;
  const [pricingError, setPricingError] = useState<string | null>(null);

  const toggle = (key: SettingKey, next: boolean) => {
    const value = next ? 'true' : 'false';
    void store.saveNow({ [key]: value }, [[key, value]]);
  };

  // Saved as you type, but only when it parses, so a half-typed object cannot
  // break cost display; closing the modal flushes whatever is pending.
  const editModelPricing = (value: string) => {
    const raw = value.trim();
    if (raw) {
      try {
        JSON.parse(raw);
      } catch (error) {
        store.setLocal({ model_pricing: value });
        setPricingError(error instanceof Error ? error.message : 'Invalid JSON');
        return;
      }
    }
    setPricingError(null);
    store.edit({ model_pricing: value }, [['model_pricing', raw]], 'model_pricing');
  };

  return (
    <div className="settings-section">
      <div className="settings-info-card">
        <strong>How the assistant behaves</strong>
        <p>
          These options control safety checks, how optional instructions are loaded,
          and how usage costs are displayed. They do not change your saved chats.
        </p>
      </div>

      <h3 className="settings-subsection-title">Safety</h3>
      <div className="settings-field">
        <label className="settings-toggle">
          <input
            type="checkbox"
            // Approval defaults to on, so only an explicit 'false' turns it off.
            checked={values.require_tool_approval !== 'false'}
            onChange={(e) => toggle('require_tool_approval', e.target.checked)}
          />
          <span>Ask before making changes</span>
        </label>
        <p className="settings-hint">
          When enabled, the assistant pauses before editing files, writing files, running
          commands, or changing Git state. Turn this off only when you trust the request
          and want coding actions to run without confirmation.
        </p>
      </div>

      <h3 className="settings-subsection-title">Coding</h3>
      <CodingEngineSettings store={store} />

      <h3 className="settings-subsection-title">Instructions</h3>
      <div className="settings-field">
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={values.skills_inline === 'true'}
            onChange={(e) => toggle('skills_inline', e.target.checked)}
          />
          <span>Always include full skill instructions</span>
        </label>
        <p className="settings-hint">
          Off: the assistant sees skill names and loads the full instructions only when
          relevant. On: every request includes every enabled skill, which can use more
          context and cost more with metered models.
        </p>
      </div>

      <h3 className="settings-subsection-title">Usage display</h3>
      <div className="settings-field">
        <label className="settings-label">
          Model pricing <span className="settings-optional">(optional)</span>
        </label>
        <textarea
          className="settings-textarea"
          rows={6}
          spellCheck={false}
          value={values.model_pricing ?? ''}
          onChange={(e) => editModelPricing(e.target.value)}
          onBlur={() => void store.flush('model_pricing')}
          placeholder={'{\n  "deepseek-v4-flash": { "input": 0.27, "output": 1.1 }\n}'}
        />
        {pricingError && <p className="settings-error" role="alert">Not saved yet — {pricingError}</p>}
        <p className="settings-hint">
          Optional: enter USD per 1M tokens, keyed by model id without the provider
          prefix. This only affects cost estimates in the interface; it never changes
          the provider billing or request itself.
        </p>
      </div>
    </div>
  );
}
