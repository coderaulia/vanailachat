import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
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
  const cardRef = useRef<HTMLDivElement>(null);
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false });

  const updateScrollEdges = useCallback(() => {
    const el = settingsTabsRef.current;
    if (!el) return;
    setScrollEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    updateScrollEdges();
    window.addEventListener('resize', updateScrollEdges);
    return () => window.removeEventListener('resize', updateScrollEdges);
  }, [updateScrollEdges]);

  // Move focus into the dialog, and give it back to whatever opened it on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    cardRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    return () => opener?.focus?.();
  }, []);

  // Keep the active tab in view when it changes (keyboard or click).
  useEffect(() => {
    settingsTabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeTab]);

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    // Tab stays inside the dialog instead of reaching the page behind it.
    const focusable = [...(cardRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? [])];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const handleTabListKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const index = TABS.findIndex((t) => t.id === activeTab);
    const target = e.key === 'ArrowRight' ? (index + 1) % TABS.length
      : e.key === 'ArrowLeft' ? (index - 1 + TABS.length) % TABS.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? TABS.length - 1
      : -1;
    if (target < 0) return;
    e.preventDefault();
    setActiveTab(TABS[target].id);
    requestAnimationFrame(() => document.getElementById(`settings-tab-${TABS[target].id}`)?.focus());
  };

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
      onKeyDown={handleKeyDown}
    >
      <div className="settings-card" ref={cardRef}>
        {/* Header */}
        <div className="settings-header">
          <h2 className="settings-title">Settings</h2>
          {store.saved && (
            <span
              className={`settings-saved-badge ${store.saveFailed ? 'is-error' : ''}`}
              role={store.saveFailed ? 'alert' : 'status'}
            >
              {store.saveFailed ? `⚠ Not saved — ${store.saved}` : `✓ ${store.saved}`}
            </span>
          )}
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
          {scrollEdges.left && (
            <button
              type="button"
              className="settings-tabs-arrow settings-tabs-arrow--left"
              aria-label="Show previous settings"
              title="Show previous settings"
              tabIndex={-1}
              onClick={() => settingsTabsRef.current?.scrollBy({ left: -220, behavior: 'smooth' })}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          <div
            ref={settingsTabsRef}
            className={`settings-tabs ${scrollEdges.left ? 'has-left' : ''} ${scrollEdges.right ? 'has-right' : ''}`}
            role="tablist"
            aria-label="Settings sections"
            onScroll={updateScrollEdges}
            onKeyDown={handleTabListKeyDown}
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                id={`settings-tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={activeTab === t.id}
                aria-controls="settings-panel"
                tabIndex={activeTab === t.id ? 0 : -1}
                className={`settings-tab ${activeTab === t.id ? 'is-active' : ''}`}
                onClick={() => setActiveTab(t.id)}
              >
                <span className="settings-tab-icon">{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
          {scrollEdges.right && (
            <button
              type="button"
              className="settings-tabs-arrow"
              aria-label="Show more settings"
              title="Show more settings"
              tabIndex={-1}
              onClick={() => settingsTabsRef.current?.scrollBy({ left: 220, behavior: 'smooth' })}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}
        </div>

        {/* Body */}
        <div className="settings-body" id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${activeTab}`}>
          {store.loading ? <div className="settings-loading">Loading…</div> : renderTab()}
        </div>
      </div>
    </div>
  );
}
