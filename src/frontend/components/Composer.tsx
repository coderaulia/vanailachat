import { useState } from 'react';
import { MODEL_ROLE_LABELS } from '../config/modelRoles';
import type { ModelRole } from '../config/modelRoles';
import { ROLE_TO_PERSONA, getPersonaForRole } from '../config/personas';
import { ModelSelector } from './ModelSelector';
import { ABTestModal } from './ABTestModal';
import { FolderPicker } from './FolderPicker';
import './Composer.css';

import { useChat } from '../context/ChatContext';

interface ComposerProps {
  thinkingSeconds: number;
}

export function Composer({ thinkingSeconds }: ComposerProps) {
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [isResearchEnabled, setIsResearchEnabled] = useState(false);
  const [showABTest, setShowABTest] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);

  const {
    attachedFiles,
    filteredAvailableModels: availableModels,
    contextPercentage,
    contextWindow,
    fileInputRef,
    isCurrentChatSending,
    isSearchEnabled,
    modelMetadata,
    setPersona,
    prompt,
    projectRoot,
    providers,
    selectedRole,
    selectedModel,
    shouldShowRoleSuggestion,
    statusText,
    suggestedModelName,
    suggestedRoleLabel,
    systemPrompt,
    handleAttach: onAttach,
    handleNewChat: onNewChat,
    removeAttachment: onRemoveAttachment,
    handleAcceptRoleSuggestion: onRoleAcceptSuggestion,
    handleDismissRoleSuggestion: onRoleDismissSuggestion,
    handleSaveProjectRoot: onSaveProjectRoot,
    handlePickProjectRoot: onPickProjectRoot,
    handleSelectRole: onSelectRole,
    setSelectedModel: onSelectModel,
    handleSend: onSend,
    setPrompt: onSetPrompt,
    handleProjectRootChange: onSetProjectRoot,
    handleSystemPromptChange: onSetSystemPrompt,
    handleSaveSystemPrompt: onSaveSystemPrompt,
    setIsSearchEnabled,
    handleRefreshModels: onRefreshModels,
    handleAbort: onAbort,
  } = useChat();

  const onToggleSearch = () => setIsSearchEnabled((prev: boolean) => !prev);

  /** Click a role chip: set role, sync persona, populate system prompt */
  const handleRoleClick = (role: ModelRole) => {
    onSelectRole(role);
    const personaId = ROLE_TO_PERSONA[role] ?? 'general';
    setPersona(personaId);
    const persona = getPersonaForRole(role);
    if (persona) {
      onSetSystemPrompt(persona.systemPrompt);
      // Auto-save so the backend gets the updated prompt
      setTimeout(() => onSaveSystemPrompt(), 0);
    }
  };

  const activePersona = getPersonaForRole(selectedRole);

  const handleSubmit = (event: React.FormEvent) => {
    onSend(event);
  };

  return (
    <>
    <footer className="app-footer">
      <form className="chat-form" onSubmit={handleSubmit}>
        <div className="composer">

          {/* System prompt popover */}
          {showSystemPrompt && (
            <div className="system-prompt-popover">
              <div className="system-prompt-popover__header">
                <span className="system-prompt-popover__title">System Prompt</span>
                <span className="system-prompt-persona-badge">
                  {activePersona.icon} {activePersona.name} — edit freely
                </span>
                <button
                  type="button"
                  className="icon-btn system-prompt-close"
                  onClick={() => setShowSystemPrompt(false)}
                  aria-label="Close system prompt"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
              <textarea
                className="textarea system-prompt-textarea"
                rows={6}
                value={systemPrompt}
                onChange={(event) => onSetSystemPrompt(event.target.value)}
                onBlur={onSaveSystemPrompt}
                placeholder={activePersona.systemPrompt}
              ></textarea>
              <div className="system-prompt-hint">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                Injected as system context on every message. Switching roles reloads the default prompt.
              </div>
            </div>
          )}

          {/* Project root — coding role only */}
          {selectedRole === 'coding' ? (
            <div className="project-root-field">
              {showFolderPicker && (
                <FolderPicker
                  initialPath={projectRoot}
                  onClose={() => setShowFolderPicker(false)}
                  onSelect={(picked) => {
                    setShowFolderPicker(false);
                    onPickProjectRoot(picked);
                  }}
                />
              )}
              <label>Workspace</label>
              <input
                className="project-root-input"
                value={projectRoot}
                onChange={(event) => onSetProjectRoot(event.target.value)}
                onBlur={onSaveProjectRoot}
                placeholder="Pick a folder for Claude Code to work in"
              />
              <button
                type="button"
                className="btn btn-secondary icon-btn project-root-picker"
                onClick={() => setShowFolderPicker((open) => !open)}
                title="Browse for a folder"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                </svg>
              </button>
            </div>
          ) : null}

          {/* Attachment tray */}
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

          {/* Main input */}
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

          {/* Unified toolbar */}
          <div className="composer-toolbar">
            {/* Left: role chips */}
            <div className="role-picker">
              {Object.entries(MODEL_ROLE_LABELS).map(([role, label]) => (
                <button
                  key={role}
                  type="button"
                  className={`role-chip ${selectedRole === role ? 'active' : ''}`}
                  onClick={() => handleRoleClick(role as ModelRole)}
                  title={getPersonaForRole(role).description}
                >
                  <span className="role-chip__icon">{getPersonaForRole(role).icon}</span> {label}
                </button>
              ))}
            </div>

            {/* Right: model, context, actions */}
            <div className="composer-toolbar__right">
              {/* Model selector */}
              <div className="composer-model">
                <label>Model</label>
                <ModelSelector
                  availableModels={availableModels}
                  modelMetadata={modelMetadata}
                  selectedModel={selectedModel}
                  onSelectModel={onSelectModel}
                  onRefresh={onRefreshModels}
                  providers={providers}
                />
              </div>

              {/* Context window */}
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

              {/* Icon actions */}
              <div className="icon-group">
                {/* Search */}
                <button
                  type="button"
                  className={`btn btn-secondary icon-btn ${isSearchEnabled ? 'active' : ''} ${
                    isCurrentChatSending && isSearchEnabled ? 'is-loading' : ''
                  }`}
                  onClick={onToggleSearch}
                  title={isCurrentChatSending && isSearchEnabled ? 'Searching web...' : 'Toggle Web Search (Alt+S)'}
                  aria-busy={isCurrentChatSending && isSearchEnabled}
                  disabled={isCurrentChatSending}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                </button>

                {/* Deep Research */}
                <button
                  type="button"
                  className={`btn btn-secondary icon-btn research-toggle ${isResearchEnabled ? 'active' : ''} ${
                    isCurrentChatSending && isResearchEnabled ? 'is-loading' : ''
                  }`}
                  onClick={() => setIsResearchEnabled((prev: boolean) => !prev)}
                  title={isCurrentChatSending && isResearchEnabled ? 'Researching…' : 'Enable Deep Research'}
                  aria-busy={isCurrentChatSending && isResearchEnabled}
                  disabled={isCurrentChatSending}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2"></path>
                    <path d="M8.5 2h7"></path>
                    <path d="M7 16h10"></path>
                  </svg>
                  {isResearchEnabled && <span className="research-label">Research</span>}
                </button>

                {/* Attach */}
                <button
                  type="button"
                  className="btn btn-secondary icon-btn"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                  </svg>
                </button>

                {/* A/B model comparison */}
                <button
                  type="button"
                  className="btn btn-secondary icon-btn"
                  onClick={() => setShowABTest(true)}
                  title="A/B Model Comparison"
                  disabled={isCurrentChatSending}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                    <path d="M16 3l3 3-3 3" /><path d="M8 21l-3-3 3-3" />
                  </svg>
                </button>

                {/* System prompt toggle */}
                <button
                  type="button"
                  className={`btn btn-secondary icon-btn ${showSystemPrompt ? 'active' : ''}`}
                  onClick={() => setShowSystemPrompt((prev) => !prev)}
                  title="System Prompt"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="4 17 10 11 4 5"></polyline>
                    <line x1="12" y1="19" x2="20" y2="19"></line>
                  </svg>
                </button>
              </div>

              <input
                type="file"
                ref={fileInputRef}
                onChange={onAttach}
                multiple
                hidden
                accept="image/*,.txt,.md,.js,.ts,.tsx,.jsx,.py,.html,.css,.json,.csv,.log,.sh,.rs,.go,.cpp,.c,.h,.hpp,.java,.php,.docx,.xlsx,.xlsm,.pdf"
              />

              {/* Clear + Send */}
              <button type="button" className="btn btn-secondary" onClick={onNewChat}>
                Clear
              </button>

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

          {/* Role suggestion banner */}
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

          {/* Status text (hidden, kept for aria) */}
          <div className="chat-status" aria-live="polite" style={{ display: 'none' }}>
            <span className="status-text">{statusText}</span>
            {isCurrentChatSending ? <span className="thinking-badge">Thinking… {thinkingSeconds}s</span> : null}
          </div>
        </div>
      </form>
    </footer>

    {showABTest && (
      <ABTestModal
        availableModels={availableModels}
        defaultModel={selectedModel}
        onClose={() => setShowABTest(false)}
      />
    )}
    </>
  );
}
