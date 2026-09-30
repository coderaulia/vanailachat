import { useState } from 'react';
import type { SettingsStore } from './useSettingsStore';

type Harness = 'pi-harness' | 'deepseek-harness';

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export function CodingEngineSettings({ store }: { store: SettingsStore }) {
  const { values, bindText } = store;
  const [expanded, setExpanded] = useState(false);
  const harness = values.coding_harness as Harness;

  const selectHarness = (next: Harness) => void store.saveNow({ coding_harness: next }, [['coding_harness', next]]);

  return (
    <div className="settings-field settings-field--harness">
      <div className="settings-harness-badge-row">
        <label className="settings-label">Coding Workspace Engine</label>
        {harness === 'pi-harness' ? (
          <span className="settings-harness-badge">
            🧭 Powered by <a href="https://github.com/earendil-works/pi" target="_blank" rel="noreferrer">Pi</a>
          </span>
        ) : (
          <span className="settings-harness-badge settings-dsh-badge">
            🐋 Powered by <a href="https://github.com/deepseek-ai/deepseek-harness.git" target="_blank" rel="noreferrer">DeepSeek Harness</a>
          </span>
        )}
      </div>

      <div className="settings-harness-selector">
        <button
          type="button"
          className={`settings-harness-btn ${harness === 'pi-harness' ? 'is-active' : ''}`}
          onClick={() => selectHarness('pi-harness')}
        >
          🧭 Pi Harness
        </button>
        <button
          type="button"
          className={`settings-harness-btn ${harness === 'deepseek-harness' ? 'is-active' : ''}`}
          onClick={() => selectHarness('deepseek-harness')}
        >
          🐋 DeepSeek Harness (dsh)
        </button>
      </div>

      <button
        type="button"
        className="settings-setup-toggle"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
      >
        <span>{expanded ? 'Hide setup' : 'Configure setup'}</span>
        <span aria-hidden="true">{expanded ? '▴' : '▾'}</span>
      </button>

      {expanded && (harness === 'pi-harness' ? (
        <>
          <p className="settings-hint" style={{ marginTop: '2px', marginBottom: '8px' }}>
            <a href="https://github.com/earendil-works/pi" target="_blank" rel="noreferrer">Pi</a> runs through its official coding-agent SDK with read, edit, write, search, and shell tools.
          </p>

          <div className="settings-subfields">
            <div className="settings-subfield">
              <label className="settings-sublabel">Pi Provider</label>
              <input className="settings-input" {...bindText('pi_provider')} placeholder="anthropic, openai, google, or custom-id" />
              <p className="settings-subhint">Use a built-in Pi provider ID, or the provider ID from your Pi <code>models.json</code>.</p>
            </div>

            <div className="settings-subfield" style={{ marginTop: '8px' }}>
              <label className="settings-sublabel">Pi Model</label>
              <input className="settings-input" {...bindText('pi_model')} placeholder="claude-sonnet-4-5 or gpt-5.2" />
              <p className="settings-subhint">The model ID without provider prefix; <code>provider/model</code> is also accepted when Provider is set.</p>
            </div>

            <div className="settings-subfield" style={{ marginTop: '8px' }}>
              <label className="settings-sublabel">Pi API Key <span className="settings-optional">(optional)</span></label>
              <input className="settings-input" type="password" {...bindText('pi_api_key')} placeholder="Leave blank to use Pi auth.json or environment" />
            </div>

            <div className="settings-subfield" style={{ marginTop: '8px' }}>
              <label className="settings-sublabel">Custom Base URL <span className="settings-optional">(optional)</span></label>
              <input className="settings-input" {...bindText('pi_base_url')} placeholder="https://openrouter.ai/api/v1" />
              <p className="settings-subhint">Adds a temporary OpenAI-compatible Pi provider. Leave blank for built-in providers.</p>
            </div>

            <div className="settings-subfield" style={{ marginTop: '8px' }}>
              <label className="settings-sublabel">Thinking Level</label>
              <select
                className="settings-input"
                value={values.pi_thinking_level}
                onChange={(e) => void store.saveNow({ pi_thinking_level: e.target.value }, [['pi_thinking_level', e.target.value]])}
              >
                {THINKING_LEVELS.map((level) => (
                  <option key={level} value={level}>{level}</option>
                ))}
              </select>
            </div>

            <div className="settings-subfield" style={{ marginTop: '8px' }}>
              <label className="settings-sublabel">Tool Policy</label>
              <select
                className="settings-input"
                value={values.pi_tool_policy}
                onChange={(e) => void store.saveNow({ pi_tool_policy: e.target.value }, [['pi_tool_policy', e.target.value]])}
              >
                <option value="approval">Approval for writes and commands</option>
                <option value="readonly">Read-only mode</option>
                <option value="autonomous">Autonomous coding</option>
              </select>
              <p className="settings-subhint">Approval is recommended. Read-only disables Pi’s edit, write, and shell tools.</p>
            </div>

            <div className="settings-subfield" style={{ marginTop: '8px' }}>
              <label className="settings-sublabel">Pi Agent Directory <span className="settings-optional">(optional)</span></label>
              <input className="settings-input" {...bindText('pi_agent_dir')} placeholder="~/.pi/agent" />
              <p className="settings-subhint">Used for Pi settings, auth, custom models, skills, and catalogs.</p>
            </div>

            <div className="settings-subfield" style={{ marginTop: '8px' }}>
              <label className="settings-sublabel">Pi System Prompt <span className="settings-optional">(optional)</span></label>
              <textarea
                className="settings-input"
                rows={4}
                {...bindText('pi_system_prompt', { trim: false })}
                placeholder="Leave blank to use Pi’s default coding prompt"
              />
            </div>
          </div>
        </>
      ) : (
        <>
          <p className="settings-hint" style={{ marginTop: '2px', marginBottom: '8px' }}>
            <a href="https://github.com/deepseek-ai/deepseek-harness.git" target="_blank" rel="noreferrer">DeepSeek Harness</a> (<code>dsh</code>) is an open-source, plugin-based agent runtime framework for autonomous coding, workspace tool execution, and planning.
          </p>

          <div className="settings-subfields">
            <div className="settings-subfield">
              <label className="settings-sublabel">DeepSeek API Key <span className="settings-optional">(optional)</span></label>
              <input
                className="settings-input"
                type="password"
                {...bindText('deepseek_api_key')}
                placeholder="sk-... (leave blank to use active provider / environment)"
              />
              <p className="settings-subhint">Get your key from <a href="https://platform.deepseek.com" target="_blank" rel="noreferrer">platform.deepseek.com</a></p>
            </div>

            <div className="settings-subfield" style={{ marginTop: '8px' }}>
              <label className="settings-sublabel">DeepSeek Base URL <span className="settings-optional">(optional)</span></label>
              <input className="settings-input" {...bindText('deepseek_base_url')} placeholder="https://api.deepseek.com" />
              <p className="settings-subhint">Defaults to official DeepSeek API or custom proxy endpoint.</p>
            </div>

            <div className="settings-subfield" style={{ marginTop: '8px' }}>
              <label className="settings-sublabel">DeepSeek Model <span className="settings-optional">(optional)</span></label>
              <input
                className="settings-input"
                {...bindText('deepseek_model')}
                placeholder="deepseek-chat (e.g. deepseek-chat, deepseek-coder, deepseek-reasoner)"
              />
            </div>

            <div className="settings-subfield" style={{ marginTop: '8px' }}>
              <label className="settings-sublabel">DSH CLI Path / Command <span className="settings-optional">(optional)</span></label>
              <input
                className="settings-input"
                {...bindText('dsh_path')}
                placeholder="dsh or npx @deepseek-ai/dsh (leave blank to use built-in engine)"
              />
              <p className="settings-subhint">Local DeepSeek Harness CLI command or executable.</p>
            </div>

            <div className="settings-subfield" style={{ marginTop: '8px' }}>
              <label className="settings-sublabel">DSH Profile <span className="settings-optional">(optional)</span></label>
              <input className="settings-input" {...bindText('dsh_profile')} placeholder="headless" />
            </div>
          </div>
        </>
      ))}
    </div>
  );
}
