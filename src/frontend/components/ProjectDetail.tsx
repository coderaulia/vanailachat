import { useState, useEffect, useMemo } from 'react';
import type { ApiProject } from '../types/chat';
import { DATE_FORMATTER } from '../lib/date';
import './ProjectDetail.css';
import { Composer } from './Composer';
import { useChat } from '../context/ChatContext';

function RoleIcon({ role }: { role: string }) {
  if (role === 'coding') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    );
  }
  if (role === 'vision') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3" />
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
      </svg>
    );
  }
  if (role === 'writing' || role === 'creative') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 19l7-7 3 3-7 7-3-3z" />
        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
        <path d="M2 2l7.586 7.586" />
        <circle cx="11" cy="11" r="2" />
      </svg>
    );
  }
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function ProjectDetail() {
  const {
    projects,
    selectedProjectId,
    sortedHistories: chats,
    setViewMode,
    handleSelectChat,
    handleUpdateProject: onUpdateProject,
    handleDeleteProject: onDeleteProject,
  } = useChat();

  const project = projects.find(p => p.id === selectedProjectId);

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [isEditingInstructions, setIsEditingInstructions] = useState(false);
  const [isEditingMemory, setIsEditingMemory] = useState(false);
  const [chatSearch, setChatSearch] = useState('');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [memory, setMemory] = useState('');

  useEffect(() => {
    if (project) {
      setName(project.name || '');
      setDescription(project.description || '');
      setInstructions(project.instructions || '');
      setMemory(project.memory || '');
    }
  }, [project]);

  const projectChats = useMemo(
    () => chats.filter((entry) => entry[1].projectId === project?.id),
    [chats, project?.id]
  );

  const filteredChats = useMemo(() => {
    if (!chatSearch.trim()) return projectChats;
    return projectChats.filter((entry) =>
      entry[1].title?.toLowerCase().includes(chatSearch.toLowerCase())
    );
  }, [projectChats, chatSearch]);

  const totalTokens = useMemo(
    () => projectChats.reduce((sum, entry) => sum + (entry[1].usage ?? 0), 0),
    [projectChats]
  );

  if (!project) return null;

  const onBack = () => setViewMode('projects');
  const onGoToChat = () => setViewMode('chat');

  const onSelectChatLocal = (id: string) => {
    handleSelectChat(id);
    setViewMode('chat');
  };

  const saveProjectField = (field: keyof ApiProject, value: string) => {
    onUpdateProject(project.id, { [field]: value });
  };

  const formatTokens = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` :
    n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);

  return (
    <div className="project-detail">
      {/* Header */}
      <header className="project-detail__header">
        <div className="project-detail__breadcrumb">
          <button className="btn-back" type="button" onClick={onBack} title="Back to Workspaces Overview">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Workspaces
          </button>
          <span className="project-detail__breadcrumb-sep">/</span>
          {isEditingName ? (
            <input
              className="project-detail__name-input"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                setIsEditingName(false);
                if (name.trim()) saveProjectField('name', name.trim());
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setIsEditingName(false);
                  if (name.trim()) saveProjectField('name', name.trim());
                }
                if (e.key === 'Escape') setIsEditingName(false);
              }}
            />
          ) : (
            <span
              className="project-detail__breadcrumb-name"
              onDoubleClick={() => setIsEditingName(true)}
              title="Double-click to rename"
            >
              {project.name}
            </span>
          )}
          <button
            className="btn-back-chat"
            type="button"
            onClick={onGoToChat}
            title="Return to Chat"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span>Chat</span>
          </button>
        </div>

        <div className="project-detail__title-row">
          <h1 className="project-detail__name">{project.name}</h1>
          <div className="project-detail__actions">
            <button
              className={`icon-btn ${project.pinned ? 'icon-btn--active' : ''}`}
              type="button"
              onClick={() => onUpdateProject(project.id, { pinned: !project.pinned })}
              title={project.pinned ? 'Unfavorite' : 'Favorite'}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill={project.pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </button>
            <div className="project-detail__menu-container">
              <button
                className="icon-btn"
                type="button"
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                title="Project options"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="5" r="1.5" fill="currentColor" />
                  <circle cx="12" cy="12" r="1.5" fill="currentColor" />
                  <circle cx="12" cy="19" r="1.5" fill="currentColor" />
                </svg>
              </button>
              {isMenuOpen && (
                <div className="project-menu-dropdown">
                  <button
                    className="menu-item"
                    type="button"
                    onClick={() => { setIsEditingName(true); setIsMenuOpen(false); }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                    Rename project
                  </button>
                  <div className="menu-divider" />
                  <button
                    className="menu-item menu-item--danger"
                    type="button"
                    onClick={() => {
                      if (confirm('Delete this project and all its chats?')) {
                        onDeleteProject(project.id);
                      }
                      setIsMenuOpen(false);
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                    Delete project
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Description */}
        {isEditingDescription ? (
          <input
            className="project-detail__desc-input"
            value={description}
            autoFocus
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => {
              setIsEditingDescription(false);
              saveProjectField('description', description);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setIsEditingDescription(false);
                saveProjectField('description', description);
              }
              if (e.key === 'Escape') setIsEditingDescription(false);
            }}
            placeholder="Add a short description…"
          />
        ) : (
          <p
            className={`project-detail__description ${!description ? 'is-placeholder' : ''}`}
            onClick={() => setIsEditingDescription(true)}
            title="Click to edit description"
          >
            {description || 'Click to add a description…'}
          </p>
        )}

        {/* Stats chips */}
        <div className="project-detail__stats">
          <div className="project-stat-chip">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span className="project-stat__value">{projectChats.length}</span>
            <span className="project-stat__label">conversations</span>
          </div>
          {totalTokens > 0 && (
            <div className="project-stat-chip">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span className="project-stat__value">{formatTokens(totalTokens)}</span>
              <span className="project-stat__label">tokens</span>
            </div>
          )}
          <div className="project-stat-chip">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span className="project-stat__label">Created {DATE_FORMATTER.format(project.createdAt)}</span>
          </div>
        </div>
      </header>

      <main className="project-detail__content">
        {/* Main column */}
        <div className="project-detail__main-col">
          {/* Quick-start composer */}
          <div className="project-detail__composer-wrap">
            <Composer thinkingSeconds={0} />
          </div>

          {/* Chat history */}
          <section className="project-detail__chats">
            <div className="project-detail__chats-header">
              <h3 className="project-detail__section-label">Conversations</h3>
              {projectChats.length > 4 && (
                <div className="project-detail__chat-search">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    type="search"
                    placeholder="Filter conversations…"
                    value={chatSearch}
                    onChange={(e) => setChatSearch(e.target.value)}
                    className="project-detail__chat-search-input"
                  />
                </div>
              )}
            </div>

            {filteredChats.length === 0 ? (
              <div className="project-detail__chat-empty">
                {chatSearch ? (
                  <>
                    <span className="project-detail__chat-empty-icon">🔍</span>
                    <p>No conversations match "<strong>{chatSearch}</strong>"</p>
                  </>
                ) : (
                  <>
                    <span className="project-detail__chat-empty-icon">💬</span>
                    <p>No conversations yet. Start one above!</p>
                  </>
                )}
              </div>
            ) : (
              <div className="project-detail__chat-list">
                {filteredChats.map(([id, chat]) => {
                  const modelShort = chat.model
                    ? chat.model.split(':')[0].split('/').pop() ?? chat.model
                    : null;
                  return (
                    <div
                      key={id}
                      className="project-detail__chat-card"
                      onClick={() => onSelectChatLocal(id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectChatLocal(id);
                        }
                      }}
                    >
                      <div className="project-detail__chat-card-left">
                        <span className="project-detail__chat-role-icon">
                          <RoleIcon role={chat.role ?? 'general'} />
                        </span>
                      </div>
                      <div className="project-detail__chat-card-body">
                        <h4 className="project-detail__chat-title">
                          {chat.title || 'Untitled conversation'}
                          {chat.pinned && (
                            <span className="project-detail__chat-pin" title="Pinned">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
                              </svg>
                            </span>
                          )}
                        </h4>
                        <div className="project-detail__chat-meta-row">
                          {modelShort && (
                            <span className="project-detail__chat-model-badge">{modelShort}</span>
                          )}
                          {chat.usage != null && chat.usage > 0 && (
                            <span className="project-detail__chat-tokens">
                              {formatTokens(chat.usage)} tokens
                            </span>
                          )}
                          <span className="project-detail__chat-date">
                            {DATE_FORMATTER.format(chat.updatedAt)}
                          </span>
                        </div>
                      </div>
                      <div className="project-detail__chat-card-arrow">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Side column */}
        <aside className="project-detail__side-col">
          {/* Memory */}
          <div className="project-card project-card--memory">
            <div className="project-card__header">
              <h3 className="project-card__title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2a4 4 0 0 0-4 4c0 .7.2 1.4.5 2H8a4 4 0 0 0-4 4 4 4 0 0 0 2 3.5V18a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4v-2.5a4 4 0 0 0 2-3.5 4 4 0 0 0-4-4h-.5c.3-.6.5-1.3.5-2a4 4 0 0 0-4-4z" />
                </svg>
                Memory
              </h3>
              <div className="project-card__actions">
                <span className="badge-lock">Private</span>
                <button
                  className="icon-btn-edit"
                  type="button"
                  onClick={() => setIsEditingMemory(!isEditingMemory)}
                  title="Edit memory"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                </button>
              </div>
            </div>
            {isEditingMemory ? (
              <textarea
                className="project-card__textarea"
                value={memory}
                autoFocus
                onChange={(e) => setMemory(e.target.value)}
                onBlur={() => {
                  setIsEditingMemory(false);
                  saveProjectField('memory', memory);
                }}
                placeholder="Key facts the AI should remember about this project…"
              />
            ) : (
              <p
                className={`project-card__text ${!memory ? 'is-placeholder' : ''}`}
                onClick={() => setIsEditingMemory(true)}
              >
                {memory || 'Click to add key context the AI should remember…'}
              </p>
            )}
          </div>

          {/* Instructions */}
          <div className="project-card project-card--instructions">
            <div className="project-card__header">
              <h3 className="project-card__title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                Instructions
              </h3>
              <button
                className="icon-btn-edit"
                type="button"
                onClick={() => setIsEditingInstructions(!isEditingInstructions)}
                title="Edit instructions"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
              </button>
            </div>
            {isEditingInstructions ? (
              <textarea
                className="project-card__textarea"
                value={instructions}
                autoFocus
                onChange={(e) => setInstructions(e.target.value)}
                onBlur={() => {
                  setIsEditingInstructions(false);
                  saveProjectField('instructions', instructions);
                }}
                placeholder="Project-wide instructions for the AI (tone, output format, constraints)…"
              />
            ) : (
              <p
                className={`project-card__text ${!instructions ? 'is-placeholder' : ''}`}
                onClick={() => setIsEditingInstructions(true)}
              >
                {instructions || 'Click to add project-wide AI instructions…'}
              </p>
            )}
          </div>

          {/* Quick actions */}
          <div className="project-card project-card--actions">
            <div className="project-card__header">
              <h3 className="project-card__title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
                Quick Actions
              </h3>
            </div>
            <div className="project-quick-actions">
              <button
                className="project-quick-action"
                type="button"
                onClick={() => { setViewMode('chat'); }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                New conversation
              </button>
              <button
                className="project-quick-action"
                type="button"
                onClick={() => { setIsEditingMemory(true); }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                Update memory
              </button>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
