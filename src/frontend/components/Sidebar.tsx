import { useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { DATE_FORMATTER } from '../lib/date';
import type { Chat } from '../types/chat';

interface ProjectOption {
  id: string;
  name: string;
  createdAt: number;
}

interface SidebarProps {
  isOpen: boolean;
  currentChatId: string | null;
  histories: Array<[string, Chat]>;
  projects: ProjectOption[];
  selectedProjectId: string | null;
  onClose: () => void;
  onNewChat: () => void;
  onSelectProject: (id: string) => void;
  onCreateProject: (name: string) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onSelectChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
  onRenameChat: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
}

export function Sidebar({
  isOpen,
  currentChatId,
  histories,
  projects,
  selectedProjectId,
  onClose,
  onNewChat,
  onSelectProject,
  onCreateProject,
  onExport,
  onImport,
  onSelectChat,
  onDeleteChat,
  onRenameChat,
  onTogglePin,
}: SidebarProps) {
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const importInputRef = useRef<HTMLInputElement>(null);

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

  const commitProjectCreate = () => {
    if (!newProjectName.trim()) {
      setIsCreatingProject(false);
      setNewProjectName('');
      return;
    }

    onCreateProject(newProjectName);
    setIsCreatingProject(false);
    setNewProjectName('');
  };

  const handleProjectKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitProjectCreate();
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setIsCreatingProject(false);
      setNewProjectName('');
    }
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

            <div className="project-switcher">
              <label htmlFor="project-select">Project</label>
              <div className="project-switcher__controls">
                <select
                  id="project-select"
                  className="select project-select"
                  value={selectedProjectId ?? ''}
                  onChange={(event) => onSelectProject(event.target.value)}
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-secondary icon-btn"
                  type="button"
                  aria-label="Create project"
                  onClick={() => {
                    setIsCreatingProject(true);
                    setNewProjectName('');
                  }}
                >
                  +
                </button>
              </div>

              {isCreatingProject ? (
                <input
                  className="project-input"
                  autoFocus
                  value={newProjectName}
                  onChange={(event) => setNewProjectName(event.target.value)}
                  onBlur={commitProjectCreate}
                  onKeyDown={handleProjectKeyDown}
                  placeholder="New project name"
                />
              ) : null}
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

            <div className="sidebar-footer">
              <button className="btn btn-secondary btn-block" type="button" onClick={onExport}>
                Export
              </button>
              <input
                ref={importInputRef}
                type="file"
                hidden
                accept=".json,application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) {
                    return;
                  }

                  onImport(file);
                  event.currentTarget.value = '';
                }}
              />
              <button
                className="btn btn-secondary btn-block"
                type="button"
                onClick={() => importInputRef.current?.click()}
              >
                Import
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
