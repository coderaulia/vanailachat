import './ChatHeader.css';
import { useChat } from '../context/ChatContext';
import { getProviderDisplayInfo } from '../config/modelMetadata';

interface ChatHeaderProps {
  showTokens: boolean;
  thinkingSeconds: number;
  onToggleShowTokens: () => void;
  isCodebasePanelOpen?: boolean;
  onToggleCodebasePanel?: () => void;
  responseStats?: { latencyMs: number; tokensPerSecond: number; completionTokens: number } | null;
  isLogOpen?: boolean;
  onToggleLog?: () => void;
}

export function ChatHeader({
  showTokens,
  thinkingSeconds,
  onToggleShowTokens,
  isCodebasePanelOpen,
  onToggleCodebasePanel,
  responseStats,
  isLogOpen,
  onToggleLog,
}: ChatHeaderProps) {
  const {
    isCurrentChatSending,
    selectedModel,
    modelMetadata,
    providers,
    statusText,
    isAutoApprove,
    toggleAutoApprove,
    toggleSidebar: onToggleSidebar,
    isDarkMode,
    toggleTheme: onToggleTheme,
  } = useChat();

  const selectedProvider = providers.find((provider) => provider.name === selectedModel);
  const modelProvider = selectedProvider?.provider
    || modelMetadata[selectedModel]?.providerKind
    || selectedModel.split(':')[0];
  const providerLabel = modelMetadata[selectedModel]?.providerLabel
    || selectedProvider?.providerLabel
    || getProviderDisplayInfo(modelProvider).label;

  return (
    <header className="app-header" data-tauri-drag-region="true">
      <div className="header-main" data-tauri-drag-region="true">
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
          <span className="app-name-badge">VanailaChat</span>
        </div>

        <div className="header-summary">
          <div className="status-group">
            <div className="status-pill">
              <span className="status-pill__label">Model</span>
              <span className="status-pill__value">{selectedModel || 'Not selected'}</span>
            </div>
            <div className="status-pill">
              <span className="status-pill__label">{providerLabel}</span>
              <span className="status-pill__value">
                {statusText === 'Ready' ? 'Connected' : statusText}
                {isCurrentChatSending ? (
                  <span className="thinking-badge" aria-live="polite">
                    Thinking… {thinkingSeconds}s
                  </span>
                ) : null}
              </span>
            </div>
            {responseStats && (
              <div className="status-pill response-stats" title="Latest completed response">
                <span>{responseStats.tokensPerSecond.toFixed(1)} tok/s</span>
                <span>{responseStats.latencyMs >= 1000 ? `${(responseStats.latencyMs / 1000).toFixed(1)}s` : `${responseStats.latencyMs}ms`}</span>
              </div>
            )}
          </div>

          <button
            className={`auto-approve-toggle ${isAutoApprove ? 'is-active' : ''}`}
            type="button"
            title={isAutoApprove ? 'Auto-Approve Enabled: Click to require confirmation' : 'Auto-Approve Disabled: Click to enable auto-approve for tools'}
            aria-pressed={isAutoApprove}
            onClick={() => void toggleAutoApprove()}
          >
            <span className="auto-approve-toggle__icon">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </span>
            <span className="auto-approve-toggle__label">Auto-Approve: {isAutoApprove ? 'ON' : 'OFF'}</span>
          </button>

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

          {onToggleCodebasePanel && (
            <button
              className={`icon-btn ${isCodebasePanelOpen ? 'is-active' : ''}`}
              type="button"
              aria-label="Toggle Codebase Activity Panel"
              title="Toggle Codebase Activity & Changes Panel"
              onClick={onToggleCodebasePanel}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="16 18 22 12 16 6"></polyline>
                <polyline points="8 6 2 12 8 18"></polyline>
              </svg>
            </button>
          )}

          {onToggleLog && (
            <button
              className={'icon-btn ' + (isLogOpen ? 'is-active' : '')}
              type="button"
              aria-label="Toggle application log"
              title="Open application log"
              onClick={onToggleLog}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 5h16v14H4z" /><path d="M7 9h10M7 12h7M7 15h5" />
              </svg>
            </button>
          )}

          <button
            className="icon-btn theme-toggle"
            type="button"
            aria-label={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            onClick={onToggleTheme}
          >
            {isDarkMode ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
