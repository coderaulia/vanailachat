import './ChatHeader.css';
import { useChat } from '../context/ChatContext';

interface ChatHeaderProps {
  showTokens: boolean;
  thinkingSeconds: number;
  onToggleShowTokens: () => void;
}

export function ChatHeader({
  showTokens,
  thinkingSeconds,
  onToggleShowTokens,
}: ChatHeaderProps) {
  const {
    isCurrentChatSending,
    selectedModel,
    statusText,
    toggleSidebar: onToggleSidebar,
    toggleTheme: onToggleTheme,
  } = useChat();
  return (
    <header className="app-header">
      <div className="header-main">
        <div className="header-left">
          <button
            className="icon-btn sidebar-toggle"
            type="button"
            aria-label="Toggle Chat Sidebar"
            onClick={onToggleSidebar}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>
        </div>

        <div className="header-title">
          <div className="title-stack">
            <p className="header-eyebrow">Local AI Assistant</p>
            <h2>VanailaChat</h2>
          </div>
        </div>

        <div className="header-summary">
          <div className="status-group">
            <div className="status-pill">
              <span className="status-pill__label">Model</span>
              <span className="status-pill__value">{selectedModel || 'Loading…'}</span>
            </div>
            <div className="status-pill">
              <span className="status-pill__label">Ollama</span>
              <span className="status-pill__value">
                {statusText === 'Ready' ? 'Connected' : statusText}
                {isCurrentChatSending ? (
                  <span className="thinking-badge" aria-live="polite">
                    Thinking… {thinkingSeconds}s
                  </span>
                ) : null}
              </span>
            </div>
          </div>

          <button
            className={`icon-btn ${showTokens ? 'is-active' : ''}`}
            type="button"
            aria-label="Toggle token badges"
            onClick={onToggleShowTokens}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="16" rx="2"></rect>
              <path d="M8 10h8"></path>
              <path d="M8 14h5"></path>
            </svg>
          </button>

          <button className="icon-btn theme-toggle" type="button" aria-label="Toggle Dark Mode" onClick={onToggleTheme}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
