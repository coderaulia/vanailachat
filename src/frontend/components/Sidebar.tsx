import { DATE_FORMATTER } from '../lib/date';
import type { Chat } from '../types/chat';

interface SidebarProps {
  isOpen: boolean;
  currentChatId: string | null;
  histories: Array<[string, Chat]>;
  onClose: () => void;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
}

export function Sidebar({
  isOpen,
  currentChatId,
  histories,
  onClose,
  onNewChat,
  onSelectChat,
  onDeleteChat,
}: SidebarProps) {
  return (
    <>
      <button
        className={`sidebar-backdrop ${isOpen ? 'is-visible' : ''}`}
        type="button"
        aria-label="Close Chat Sidebar"
        onClick={onClose}
      ></button>

      <aside id="sidebar" className={`sidebar ${isOpen ? 'is-open' : ''}`} aria-label="Chat History">
        <div className="sidebar-content">
          <div className="sidebar-panel">
            <div className="sidebar-brand">
              <p className="sidebar-eyebrow">Local Ollama Workspace</p>
              <h1 className="sidebar-product">VanailaChat</h1>
              <p className="sidebar-copy">
                Browse recent chats, jump back into context, and start a fresh thread fast.
              </p>
            </div>

            <div className="sidebar-actions">
              <button
                className="btn btn-primary btn-block"
                type="button"
                aria-label="Start New Chat"
                onClick={onNewChat}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                New Chat
              </button>
            </div>
          </div>

          <div className="sidebar-section">
            <div className="section-heading">
              <div>
                <p className="section-eyebrow">Library</p>
                <h2 className="section-title">Recent Conversations</h2>
              </div>
              <span className="section-meta">{histories.length} chats</span>
            </div>

            <div className="history-list">
              {histories.map(([id, chat]) => (
                <div
                  key={id}
                  className={`history-item ${currentChatId === id ? 'active' : ''}`}
                  onClick={() => onSelectChat(id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      onSelectChat(id);
                    }
                  }}
                >
                  <div className="history-item__content">
                    <span className="history-item__title">{chat.title || 'Untitled chat'}</span>
                    <span className="history-item__meta">{DATE_FORMATTER.format(chat.updatedAt)}</span>
                  </div>
                  <button
                    className="history-item__delete"
                    type="button"
                    aria-label="Delete chat"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteChat(id);
                    }}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
