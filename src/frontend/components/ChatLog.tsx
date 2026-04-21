import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import './ChatLog.css';
import { DATE_FORMATTER } from '../lib/date';

import { useChat } from '../context/ChatContext';

interface ChatLogProps {
  showTokens: boolean;
  renderMarkdown: (content: string) => string;
}

export function ChatLog({ showTokens, renderMarkdown }: ChatLogProps) {
  const { conversation, isCurrentChatSending } = useChat();
  const chatLogRef = useRef<HTMLDivElement>(null);
  const [copiedIds, setCopiedIds] = useState<Set<string>>(new Set());

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
            <div
              key={message.id}
              className={`message ${message.role} ${
                isCurrentChatSending &&
                message.role === 'assistant' &&
                index === conversation.length - 1
                  ? 'is-typing'
                  : ''
              }`}
            >
              <div className="message__meta">
                <span className="message__role">{message.role}</span>
                <div className="message__meta-right">
                  <span className="message__time">{DATE_FORMATTER.format(message.timestamp)}</span>
                  {message.role === 'assistant' && (
                    <button
                      type="button"
                      className={`message__copy-btn ${copiedIds.has(message.id) ? 'is-copied' : ''}`}
                      title="Copy response as Markdown"
                      onClick={() => handleCopyMessage(message.id, message.content)}
                    >
                      {copiedIds.has(message.id) ? (
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
                <div className="message__prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} />
                {showTokens && message.role === 'assistant' ? (
                  <div className="message__tokens">
                    ↑ {message.promptTokens ?? 0} ↓ {message.completionTokens ?? 0} tokens
                  </div>
                ) : null}
              </div>
            </div>
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
