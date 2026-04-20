import type { ChangeEvent, FormEvent, RefObject } from 'react';
import type { Attachment, ContextWindow } from '../types/chat';

interface ComposerProps {
  attachedFiles: Attachment[];
  availableModels: string[];
  contextPercentage: number;
  contextWindow: ContextWindow;
  fileInputRef: RefObject<HTMLInputElement | null>;
  isCurrentChatSending: boolean;
  isSearchEnabled: boolean;
  prompt: string;
  selectedModel: string;
  statusText: string;
  onAttach: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  onNewChat: () => void;
  onRemoveAttachment: (index: number) => void;
  onSelectModel: (model: string) => void;
  onSend: (event?: FormEvent) => Promise<void>;
  onSetPrompt: (value: string) => void;
  onToggleSearch: () => void;
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
  selectedModel,
  statusText,
  onAttach,
  onNewChat,
  onRemoveAttachment,
  onSelectModel,
  onSend,
  onSetPrompt,
  onToggleSearch,
}: ComposerProps) {
  return (
    <footer className="app-footer">
      <form className="chat-form" onSubmit={onSend}>
        <div className="composer">
          <label className="composer-label">Message</label>

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
            <div className="chat-status" aria-live="polite">
              <span className="status-text">{statusText}</span>
            </div>

            <div className="input-actions">
              <div className="composer-model">
                <label>Model</label>
                <select
                  className="select composer-select"
                  value={selectedModel}
                  onChange={(event) => onSelectModel(event.target.value)}
                >
                  {availableModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </div>

              <div className="composer-context">
                <label>Context</label>
                <div className="context-status">
                  <span className="context-status__text">
                    {contextWindow.current} / {contextWindow.total}
                  </span>
                  <span className="context-status__meter">
                    <span className="context-status__meter-fill" style={{ width: `${contextPercentage}%` }}></span>
                  </span>
                </div>
              </div>

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

              <button type="submit" className="btn btn-primary" disabled={isCurrentChatSending}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
                Send
              </button>
            </div>
          </div>
        </div>
      </form>
    </footer>
  );
}
