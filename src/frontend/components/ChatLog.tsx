import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import './ChatLog.css';
import { DATE_FORMATTER } from '../lib/date';
import type { Message } from '../types/chat';
import { useChat } from '../context/ChatContext';

interface MessageItemProps {
  message: Message;
  isTyping: boolean;
  showTokens: boolean;
  isCopied: boolean;
  rating: number;
  pendingFeedback: boolean;
  renderMarkdown: (content: string) => string;
  onCopy: (id: string, content: string) => void;
  onRate: (id: string, rating: number) => void;
  onRegenerate: (id: string) => void;
  onEdit: (id: string, content: string) => void;
  isBusy: boolean;
}

const MessageItem = memo(function MessageItem({ message, isTyping, showTokens, isCopied, rating, pendingFeedback, renderMarkdown, onCopy, onRate, onRegenerate, onEdit, isBusy }: MessageItemProps) {
  const html = useMemo(() => renderMarkdown(message.content), [renderMarkdown, message.content]);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  const beginEdit = () => {
    setDraft(message.content);
    setIsEditing(true);
  };

  const submitEdit = () => {
    setIsEditing(false);
    if (draft.trim() && draft !== message.content) onEdit(message.id, draft);
  };

  return (
    <div
      className={`message ${message.role} ${isTyping ? 'is-typing' : ''}`}
    >
      <div className="message__meta">
        <span className="message__role">{message.role}</span>
        <div className="message__meta-right">
          <span className="message__time">{DATE_FORMATTER.format(message.timestamp)}</span>
          {message.role === 'assistant' && !isTyping && message.content.length > 0 && (
            <>
              <button
                type="button"
                className={`message__rate-btn ${rating === 1 ? 'is-active is-positive' : ''}`}
                title={rating === 1 ? 'Remove thumbs up' : 'Helpful — train the model on this answer'}
                aria-pressed={rating === 1}
                disabled={pendingFeedback}
                onClick={() => onRate(message.id, rating === 1 ? 0 : 1)}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill={rating === 1 ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                  <path d="M7 10v12" />
                  <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L15 1l1 4-1 0.88Z" />
                </svg>
              </button>
              <button
                type="button"
                className={`message__rate-btn ${rating === -1 ? 'is-active is-negative' : ''}`}
                title={rating === -1 ? 'Remove thumbs down' : 'Not helpful — penalize this answer'}
                aria-pressed={rating === -1}
                disabled={pendingFeedback}
                onClick={() => onRate(message.id, rating === -1 ? 0 : -1)}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill={rating === -1 ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" style={{ transform: 'scaleY(-1)' }}>
                  <path d="M7 10v12" />
                  <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L15 1l1 4-1 0.88Z" />
                </svg>
              </button>
            </>
          )}
          {message.role === 'assistant' && !isTyping && message.content.length > 0 && (
            <button
              type="button"
              className="message__action-btn"
              title="Regenerate this answer"
              disabled={isBusy}
              onClick={() => onRegenerate(message.id)}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                <path d="M3 21v-5h5" />
              </svg>
              Retry
            </button>
          )}
          {message.role === 'user' && !isEditing && (
            <button
              type="button"
              className="message__action-btn"
              title="Edit this message and ask again"
              disabled={isBusy}
              onClick={beginEdit}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
              Edit
            </button>
          )}
          {message.role === 'assistant' && (
            <button
              type="button"
              className={`message__copy-btn ${isCopied ? 'is-copied' : ''}`}
              title="Copy response as Markdown"
              onClick={() => onCopy(message.id, message.content)}
            >
              {isCopied ? (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Copied
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  Copy
                </>
              )}
            </button>
          )}
        </div>
      </div>
      <div className="message__body">
        {isEditing ? (
          <div className="message__edit">
            <textarea
              className="message__edit-input"
              value={draft}
              autoFocus
              rows={Math.min(12, draft.split('\n').length + 1)}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  submitEdit();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setIsEditing(false);
                }
              }}
            />
            <div className="message__edit-actions">
              <button type="button" className="message__action-btn" onClick={() => setIsEditing(false)}>Cancel</button>
              <button type="button" className="message__action-btn is-primary" onClick={submitEdit}>Send again</button>
            </div>
          </div>
        ) : (
          <div className="message__prose" dangerouslySetInnerHTML={{ __html: html }} />
        )}
        {showTokens && message.role === 'assistant' ? (
          <div className="message__tokens">
            ↑ {message.promptTokens ?? 0} ↓ {message.completionTokens ?? 0} tokens
          </div>
        ) : null}
      </div>
    </div>
  );
});

interface ChatLogProps {
  showTokens: boolean;
  renderMarkdown: (content: string) => string;
}

