import type { ChangeEvent, FormEvent, RefObject } from 'react';
import { MODEL_ROLE_LABELS } from '../config/modelRoles';
import type { ModelRole } from '../config/modelRoles';
import type { Attachment, ContextWindow } from '../types/chat';
import { ModelSelector } from './ModelSelector';
import './Composer.css';

interface ComposerProps {
  attachedFiles: Attachment[];
  availableModels: string[];
  contextPercentage?: number;
  contextWindow?: ContextWindow;
  fileInputRef: RefObject<HTMLInputElement | null>;
  isCurrentChatSending: boolean;
  isSearchEnabled: boolean;
  prompt: string;
  projectRoot: string;
  selectedRole: ModelRole;
  selectedModel: string;
  shouldShowRoleSuggestion: boolean;
  statusText: string;
  suggestedModelName: string;
  suggestedRoleLabel: string;
  systemPrompt: string;
  thinkingSeconds: number;
  onAttach: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  onNewChat: () => void;
  onRemoveAttachment: (index: number) => void;
  onRoleAcceptSuggestion: () => void;
  onRoleDismissSuggestion: () => void;
  onSaveProjectRoot: () => void;
  onPickProjectRoot: () => Promise<void>;
  onSelectRole: (role: ModelRole) => void;
  onSelectModel: (model: string) => void;
  onSend: (event?: FormEvent) => Promise<void>;
  onSetPrompt: (value: string) => void;
  onSetProjectRoot: (value: string) => void;
  onSetSystemPrompt: (value: string) => void;
  onSaveSystemPrompt: () => void;
  onToggleSearch: () => void;
  onRefreshModels?: () => void;
  onAbort?: () => void;
}

