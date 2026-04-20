import { useState } from 'react';
import type { MouseEvent } from 'react';
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
  onRenameChat: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
}

export function Sidebar({
  isOpen,
  currentChatId,
  histories,
  onClose,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onRenameChat,
  onTogglePin,
}: SidebarProps) {
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const beginRename = (event: MouseEvent, chatId: string, title: string) => {
    event.stopPropagation();
    setEditingChatId(chatId);
    setEditingTitle(title || 'Untitled chat');
  };

  const commitRename = (chatId: string) => {
    if (!editingChatId || editingChatId !== chatId) {
      return;
    }

    onRenameChat(chatId, editingTitle);
    setEditingChatId(null);
    setEditingTitle('');
  };

  const cancelRename = () => {
    setEditingChatId(null);
    setEditingTitle('');
  };

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
                    {editingChatId === id ? (
                      <input
                        className="history-item__title-input"
                        value={editingTitle}
                        autoFocus
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => setEditingTitle(event.target.value)}
                        onBlur={() => commitRename(id)}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            commitRename(id);
                          }

                          if (event.key === 'Escape') {
                            event.preventDefault();
                            cancelRename();
                          }
                        }}
                      />
                    ) : (
                      <span
                        className="history-item__title"
                        onDoubleClick={(event) => beginRename(event, id, chat.title)}
                        title="Double-click to rename"
                      >
                        {chat.title || 'Untitled chat'}
                      </span>
                    )}
                    <span className="history-item__meta">{DATE_FORMATTER.format(chat.updatedAt)}</span>
                  </div>

                  <div className={`history-item__actions ${chat.pinned ? 'is-pinned' : ''}`}>
                    <button
                      className={`history-item__pin ${chat.pinned ? 'is-pinned' : ''}`}
                      type="button"
                      aria-label={chat.pinned ? 'Unpin chat' : 'Pin chat'}
                      onClick={(event) => {
                        event.stopPropagation();
                        onTogglePin(id);
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 17v5"></path>
                        <path d="m9 10-3 3"></path>
                        <path d="m15 10 3 3"></path>
                        <path d="M8 3h8l-1 7H9L8 3z"></path>
                      </svg>
                    </button>

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
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