export function ChatLog({ showTokens, renderMarkdown }: ChatLogProps) {
  const { conversation, isCurrentChatSending, handleRegenerate, handleEditAndResend } = useChat();
  const chatLogRef = useRef<HTMLDivElement>(null);
  const [copiedIds, setCopiedIds] = useState<Set<string>>(new Set());
  const [feedbackRatings, setFeedbackRatings] = useState<Record<string, number>>({});
  const [pendingFeedback, setPendingFeedback] = useState<Set<string>>(new Set());

  // Hydrate existing feedback for visible assistant messages on conversation change.
  useEffect(() => {
    let cancelled = false;
    const assistantIds = conversation
      .filter(m => m.role === 'assistant' && m.content.length > 0)
      .map(m => m.id)
      .filter(id => feedbackRatings[id] === undefined);

    if (assistantIds.length === 0) return;

    void (async () => {
      const updates: Record<string, number> = {};
      await Promise.all(assistantIds.map(async (id) => {
        try {
          const response = await fetch(`/api/messages/${id}/feedback`);
          if (!response.ok) return;
          const data = await response.json() as { feedback: { rating: number } | null };
          if (data.feedback) updates[id] = data.feedback.rating;
        } catch {
          // ignore network errors
        }
      }));
      if (!cancelled && Object.keys(updates).length > 0) {
        setFeedbackRatings(prev => ({ ...prev, ...updates }));
      }
    })();

    return () => { cancelled = true; };
    // feedbackRatings deliberately excluded — only refetch when conversation changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation]);

  const handleRate = useCallback(async (id: string, rating: number) => {
    setPendingFeedback(prev => new Set(prev).add(id));
    // Optimistic update
    setFeedbackRatings(prev => ({ ...prev, [id]: rating }));

    try {
      const response = await fetch(`/api/messages/${id}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      console.error('Failed to save feedback', error);
      // Roll back — refetch on next conversation change
      setFeedbackRatings(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } finally {
      setPendingFeedback(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    if (chatLogRef.current) {
      chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
    }
  }, [conversation]);

  const lastMessage = conversation[conversation.length - 1];
  const showLegacyLoading =
    isCurrentChatSending && !(lastMessage?.role === 'assistant' && lastMessage.content.length > 0);

  const handleChatLogClick = async (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    const copyButton = target.closest('.copy-code-btn') as HTMLButtonElement | null;
    if (!copyButton) return;

    const text = decodeURIComponent(copyButton.getAttribute('data-code') || '');

    try {
      await navigator.clipboard.writeText(text);
      copyButton.textContent = 'Copied';
      copyButton.classList.add('is-copied');

      setTimeout(() => {
        copyButton.textContent = 'Copy';
        copyButton.classList.remove('is-copied');
      }, 1500);
    } catch (error) {
      console.error('Failed to copy code', error);
    }
  };

  const handleCopyMessage = useCallback(async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedIds((prev) => new Set(prev).add(id));
      setTimeout(() => {
        setCopiedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 1800);
    } catch (error) {
      console.error('Failed to copy message', error);
    }
  }, []);

  return (
    <section className="chat-container">
      <div
        ref={chatLogRef}
        className="chat-log"
        onClick={handleChatLogClick}
        aria-live="polite"
        aria-label="Conversation"
      >
        {conversation.length === 0 ? (
          <div className="chat-empty">
            <strong>No messages yet</strong>
            <p>Start a new conversation with the local model.</p>
          </div>
        ) : (
          conversation.map((message, index) => (
            <MessageItem
              key={message.id}
              message={message}
              isTyping={
                isCurrentChatSending &&
                message.role === 'assistant' &&
                index === conversation.length - 1
              }
              showTokens={showTokens}
              isCopied={copiedIds.has(message.id)}
              rating={feedbackRatings[message.id] ?? 0}
              pendingFeedback={pendingFeedback.has(message.id)}
              renderMarkdown={renderMarkdown}
              onCopy={handleCopyMessage}
              onRate={handleRate}
              onRegenerate={handleRegenerate}
              onEdit={handleEditAndResend}
              isBusy={isCurrentChatSending}
            />
          ))
        )}

        {showLegacyLoading && (
          <div className="message assistant is-loading">
            <div className="message__meta">
              <span className="message__role">assistant</span>
            </div>
            <div className="message__body">
              <div className="message__loading">
                <div className="message__loading-dots">
                  <div className="message__loading-dot"></div>
                  <div className="message__loading-dot"></div>
                  <div className="message__loading-dot"></div>
                </div>
                <div className="message__loading-lines">
                  <div className="message__loading-line"></div>
                  <div className="message__loading-line"></div>
                  <div className="message__loading-line"></div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
