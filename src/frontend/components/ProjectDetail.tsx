import { useState, useEffect, useMemo } from 'react';
import type { ApiProject } from '../types/chat';
import { DATE_FORMATTER } from '../lib/date';
import './ProjectDetail.css';
import { Composer } from './Composer';
import { useChat } from '../context/ChatContext';

const MODEL_ROLE_EMOJI: Record<string, string> = {
  coding: '💻',
  creative: '✨',
  vision: '👁️',
  general: '🤖',
};

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

  const onBack = () => setViewMode('chat');

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
          <button className="btn-back" type="button" onClick={onBack}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Projects
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
              {project.pinned ? '★' : '☆'}
            </button>
            <div className="project-detail__menu-container">
              <button
                className="icon-btn"
                type="button"
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                title="Project options"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="5" r="1" fill="currentColor" />
                  <circle cx="12" cy="12" r="1" fill="currentColor" />
                  <circle cx="12" cy="19" r="1" fill="currentColor" />
                </svg>
              </button>
              {isMenuOpen && (
                <div className="project-menu-dropdown">
                  <button
                    className="menu-item"
                    type="button"
                    onClick={() => { setIsEditingName(true); setIsMenuOpen(false); }}
                  >
                    ✏️ Rename project
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
                    🗑️ Delete project
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

        {/* Stats row */}
        <div className="project-detail__stats">
          <div className="project-stat">
            <span className="project-stat__value">{projectChats.length}</span>
            <span className="project-stat__label">Conversations</span>
          </div>
          <div className="project-stat__divider" />
          {totalTokens > 0 && (
            <>
              <div className="project-stat">
                <span className="project-stat__value">{formatTokens(totalTokens)}</span>
                <span className="project-stat__label">Tokens used</span>
              </div>
              <div className="project-stat__divider" />
            </>
          )}
          <div className="project-stat">
            <span className="project-stat__value">
              {DATE_FORMATTER.format(project.createdAt)}
            </span>
            <span className="project-stat__label">Created</span>
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
                  const roleEmoji = MODEL_ROLE_EMOJI[chat.role ?? 'general'] ?? '🤖';
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
                        <span className="project-detail__chat-role-icon">{roleEmoji}</span>
                      </div>
                      <div className="project-detail__chat-card-body">
                        <h4 className="project-detail__chat-title">
                          {chat.title || 'Untitled conversation'}
                          {chat.pinned && <span className="project-detail__chat-pin" title="Pinned">📌</span>}
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
                🧠 Memory
              </h3>
              <div className="project-card__actions">
                <span className="badge-lock">🔒 Private</span>
                <button
                  className="icon-btn-edit"
                  type="button"
                  onClick={() => setIsEditingMemory(!isEditingMemory)}
                  title="Edit memory"
                >✎</button>
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
                📋 Instructions
              </h3>
              <button
                className="icon-btn-edit"
                type="button"
                onClick={() => setIsEditingInstructions(!isEditingInstructions)}
                title="Edit instructions"
              >✎</button>
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
              <h3 className="project-card__title">⚡ Quick Actions</h3>
            </div>
            <div className="project-quick-actions">
              <button
                className="project-quick-action"
                type="button"
                onClick={() => { setViewMode('chat'); }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                New conversation
              </button>
              <button
                className="project-quick-action"
                type="button"
                onClick={() => { setIsEditingMemory(true); }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
