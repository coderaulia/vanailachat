import { useEffect, useRef } from 'react';
import type { MouseEvent } from 'react';
import './ChatLog.css';
import { DATE_FORMATTER } from '../lib/date';
import type { Message } from '../types/chat';

import { useChat } from '../context/ChatContext';

interface ChatLogProps {
  showTokens: boolean;
  renderMarkdown: (content: string) => string;
}

export function ChatLog({ showTokens, renderMarkdown }: ChatLogProps) {
  const { conversation, isCurrentChatSending } = useChat();
  const chatLogRef = useRef<HTMLDivElement>(null);

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
    if (!copyButton) {
      return;
    }

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
                <span className="message__time">{DATE_FORMATTER.format(message.timestamp)}</span>
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