export function Composer({
  attachedFiles,
  availableModels,
  contextPercentage,
  contextWindow,
  fileInputRef,
  isCurrentChatSending,
  isSearchEnabled,
  prompt,
  projectRoot,
  selectedRole,
  selectedModel,
  shouldShowRoleSuggestion,
  statusText,
  suggestedModelName,
  suggestedRoleLabel,
  systemPrompt,
  thinkingSeconds,
  onAttach,
  onNewChat,
  onRemoveAttachment,
  onRoleAcceptSuggestion,
  onRoleDismissSuggestion,
  onSaveProjectRoot,
  onPickProjectRoot,
  onSelectRole,
  onSelectModel,
  onSend,
  onSetPrompt,
  onSetProjectRoot,
  onSetSystemPrompt,
  onSaveSystemPrompt,
  onToggleSearch,
  onRefreshModels,
  onAbort,
}: ComposerProps) {
  return (
    <footer className="app-footer">
      <form className="chat-form" onSubmit={onSend}>
        <div className="composer">

          <details className="system-prompt-panel">
            <summary>System Prompt</summary>
            <textarea
              className="textarea system-prompt-textarea"
              rows={3}
              value={systemPrompt}
              onChange={(event) => onSetSystemPrompt(event.target.value)}
              onBlur={onSaveSystemPrompt}
              placeholder="You are a helpful assistant."
            ></textarea>
          </details>

          {selectedRole === 'coding' ? (
            <div className="project-root-field">
              <label>Project Root</label>
              <input
                className="project-root-input"
                value={projectRoot}
                onChange={(event) => onSetProjectRoot(event.target.value)}
                onBlur={onSaveProjectRoot}
                placeholder="/absolute/path/to/project"
              />
              <button
                type="button"
                className="btn btn-secondary icon-btn project-root-picker"
                onClick={onPickProjectRoot}
                title="Open Folder"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                </svg>
              </button>
            </div>
          ) : null}

          {attachedFiles.length > 0 && (
            <div className="attachment-tray">
              {attachedFiles.map((file, index) => (
                <div key={`${file.name}-${index}`} className={`attachment-pill ${file.type === 'image' ? 'has-image' : ''}`}>
                  {file.type === 'image' ? (
                    <img src={file.content} alt={file.name} className="attachment-image-preview" />
                  ) : (
                    <span>{file.name}</span>
                  )}
                  <button type="button" className="attachment-remove" onClick={() => onRemoveAttachment(index)}>
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            className="textarea"
            placeholder="Ask for code, debugging help, or a quick explanation…"
            rows={3}
            value={prompt}
            onChange={(event) => onSetPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void onSend();
              }
            }}
          ></textarea>

          <div className="composer-footer">
            <div className="composer-footer__left">
              <div className="role-picker">
                {Object.entries(MODEL_ROLE_LABELS).map(([role, label]) => (
                  <button
                    key={role}
                    type="button"
                    className={`role-chip ${selectedRole === role ? 'active' : ''}`}
                    onClick={() => onSelectRole(role as ModelRole)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="chat-status" aria-live="polite">
                <span className="status-text">{statusText}</span>
                {isCurrentChatSending ? <span className="thinking-badge">Thinking… {thinkingSeconds}s</span> : null}
              </div>
            </div>

            <div className="composer-footer__right">
              <div className="composer-meta">
                <div className="composer-model">
                  <label>Model</label>
                  <ModelSelector
                    availableModels={availableModels}
                    selectedModel={selectedModel}
                    onSelectModel={onSelectModel}
                    onRefresh={onRefreshModels}
                  />
                </div>

                {contextWindow && (
                  <div className="composer-context">
                    <label>Context</label>
                    <div className="context-status">
                      <span className="context-status__text">
                        {contextWindow.current} / {contextWindow.total}
                      </span>
                      <span className="context-status__meter">
                        <span className="context-status__meter-fill" style={{ width: `${contextPercentage ?? 0}%` }}></span>
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="composer-actions">
                <button type="button" className="btn btn-secondary" onClick={onNewChat}>
                  Clear
                </button>

                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={onAttach}
                  multiple
                  hidden
                  accept="image/*,.txt,.md,.js,.ts,.tsx,.jsx,.py,.html,.css,.json,.csv,.log,.sh,.rs,.go,.cpp,.c,.h,.hpp,.java,.php"
                />

                <div className="icon-group">
                  <button
                    type="button"
                    className={`btn btn-secondary icon-btn ${isSearchEnabled ? 'active' : ''} ${
                      isCurrentChatSending && isSearchEnabled ? 'is-loading' : ''
                    }`}
                    onClick={onToggleSearch}
                    title={isCurrentChatSending && isSearchEnabled ? 'Searching web...' : 'Enable Web Search'}
                    aria-busy={isCurrentChatSending && isSearchEnabled}
                    disabled={isCurrentChatSending}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="8"></circle>
                      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                  </button>

                  <button
                    type="button"
                    className="btn btn-secondary icon-btn"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                    </svg>
                  </button>
                </div>

                {isCurrentChatSending ? (
                  <button type="button" className="btn btn-danger send-btn" onClick={onAbort}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="6" y="6" width="12" height="12"></rect>
                    </svg>
                    <span>Stop</span>
                  </button>
                ) : (
                  <button type="submit" className="btn btn-primary send-btn" disabled={isCurrentChatSending}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <line x1="22" y1="2" x2="11" y2="13"></line>
                      <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                    </svg>
                    <span>Send</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {shouldShowRoleSuggestion ? (
            <div className="role-suggestion" aria-live="polite">
              <span>
                This looks like a {suggestedRoleLabel.toLowerCase()} task. Switch to {suggestedModelName}?
              </span>
              <div className="role-suggestion__actions">
                <button type="button" className="btn btn-secondary" onClick={onRoleDismissSuggestion}>
                  Dismiss
                </button>
                <button type="button" className="btn btn-primary" onClick={onRoleAcceptSuggestion}>
                  Accept
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </form>
    </footer>
  );
}
