import { useState } from 'react';
import { COLOR_SCHEME_STORAGE_KEY } from '../../config/constants';
import type { ColorScheme } from '../../config/constants';
import { useChat } from '../../context/ChatContext';

const COLOR_SCHEMES: { id: ColorScheme; label: string; swatches: string[] }[] = [
  { id: 'vanaila-origin', label: 'Vanaila Origin', swatches: ['#244e78', '#487fae'] },
  { id: 'catppuccin-teal', label: 'Catppuccin Teal', swatches: ['#179299', '#20b2ba'] },
  { id: 'catppuccin-rose', label: 'Catppuccin Rose', swatches: ['#d88a8a', '#f0c6c6'] },
  { id: 'catppuccin-blue', label: 'Catppuccin Blue', swatches: ['#5c7fdb', '#8caaee'] },
  { id: 'catppuccin-green', label: 'Catppuccin Green', swatches: ['#6aa857', '#a6da95'] },
  { id: 'catppuccin-peach', label: 'Catppuccin Peach', swatches: ['#e57d3c', '#fab387'] },
];

export function AppearanceTab() {
  const { isDarkMode, toggleTheme } = useChat();
  const [activeColorScheme, setActiveColorScheme] = useState<ColorScheme>(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(COLOR_SCHEME_STORAGE_KEY) : null;
    return (stored as ColorScheme) || 'vanaila-origin';
  });

  const applyColorScheme = (scheme: ColorScheme) => {
    setActiveColorScheme(scheme);
    window.localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, scheme);
    if (scheme === 'vanaila-origin') {
      document.documentElement.removeAttribute('data-color-scheme');
    } else {
      document.documentElement.setAttribute('data-color-scheme', scheme);
    }
  };

  return (
    <div className="settings-section">
      <div className="settings-field">
        <label className="settings-label">Interface Theme</label>
        <p className="settings-hint">
          Switch between Dark and Light mode across all workspaces and chats.
        </p>
        <div className="settings-theme-toggle-wrap">
          <button
            type="button"
            className={`settings-theme-option ${isDarkMode ? 'is-selected' : ''}`}
            onClick={() => {
              if (!isDarkMode) toggleTheme();
            }}
          >
            <div className="settings-theme-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            </div>
            <div className="settings-theme-info">
              <span className="settings-theme-title">Dark Mode</span>
              <span className="settings-theme-desc">Deep slate theme for low-light environments</span>
            </div>
            {isDarkMode && <span className="settings-scheme-active-tag">Active</span>}
          </button>

          <button
            type="button"
            className={`settings-theme-option ${!isDarkMode ? 'is-selected' : ''}`}
            onClick={() => {
              if (isDarkMode) toggleTheme();
            }}
          >
            <div className="settings-theme-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            </div>
            <div className="settings-theme-info">
              <span className="settings-theme-title">Light Mode</span>
              <span className="settings-theme-desc">Crisp, clean high-contrast appearance</span>
            </div>
            {!isDarkMode && <span className="settings-scheme-active-tag">Active</span>}
          </button>
        </div>
      </div>

      <div className="settings-field">
        <label className="settings-label">Color Scheme</label>
        <p className="settings-hint">
          Choose your preferred accent color scheme. Applies across all buttons, highlights, accents, and UI elements.
        </p>
        <div className="settings-color-schemes-grid">
          {COLOR_SCHEMES.map((s) => {
            const isSelected = activeColorScheme === s.id;
            return (
              <button
                key={s.id}
                type="button"
                className={`settings-scheme-card ${isSelected ? 'is-selected' : ''}`}
                onClick={() => applyColorScheme(s.id)}
              >
                <div className="settings-scheme-swatches">
                  {s.swatches.map((color, idx) => (
                    <span
                      key={idx}
                      className="settings-scheme-swatch"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <div className="settings-scheme-info">
                  <span className="settings-scheme-name">{s.label}</span>
                  {isSelected && <span className="settings-scheme-active-tag">Active</span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
