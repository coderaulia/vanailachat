import { useState, useEffect } from 'react';
import type { ApiProject, Chat, Attachment } from '../types/chat';
import type { ModelRole } from '../config/modelRoles';
import { DATE_FORMATTER } from '../lib/date';
import { Composer } from './Composer';

interface ProjectDetailProps {
  project: ApiProject;
  chats: Array<[string, Chat]>;
  onBack: () => void;
  onSelectChat: (id: string) => void;
  onUpdateProject: (id: string, updates: Partial<ApiProject>) => void;
  onDeleteProject: (id: string) => void;
  // Composer props
  prompt: string;
  setPrompt: (v: string) => void;
  onSend: (event?: React.FormEvent) => Promise<void>;
  availableModels: string[];
  selectedModel: string;
  onSelectModel: (m: string) => void;
  attachedFiles: Attachment[];
  onAttach: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  onRemoveAttachment: (index: number) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onPickProjectRoot: () => Promise<void>;
  onRefreshModels: () => void;

  // Missing Composer props to prevent crashes
  shouldShowRoleSuggestion: boolean;
  suggestedModelName: string;
  suggestedRoleLabel: string;
  onAbort: () => void;
}

export function ProjectDetail({
  project,
  chats,
  onBack,
  onSelectChat,
  onUpdateProject,
  onDeleteProject,
  prompt,
  setPrompt,
  onSend,
  availableModels,
  selectedModel,
  onSelectModel,
  attachedFiles,
  onAttach,
  onRemoveAttachment,
  fileInputRef,
  onPickProjectRoot,
  onRefreshModels,
  shouldShowRoleSuggestion,
  suggestedModelName,
  suggestedRoleLabel,
  onAbort,
}: ProjectDetailProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [isEditingInstructions, setIsEditingInstructions] = useState(false);
  const [isEditingMemory, setIsEditingMemory] = useState(false);

  const [description, setDescription] = useState(project.description || '');
  const [instructions, setInstructions] = useState(project.instructions || '');
  const [memory, setMemory] = useState(project.memory || '');

  useEffect(() => {
    setDescription(project.description || '');
    setInstructions(project.instructions || '');
    setMemory(project.memory || '');
  }, [project]);

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
            <Composer
              prompt={prompt}
              onSetPrompt={setPrompt}
              onSend={onSend}
              attachedFiles={attachedFiles}
              onAttach={onAttach}
              onRemoveAttachment={onRemoveAttachment}
              fileInputRef={fileInputRef}
              statusText="How can I help you today?"
              isCurrentChatSending={false}
              thinkingSeconds={0}
              availableModels={availableModels}
              selectedModel={selectedModel}
              onSelectModel={onSelectModel}
              selectedRole="general"
              onSelectRole={() => { }}
              isSearchEnabled={false}
              onToggleSearch={() => { }}
              onNewChat={() => { }}

              // Safe defaults for remaining props
              shouldShowRoleSuggestion={shouldShowRoleSuggestion}
              suggestedModelName={suggestedModelName}
              suggestedRoleLabel={suggestedRoleLabel}
              onRoleAcceptSuggestion={() => { }}
              onRoleDismissSuggestion={() => { }}
              systemPrompt={project.instructions || ''}
              onSetSystemPrompt={() => { }}
              onSaveSystemPrompt={() => { }}
              projectRoot=""
              onSetProjectRoot={() => { }}
              onSaveProjectRoot={() => { }}
              onPickProjectRoot={onPickProjectRoot}
              onRefreshModels={onRefreshModels}
              onAbort={onAbort}
            />
          </div>

          <section className="project-detail__chats">
            <h3 className="project-detail__section-label">Recent Conversations</h3>
            <div className="project-detail__chat-list">
              {chats.filter(([_, chat]) => chat.projectId === project.id).map(([id, chat]) => (
                <div
                  key={id}
                  className="project-detail__chat-card"
                  onClick={() => onSelectChat(id)}
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
