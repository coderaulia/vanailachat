import { useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { DATE_FORMATTER } from '../lib/date';
import type { Chat } from '../types/chat';
import './Sidebar.css';

import { useChat } from '../context/ChatContext';

export function Sidebar() {
  const {
    isSidebarOpen: isOpen,
    closeSidebar: onClose,
    currentChatId,
    sortedHistories: histories,
    projects,
    selectedProjectId,
    handleNewChat,
    handleSelectProject: onSelectProject,
    handleCreateProject: onCreateProject,
    handleExportData: onExport,
    handleImportData: onImport,
    handleSelectChat,
    handleDeleteChat: onDeleteChat,
    handleRenameChat: onRenameChat,
    handleTogglePin: onTogglePin,
    setViewMode,
  } = useChat();

  const onNewChatLocal = () => {
    handleNewChat();
    setViewMode('chat');
  };

  const onSelectChatLocal = (id: string) => {
    handleSelectChat(id);
    setViewMode('chat');
  };

  const onViewProjectDetail = () => setViewMode('project');
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
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

  const filteredHistories = histories.filter(([, chat]) => {
    if (chat.projectId !== selectedProjectId) return false;
    if (!searchQuery.trim()) return true;
    return chat.title?.toLowerCase().includes(searchQuery.toLowerCase());
  });

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
              <div className="project-switcher__header">
                <label htmlFor="project-select">Project</label>
                <button
                  className="btn-add-project"
                  type="button"
                  aria-label="Create project"
                  onClick={() => {
                    setIsCreatingProject(true);
                    setNewProjectName('');
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                </button>
              </div>

              <div className="project-switcher__controls">
                <div className="project-select-container">
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
                </div>
                <button
                  className="btn-open-project"
                  type="button"
                  aria-label="View project detail"
                  title="Open Project Workspace"
                  onClick={onViewProjectDetail}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 2H2v10h10V2z"></path>
                    <path d="M22 12h-10v10h10V12z"></path>
                    <path d="M12 12H2v10h10V12z"></path>
                    <path d="M22 2h-10v10h10V2z"></path>
                  </svg>
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
                onClick={onNewChatLocal}
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
              <span className="section-meta">{filteredHistories.length} chats</span>
            </div>

            <div className="sidebar-search">
              <svg className="sidebar-search__icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="search"
                className="sidebar-search__input"
                placeholder="Search chats…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="sidebar-search__clear"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                >×</button>
              )}
            </div>

            <div className="history-list">
              {filteredHistories.map(([id, chat]) => (
                <button
                  key={id}
                  className={`history-item ${currentChatId === id ? 'is-active' : ''} ${chat.pinned ? 'is-pinned' : ''}`}
                  type="button"
                  onClick={() => onSelectChatLocal(id)}
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
                      className="history-item__rename"
                      type="button"
                      aria-label="Rename chat"
                      onClick={(event) => beginRename(event, id, chat.title)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                      </svg>
                    </button>

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
                </button>
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
