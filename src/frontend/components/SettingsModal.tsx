import { useEffect, useRef, useState } from 'react';
import { AboutTab } from './settings/AboutTab';
import { AiConnectionTab } from './settings/AiConnectionTab';
import { AppearanceTab } from './settings/AppearanceTab';
import { BehaviourTab } from './settings/BehaviourTab';
import { MemoriesTab } from './settings/MemoriesTab';
import { PersonalizationTab } from './settings/PersonalizationTab';
import { TABS } from './settings/tabs';
import { TrainingTab } from './settings/TrainingTab';
import { useSettingsStore } from './settings/useSettingsStore';
import type { LlmMode, Tab } from './settings/types';
import './SettingsModal.css';

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const store = useSettingsStore();
  const [activeTab, setActiveTab] = useState<Tab>('ai');
  const [llmMode, setLlmMode] = useState<LlmMode | null>(null);
  const settingsTabsRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const renderTab = () => {
    switch (activeTab) {
      case 'ai':
        return <AiConnectionTab store={store} llmMode={llmMode ?? store.initialMode} onLlmModeChange={setLlmMode} />;
      case 'personalization':
        return <PersonalizationTab store={store} />;
      case 'behaviour':
        return <BehaviourTab store={store} />;
      case 'appearance':
        return <AppearanceTab />;
      case 'memories':
        return <MemoriesTab store={store} />;
      case 'training':
        return <TrainingTab />;
      case 'about':
        return <AboutTab />;
    }
  };

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
          {store.saved && <span className="settings-saved-badge">✓ {store.saved}</span>}
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
        <div className="settings-tabs-wrap">
          <div ref={settingsTabsRef} className="settings-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={activeTab === t.id}
                className={`settings-tab ${activeTab === t.id ? 'is-active' : ''}`}
                onClick={() => setActiveTab(t.id)}
              >
                <span className="settings-tab-icon">{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="settings-tabs-arrow"
            aria-label="Show more settings"
            title="Show more settings"
            onClick={() => settingsTabsRef.current?.scrollBy({ left: 220, behavior: 'smooth' })}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="settings-body">
          {store.loading ? <div className="settings-loading">Loading…</div> : renderTab()}
        </div>
      </div>
    </div>
  );
}
