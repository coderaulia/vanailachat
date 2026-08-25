import './ChatHeader.css';
import { useChat } from '../context/ChatContext';
import { isTauri } from '../lib/api';

interface ChatHeaderProps {
  showTokens: boolean;
  thinkingSeconds: number;
  onToggleShowTokens: () => void;
  isCodebasePanelOpen?: boolean;
  onToggleCodebasePanel?: () => void;
}

export function ChatHeader({
  showTokens,
  thinkingSeconds,
  onToggleShowTokens,
  isCodebasePanelOpen,
  onToggleCodebasePanel,
}: ChatHeaderProps) {
  const {
    isCurrentChatSending,
    selectedModel,
    statusText,
    isAutoApprove,
    toggleAutoApprove,
    toggleSidebar: onToggleSidebar,
    toggleTheme: onToggleTheme,
  } = useChat();

  const handleClose = async () => {
    if (isTauri) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    }
  };

  const handleMinimize = async () => {
    if (isTauri) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().minimize();
    }
  };

  const handleMaximize = async () => {
    if (isTauri) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().toggleMaximize();
    }
  };

  const isConnected = statusText === 'Ready' || statusText === 'Connected';

  return (
    <header className="app-header" data-tauri-drag-region="true">
      <div className="header-main" data-tauri-drag-region="true">
        <div className="header-left" data-tauri-drag-region="true">
          {/* macOS Traffic Lights (Desktop Mode) */}
          {isTauri && (
            <div className="mac-traffic-lights" title="Window Controls">
              <button
                type="button"
                className="traffic-light traffic-light--close"
                aria-label="Close"
                onClick={handleClose}
              >
                <span className="traffic-icon">✕</span>
              </button>
              <button
                type="button"
                className="traffic-light traffic-light--minimize"
                aria-label="Minimize"
                onClick={handleMinimize}
              >
                <span className="traffic-icon">−</span>
              </button>
              <button
                type="button"
                className="traffic-light traffic-light--maximize"
                aria-label="Zoom"
                onClick={handleMaximize}
              >
                <span className="traffic-icon">+</span>
              </button>
            </div>
          )}

          <button
            className="icon-btn sidebar-toggle"
            type="button"
            aria-label="Toggle Chat Sidebar"
            title="Toggle Sidebar (Ctrl+/)"
            onClick={onToggleSidebar}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="4" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </button>

          <div className="app-brand-pill" data-tauri-drag-region="true">
            <span className="brand-dot" />
            <span className="app-name-badge">Vanaila</span>
          </div>
        </div>

        <div className="header-summary" data-tauri-drag-region="true">
          {/* Sleek Model & Engine Status Pill */}
          <div className="status-glass-pill" data-tauri-drag-region="true">
            <span className={`engine-status-indicator ${isConnected ? 'is-connected' : 'is-idle'}`} />
            <span className="pill-model-name">{selectedModel || 'Select Model'}</span>
            {isCurrentChatSending ? (
              <span className="thinking-pill" aria-live="polite">
                <span className="pulse-dot" />
                Thinking {thinkingSeconds}s
              </span>
            ) : null}
          </div>

          {/* Auto-Approve Pill Toggle */}
          <button
            className={`auto-approve-pill ${isAutoApprove ? 'is-active' : ''}`}
            type="button"
            title={isAutoApprove ? 'Auto-Approve: Enabled (Tools run without confirmation)' : 'Auto-Approve: Disabled (Confirmation required)'}
            aria-pressed={isAutoApprove}
            onClick={() => void toggleAutoApprove()}
          >
            <span className="pill-icon">⚡</span>
            <span className="pill-label">{isAutoApprove ? 'Auto ON' : 'Auto OFF'}</span>
          </button>

          {/* Token counter toggle */}
          <button
            className={`icon-btn header-tool-btn ${showTokens ? 'is-active' : ''}`}
            type="button"
            aria-label="Toggle token badges"
            title="Toggle Token Usage Details"
            onClick={onToggleShowTokens}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            </svg>
          </button>

          {/* Codebase Panel */}
          {onToggleCodebasePanel && (
            <button
              className={`icon-btn header-tool-btn ${isCodebasePanelOpen ? 'is-active' : ''}`}
              type="button"
              aria-label="Toggle Codebase Activity Panel"
              title="Toggle Codebase Activity & Workspace Changes"
              onClick={onToggleCodebasePanel}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            </button>
          )}

          {/* Theme Toggle */}
          <button
            className="icon-btn theme-toggle header-tool-btn"
            type="button"
            aria-label="Toggle Theme"
            title="Toggle Dark / Light Theme"
            onClick={onToggleTheme}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
          </button>
        </div>
      </div>
    </header>
  );
}
