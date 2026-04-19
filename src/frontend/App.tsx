import React, { useState, useEffect, useRef, useMemo } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/github.css';
import DOMPurify from 'dompurify';

// Configure marked with custom renderer for code blocks
const renderer = new marked.Renderer();
renderer.code = ({ text, lang }) => {
  const language = hljs.getLanguage(lang || '') ? lang : 'plaintext';
  const highlighted = hljs.highlight(text, { language: language as string }).value;
  return `
    <div class="code-block">
      <div class="code-block__header">
        <span class="code-block__label">${language}</span>
        <button type="button" class="copy-code-btn" data-code="${encodeURIComponent(text)}">Copy</button>
      </div>
      <pre><code class="hljs language-${language}">${highlighted}</code></pre>
    </div>
  `;
};

marked.setOptions({
  renderer,
  gfm: true,
  breaks: true,
});

const STORAGE_KEY = "chatHistories";
const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

interface Chat {
  id: string;
  title: string;
  conversation: Message[];
  createdAt: number;
  updatedAt: number;
  model: string | null;
}

const App: React.FC = () => {
  const [conversation, setConversation] = useState<Message[]>([]);
  const [chatHistories, setChatHistories] = useState<Record<string, Chat>>({});
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [isSending, setIsSending] = useState(false);
  const [statusText, setStatusText] = useState('Ready');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('vanaila-theme');
    return saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches);
  });
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; content: string }[]>([]);
  const [prompt, setPrompt] = useState('');
  const [contextWindow, setContextWindow] = useState<{ current: number; total: number }>({ current: 0, total: 32768 });

  const chatLogRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Initialize
  useEffect(() => {
    // History Data Repair: ensure all items have an id matching their key
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const histories = JSON.parse(saved);
        let repaired = false;
        Object.keys(histories).forEach(key => {
          if (!histories[key].id) {
            histories[key].id = key;
            repaired = true;
          }
        });
        if (repaired) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(histories));
        }
        setChatHistories(histories);
      } catch (e) {
        console.error("Failed to load history", e);
      }
    }

    const savedTheme = localStorage.getItem("vanaila-theme");
    if (savedTheme) {
      document.documentElement.setAttribute("data-theme", savedTheme);
      setIsDarkMode(savedTheme === 'dark');
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      document.documentElement.setAttribute("data-theme", "dark");
      setIsDarkMode(true);
    }

    fetchModels();
  }, []);

  // Theme effect
  const toggleTheme = () => {
    const next = !isDarkMode;
    setIsDarkMode(next);
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
    localStorage.setItem("vanaila-theme", next ? "dark" : "light");
  };

  // Scroll to bottom
  useEffect(() => {
    if (chatLogRef.current) {
      chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
    }
  }, [conversation]);

  const fetchModels = async () => {
    setStatusText('Checking Ollama…');
    try {
      const res = await fetch('/api/models');
      const data = await res.json();
      if (data.models) {
        setAvailableModels(data.models);
        if (data.models.length > 0 && !selectedModel) {
          setSelectedModel(data.models[0]);
        }
      }
      setStatusText('Ready');
    } catch (err) {
      console.error(err);
      setStatusText('Ollama disconnected');
    }
  };

  // Fetch model details on change
  useEffect(() => {
    if (selectedModel) {
      fetch(`/api/model-details?model=${selectedModel}`)
        .then(res => res.json())
        .then(data => {
          if (data.contextWindow) {
            setContextWindow(prev => ({ ...prev, total: data.contextWindow }));
          }
        })
        .catch(console.error);
    }
  }, [selectedModel]);

  const handleNewChat = () => {
    setConversation([]);
    setCurrentChatId(null);
    setAttachedFiles([]);
    setPrompt('');
    setIsSidebarOpen(false);
  };

  const persistHistories = (newHistories: Record<string, Chat>) => {
    setChatHistories(newHistories);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistories));
  };

  const handleAttach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      if (file.size > 2 * 1024 * 1024) {
        setStatusText(`File ${file.name} is too large (max 2MB)`);
        continue;
      }
      try {
        const text = await file.text();
        setAttachedFiles(prev => [...prev, { name: file.name, content: text }]);
      } catch (err) {
        setStatusText(`Error reading ${file.name}`);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!prompt.trim() && attachedFiles.length === 0) || isSending) return;

    let finalPrompt = prompt;
    if (attachedFiles.length > 0) {
      const fileContext = attachedFiles.map(f => `[File: ${f.name}]\n\`\`\`\n${f.content}\n\`\`\``).join("\n\n");
      finalPrompt = `${fileContext}\n\n${prompt}`.trim();
      setAttachedFiles([]);
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: finalPrompt,
      timestamp: Date.now(),
    };

    const newConversation = [...conversation, userMessage];
    setConversation(newConversation);
    setPrompt('');
    setIsSending(true);
    setStatusText('Thinking…');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          messages: newConversation.map(m => ({ role: m.role, content: m.content })),
          stream: true,
        }),
      });

      if (!res.ok) throw new Error(await res.text());

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      };

      setConversation(prev => [...prev, assistantMessage]);

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader");

      let fullContent = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = new TextDecoder().decode(value);
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6);
            if (jsonStr === '[DONE]') break;
            try {
              const data = JSON.parse(jsonStr);
              const delta = data.message?.content || "";
              fullContent += delta;
              setConversation(prev => {
                const updated = [...prev];
                updated[updated.length - 1].content = fullContent;
                return updated;
              });
            } catch (e) { /* ignore partial json */ }
          }
        }
      }

      // Update history
      const chatId = currentChatId || `chat_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      const updatedChat: Chat = {
        id: chatId,
        title: conversation[0]?.content.slice(0, 30) || prompt.slice(0, 30) || "Untitled chat",
        conversation: [...newConversation, { ...assistantMessage, content: fullContent }],
        createdAt: chatHistories[chatId]?.createdAt || Date.now(),
        updatedAt: Date.now(),
        model: selectedModel,
      };

      const nextHistories = { ...chatHistories, [chatId]: updatedChat };
      persistHistories(nextHistories);
      setCurrentChatId(chatId);

    } catch (err: any) {
      console.error(err);
      setStatusText(`Error: ${err.message}`);
    } finally {
      setIsSending(false);
      setStatusText('Ready');
    }
  };

  const handleSelectChat = (id: string) => {
    console.log(`[HISTORY] Selecting chat: ${id}`);
    const chat = chatHistories[id];
    if (chat) {
      setConversation(chat.conversation);
      setCurrentChatId(id);
      setSelectedModel(chat.model || selectedModel);
      setIsSidebarOpen(false);
    } else {
      console.warn(`[HISTORY] Chat ${id} not found in history`);
    }
  };

  const handleDeleteChat = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    console.log(`[HISTORY] Deleting chat: ${id}`);
    const nextHistories = { ...chatHistories };
    if (nextHistories[id]) {
      delete nextHistories[id];
      persistHistories(nextHistories);
      if (currentChatId === id) {
        handleNewChat();
      }
    } else {
      console.warn(`[HISTORY] Chat ${id} not found in history`);
    }
  };

  const handleCopyCode = async (text: string, e: React.MouseEvent<HTMLButtonElement>) => {
    try {
      await navigator.clipboard.writeText(text);
      const target = e.currentTarget;
      target.textContent = "Copied";
      target.classList.add("is-copied");
      setTimeout(() => {
        target.textContent = "Copy";
        target.classList.remove("is-copied");
      }, 1500);
    } catch (err) {
      console.error("Failed to copy", err);
    }
  };

  const handleChatLogClick = async (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const copyBtn = target.closest('.copy-code-btn');
    if (copyBtn) {
      const text = decodeURIComponent(copyBtn.getAttribute('data-code') || '');
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = 'Copied';
        copyBtn.classList.add('is-copied');
        setTimeout(() => {
          copyBtn.textContent = 'Copy';
          copyBtn.classList.remove('is-copied');
        }, 1500);
      } catch (err) {
        console.error('Failed to copy code', err);
      }
    }
  };

  const renderMarkdown = (content: string) => {
    const html = DOMPurify.sanitize(marked.parse(content) as string);
    return { __html: html };
  };

  const contextPercentage = Math.min(100, (contextWindow.current / contextWindow.total) * 100);

  return (
    <div className="app-shell">
      <button
        className={`sidebar-backdrop ${isSidebarOpen ? 'is-visible' : ''}`}
        type="button"
        aria-label="Close Chat Sidebar"
        onClick={() => setIsSidebarOpen(false)}
      ></button>

      <aside id="sidebar" className={`sidebar ${isSidebarOpen ? 'is-open' : ''}`} aria-label="Chat History">
        <div className="sidebar-content">
          <div className="sidebar-panel">
            <div className="sidebar-brand">
              <p className="sidebar-eyebrow">Local Ollama Workspace</p>
              <h1 className="sidebar-product">VanailaChat</h1>
              <p className="sidebar-copy">Browse recent chats, jump back into context, and start a fresh thread fast.</p>
            </div>

            <div className="sidebar-actions">
              <button
                className="btn btn-primary btn-block"
                type="button"
                aria-label="Start New Chat"
                onClick={handleNewChat}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                New Chat
              </button>
            </div>
          </div>

          <div className="sidebar-section">
            <div className="section-heading">
              <div>
                <p className="section-eyebrow">Library</p>
                <h2 className="section-title">Recent Conversations</h2>
              </div>
              <span className="section-meta">{Object.keys(chatHistories).length} chats</span>
            </div>
            <div className="history-list">
              {Object.entries(chatHistories)
                .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
                .map(([id, chat]) => (
                <div
                  key={id}
                  className={`history-item ${currentChatId === id ? 'active' : ''}`}
                  onClick={() => handleSelectChat(id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && handleSelectChat(id)}
                >
                  <div className="history-item__content">
                    <span className="history-item__title">{chat.title || "Untitled chat"}</span>
                    <span className="history-item__meta">{DATE_FORMATTER.format(chat.updatedAt)}</span>
                  </div>
                  <button
                    className="history-item__delete"
                    type="button"
                    aria-label="Delete chat"
                    onClick={(e) => handleDeleteChat(e, id)}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="app-header">
          <div className="header-main">
            <button 
              id="sidebarToggleBtn"
              className="icon-btn sidebar-toggle" 
              onClick={() => setIsSidebarOpen(true)}
              aria-label="Open sidebar"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
            </button>
            <div className="header-title">
              <div className="title-stack">
                <p className="header-eyebrow">Local AI Assistant</p>
                <h2>VanailaChat</h2>
              </div>
            </div>

            <div className="header-summary">
              <div className="summary-pill">
                <span className="summary-label">Model</span>
                <span className="summary-value">{selectedModel || 'Loading…'}</span>
              </div>
              <div className="summary-pill">
                <span className="summary-label">Ollama</span>
                <span className="summary-value">{statusText === 'Ready' ? 'Connected' : statusText}</span>
              </div>
              <button 
                className="icon-btn theme-toggle" 
                type="button" 
                aria-label="Toggle Dark Mode"
                onClick={toggleTheme}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                </svg>
              </button>
            </div>
          </div>
        </header>

        <section className="chat-container">
          <div ref={chatLogRef} className="chat-log" onClick={handleChatLogClick} aria-live="polite" aria-label="Conversation">
            {conversation.length === 0 ? (
              <div className="chat-empty">
                <strong>No messages yet</strong>
                <p>Start a new conversation with the local model.</p>
              </div>
            ) : (
              conversation.map((msg, index) => (
                <div key={msg.id} className={`message ${msg.role}`}>
                  <div className="message__meta">
                    <span className="message__role">{msg.role}</span>
                    <span className="message__time">{DATE_FORMATTER.format(msg.timestamp)}</span>
                  </div>
                  <div className="message__body">
                    <div className="message__prose" dangerouslySetInnerHTML={renderMarkdown(msg.content)} />
                  </div>
                </div>
              ))
            )}
            {isSending && (
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

        <footer className="app-footer">
          <form className="chat-form" onSubmit={handleSend}>
            <div className="composer">
              <label className="composer-label">Message</label>
              
              {attachedFiles.length > 0 && (
                <div className="attachment-tray">
                  {attachedFiles.map((file, i) => (
                    <div key={i} className="attachment-pill">
                      <span>{file.name}</span>
                      <button type="button" className="attachment-remove" onClick={() => removeAttachment(i)}>&times;</button>
                    </div>
                  ))}
                </div>
              )}

              <textarea
                className="textarea"
                placeholder="Ask for code, debugging help, or a quick explanation…"
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
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
                      onChange={(e) => setSelectedModel(e.target.value)}
                    >
                      {availableModels.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>

                  <div className="composer-context">
                    <label>Context</label>
                    <div className="context-status">
                      <span className="context-status__text">{contextWindow.current} / {contextWindow.total}</span>
                      <span className="context-status__meter">
                        <span className="context-status__meter-fill" style={{ width: `${contextPercentage}%` }}></span>
                      </span>
                    </div>
                  </div>

                  <button type="button" className="btn btn-secondary" onClick={handleNewChat}>
                    Clear
                  </button>

                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleAttach} 
                    multiple 
                    hidden 
                    accept=".txt,.md,.js,.py,.html,.css,.json,.csv,.log,.sh,.ts,.tsx,.jsx,.rs,.go,.cpp,.c,.h,.hpp,.java,.php"
                  />
                  <button type="button" className="btn btn-secondary icon-btn" onClick={() => fileInputRef.current?.click()}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                    </svg>
                  </button>

                  <button type="submit" className="btn btn-primary" disabled={isSending}>
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
      </main>
    </div>
  );
};

export default App;
