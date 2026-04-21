import { useState, useEffect } from 'react';
import type { ApiProject } from '../types/chat';
import { DATE_FORMATTER } from '../lib/date';
import './ProjectDetail.css';
import { Composer } from './Composer';
import { useChat } from '../context/ChatContext';

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
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [isEditingInstructions, setIsEditingInstructions] = useState(false);
  const [isEditingMemory, setIsEditingMemory] = useState(false);

  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [memory, setMemory] = useState('');

  useEffect(() => {
    if (project) {
      setDescription(project.description || '');
      setInstructions(project.instructions || '');
      setMemory(project.memory || '');
    }
  }, [project]);

  if (!project) return null;

  const onBack = () => setViewMode('chat');
  
  const onSelectChatLocal = (id: string) => {
    handleSelectChat(id);
    setViewMode('chat');
  };

  const saveProjectField = (field: keyof ApiProject, value: string) => {
    onUpdateProject(project.id, { [field]: value });
  };

  return (
    <div className="project-detail">
      <header className="project-detail__header">
        <button className="btn-back" onClick={onBack}>
          ← All projects
        </button>
        <div className="project-detail__title-row">
          <h1 className="project-detail__name">{project.name}</h1>
          <div className="project-detail__actions">
            <div className="project-detail__menu-container" style={{ position: 'relative' }}>
              <button
                className="icon-btn"
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                title="Project settings"
              >
                ⋮
              </button>
              {isMenuOpen && (
                <div className="project-menu-dropdown">
                  <button
                    className="menu-item menu-item--danger"
                    onClick={() => {
                      if (confirm('Are you sure you want to delete this project and all its chats?')) {
                        onDeleteProject(project.id);
                      }
                      setIsMenuOpen(false);
                    }}
                  >
                    Delete Project
                  </button>
                </div>
              )}
            </div>
            <button
              className={`icon-btn ${project.pinned ? 'icon-btn--active' : ''}`}
              onClick={() => onUpdateProject(project.id, { pinned: !project.pinned })}
              title={project.pinned ? "Unfavorite" : "Favorite"}
            >
              {project.pinned ? '★' : '☆'}
            </button>
          </div>
        </div>

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
            }}
          />
        ) : (
          <p
            className="project-detail__description"
            onClick={() => setIsEditingDescription(true)}
          >
            {description || 'Add a description for this project...'}
          </p>
        )}
      </header>

      <main className="project-detail__content">
        <div className="project-detail__main-col">
          <div className="project-detail__composer-wrap">
            <Composer thinkingSeconds={0} />
          </div>

          <section className="project-detail__chats">
            <h3 className="project-detail__section-label">Recent Conversations</h3>
            <div className="project-detail__chat-list">
              {chats.filter(([_, chat]) => chat.projectId === project.id).map(([id, chat]) => (
                <div
                  key={id}
                  className="project-detail__chat-card"
                  onClick={() => onSelectChatLocal(id)}
                >
                  <h4 className="project-detail__chat-title">{chat.title || 'Untitled chat'}</h4>
                  <p className="project-detail__chat-meta">
                    Last message {DATE_FORMATTER.format(chat.updatedAt)}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="project-detail__side-col">
          <div className="project-card project-card--memory">
            <div className="project-card__header">
              <h3 className="project-card__title">Memory</h3>
              <div className="project-card__actions">
                <span className="badge-lock">🔒 Only you</span>
                <button
                  className="icon-btn-edit"
                  onClick={() => setIsEditingMemory(!isEditingMemory)}
                >
                  ✎
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
                placeholder="Key facts about this project that the AI should remember..."
              />
            ) : (
              <p className="project-card__text">
                {memory || 'Add key project context...'}
              </p>
            )}
          </div>

          <div className="project-card project-card--instructions">
            <div className="project-card__header">
              <h3 className="project-card__title">Instructions</h3>
              <button
                className="icon-btn-edit"
                onClick={() => setIsEditingInstructions(!isEditingInstructions)}
              >
                ✎
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
                placeholder="General instructions for the AI when working on this project..."
              />
            ) : (
              <p className="project-card__text">
                {instructions || 'Add project-wide instructions...'}
              </p>
            )}
          </div>

          <div className="project-card project-card--files">
            <div className="project-card__header">
              <h3 className="project-card__title">Files</h3>
              <button className="icon-btn-add">+</button>
            </div>
            <div className="project-card__empty-files">
              <div className="files-placeholder-icons">
                <div className="file-icon"></div>
                <div className="file-icon"></div>
                <div className="file-icon"></div>
              </div>
              <p>Add PDFs, documents, or other text to reference in this project.</p>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
