import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import {
  loadChatHistories,
  saveChatHistories,
} from '../lib/chatStorage';
import type { Attachment, Chat, ContextWindow, Message } from '../types/chat';

const DEFAULT_CONTEXT_WINDOW: ContextWindow = { current: 0, total: 32768 };
const THEME_STORAGE_KEY = 'vanaila-theme';

type SendMessagePart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

function getInitialTheme(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (savedTheme) {
    return savedTheme === 'dark';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function parseUsage(data: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number }): number {
  if (typeof data.total_tokens === 'number') {
    return data.total_tokens;
  }

  const promptTokens = data.prompt_tokens ?? 0;
  const completionTokens = data.completion_tokens ?? 0;
  return promptTokens + completionTokens;
}

export function useChatApp() {
  const [conversation, setConversation] = useState<Message[]>([]);
  const [chatHistories, setChatHistories] = useState<Record<string, Chat>>({});
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [sendingChatIds, setSendingChatIds] = useState<Record<string, boolean>>({});
  const [statusText, setStatusText] = useState('Ready');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(getInitialTheme);
  const [attachedFiles, setAttachedFiles] = useState<Attachment[]>([]);
  const [prompt, setPrompt] = useState('');
  const [isSearchEnabled, setIsSearchEnabled] = useState(false);
  const [contextWindow, setContextWindow] = useState<ContextWindow>(DEFAULT_CONTEXT_WINDOW);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentChatIdRef = useRef<string | null>(null);

  useEffect(() => {
    currentChatIdRef.current = currentChatId;
  }, [currentChatId]);

  const updateHistories = (
    updater: (prev: Record<string, Chat>) => Record<string, Chat>,
    persist = false
  ) => {
    setChatHistories((prev) => {
      const next = updater(prev);
      if (persist) {
        saveChatHistories(localStorage, next);
      }
      return next;
    });
  };

  const persistHistories = (nextHistories: Record<string, Chat>) => {
    updateHistories(() => nextHistories, true);
  };

  const fetchModels = async () => {
    setStatusText('Checking Ollama…');
    try {
      const response = await fetch('/api/models');
      const data = (await response.json()) as { models?: string[] };

      const models = Array.isArray(data.models) ? data.models : [];
      setAvailableModels(models);
      if (models.length > 0) {
        setSelectedModel((current) => current || models[0]);
        setStatusText('Ready');
      } else {
        setStatusText('No models installed');
      }
    } catch (error) {
      console.error(error);
      setStatusText('Ollama disconnected');
    }
  };

  useEffect(() => {
    const histories = loadChatHistories(localStorage);
    setChatHistories(histories);

    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === 'dark' || savedTheme === 'light') {
      document.documentElement.setAttribute('data-theme', savedTheme);
      setIsDarkMode(savedTheme === 'dark');
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.setAttribute('data-theme', 'dark');
      setIsDarkMode(true);
    }

    fetchModels();
  }, []);

  useEffect(() => {
    if (!selectedModel) {
      return;
    }

    fetch(`/api/model-details?model=${encodeURIComponent(selectedModel)}`)
      .then((response) => response.json() as Promise<{ contextWindow?: number | null }>)
      .then((data) => {
        if (typeof data.contextWindow === 'number') {
          setContextWindow((previous) => ({ ...previous, total: data.contextWindow! }));
        }
      })
      .catch((error) => {
        console.error(error);
      });
  }, [selectedModel]);

  useEffect(() => {
    if (statusText !== 'Thinking…' && statusText !== 'Background response running…' && statusText !== 'Ready') {
      return;
    }

    const nextStatus =
      currentChatId && sendingChatIds[currentChatId]
        ? 'Thinking…'
        : Object.keys(sendingChatIds).length > 0
          ? 'Background response running…'
          : 'Ready';

    if (nextStatus !== statusText) {
      setStatusText(nextStatus);
    }
  }, [currentChatId, sendingChatIds, statusText]);

  const toggleTheme = () => {
    const nextThemeIsDark = !isDarkMode;
    setIsDarkMode(nextThemeIsDark);
    const theme = nextThemeIsDark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  };

  const openSidebar = () => setIsSidebarOpen(true);
  const closeSidebar = () => setIsSidebarOpen(false);

  const handleNewChat = () => {
    setConversation([]);
    setCurrentChatId(null);
    currentChatIdRef.current = null;
    setAttachedFiles([]);
    setPrompt('');
    closeSidebar();
    setContextWindow((previous) => ({ ...previous, current: 0 }));
    setStatusText(Object.keys(sendingChatIds).length > 0 ? 'Background response running…' : 'Ready');
  };

  const handleSelectChat = (id: string) => {
    const chat = chatHistories[id];
    if (!chat) {
      console.warn(`[HISTORY] Chat ${id} not found in history`);
      return;
    }

    setConversation(chat.conversation);
    setCurrentChatId(id);
    currentChatIdRef.current = id;
    setSelectedModel(chat.model || selectedModel);
    setContextWindow((previous) => ({ ...previous, current: chat.usage || 0 }));
    closeSidebar();
  };

  const handleDeleteChat = (id: string) => {
    const nextHistories = { ...chatHistories };
    if (!nextHistories[id]) {
      console.warn(`[HISTORY] Chat ${id} not found in history`);
      return;
    }

    delete nextHistories[id];
    persistHistories(nextHistories);

    if (currentChatId === id) {
      handleNewChat();
    }
  };

  const removeAttachment = (index: number) => {
    setAttachedFiles((previous) => previous.filter((_, fileIndex) => fileIndex !== index));
  };

  const handleAttach = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) {
      return;
    }

    for (const file of Array.from(files)) {
      if (file.size > 10 * 1024 * 1024) {
        setStatusText(`File ${file.name} is too large (max 10MB)`);
        continue;
      }

      try {
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (readerEvent) => {
            const base64 = readerEvent.target?.result;
            if (typeof base64 === 'string') {
              setAttachedFiles((previous) => [
                ...previous,
                { name: file.name, content: base64, type: 'image' },
              ]);
            }
          };
          reader.readAsDataURL(file);
        } else {
          const text = await file.text();
          setAttachedFiles((previous) => [
            ...previous,
            { name: file.name, content: text, type: 'text' },
          ]);
        }
      } catch {
        setStatusText(`Error reading ${file.name}`);
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSend = async (event?: FormEvent) => {
    if (event) {
      event.preventDefault();
    }

    const activeChatId = currentChatId;
    const isCurrentChatSending = activeChatId ? sendingChatIds[activeChatId] : false;
    if ((!prompt.trim() && attachedFiles.length === 0) || isCurrentChatSending) {
      return;
    }

    const textMessagePart: Extract<SendMessagePart, { type: 'text' }> = {
      type: 'text',
      text: prompt,
    };
    const messageContent: SendMessagePart[] = [textMessagePart];
    attachedFiles
      .filter((file) => file.type === 'image')
      .forEach((file) => {
        messageContent.push({ type: 'image_url', image_url: { url: file.content } });
      });

    const fileContext = attachedFiles
      .filter((file) => file.type === 'text')
      .map((file) => `[File: ${file.name}]\n\`\`\`\n${file.content}\n\`\`\``)
      .join('\n\n');

    const finalPrompt = fileContext ? `${fileContext}\n\n${prompt}` : prompt;
    if (fileContext) {
      textMessagePart.text = finalPrompt;
    }

    const startedAt = Date.now();
    const chatId = activeChatId || `chat_${startedAt}_${Math.random().toString(36).slice(2, 11)}`;

    const userMessage: Message = {
      id: `${startedAt}_user_${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      content: finalPrompt,
      timestamp: startedAt,
    };

    const assistantMessage: Message = {
      id: `${startedAt}_assistant_${Math.random().toString(36).slice(2, 8)}`,
      role: 'assistant',
      content: '',
      timestamp: startedAt + 1,
    };

    const optimisticConversation = [...conversation, userMessage, assistantMessage];
    setConversation(optimisticConversation);
    setPrompt('');
    setAttachedFiles([]);

    if (!activeChatId) {
      setCurrentChatId(chatId);
      currentChatIdRef.current = chatId;
    }

    setSendingChatIds((previous) => ({ ...previous, [chatId]: true }));
    setStatusText('Thinking…');

    updateHistories((previous) => {
      const existingChat = previous[chatId];
      const title =
        existingChat?.title && existingChat.title.trim() && existingChat.title !== 'Untitled chat'
          ? existingChat.title
          : finalPrompt.slice(0, 30) || 'Untitled chat';

      return {
        ...previous,
        [chatId]: {
          id: chatId,
          title,
          conversation: optimisticConversation,
          createdAt: existingChat?.createdAt || startedAt,
          updatedAt: startedAt,
          model: selectedModel,
          usage: existingChat?.usage || 0,
        },
      };
    }, true);

    let requestFailed = false;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            ...conversation.map((message) => ({ role: message.role, content: message.content })),
            { role: 'user', content: messageContent },
          ],
          stream: true,
          search: isSearchEnabled,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No reader');
      }

      let fullContent = '';
      let finalUsage = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const chunk = new TextDecoder().decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) {
            continue;
          }

          const jsonString = line.slice(6);
          if (jsonString === '[DONE]') {
            continue;
          }

          try {
            const data = JSON.parse(jsonString) as {
              message?: { content?: string };
              usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
            };

            fullContent += data.message?.content || '';

            if (data.usage) {
              finalUsage = parseUsage(data.usage);
              if (currentChatIdRef.current === chatId) {
                setContextWindow((previous) => ({ ...previous, current: finalUsage }));
              }
            }

            updateHistories((previous) => {
              const chat = previous[chatId];
              if (!chat || chat.conversation.length === 0) {
                return previous;
              }

              const updatedConversation = [...chat.conversation];
              const lastIndex = updatedConversation.length - 1;
              if (updatedConversation[lastIndex]?.role === 'assistant') {
                updatedConversation[lastIndex] = {
                  ...updatedConversation[lastIndex],
                  content: fullContent,
                };
              }

              return {
                ...previous,
                [chatId]: {
                  ...chat,
                  conversation: updatedConversation,
                  updatedAt: Date.now(),
                  usage: finalUsage || chat.usage,
                },
              };
            });

            if (currentChatIdRef.current === chatId) {
              setConversation((previous) => {
                if (previous.length === 0) {
                  return previous;
                }

                const updated = [...previous];
                const lastIndex = updated.length - 1;
                if (updated[lastIndex]?.role === 'assistant') {
                  updated[lastIndex] = { ...updated[lastIndex], content: fullContent };
                }
                return updated;
              });
            }
          } catch {
            // Ignore partial JSON chunks.
          }
        }
      }

      updateHistories((previous) => {
        const chat = previous[chatId];
        if (!chat) {
          return previous;
        }

        return {
          ...previous,
          [chatId]: {
            ...chat,
            updatedAt: Date.now(),
            usage: finalUsage || chat.usage,
          },
        };
      }, true);
    } catch (error) {
      requestFailed = true;
      const message = error instanceof Error ? error.message : 'Unknown error';
      const errorText = `Error: ${message}`;

      if (currentChatIdRef.current === chatId) {
        setStatusText(errorText);
      }

      updateHistories((previous) => {
        const chat = previous[chatId];
        if (!chat || chat.conversation.length === 0) {
          return previous;
        }

        const updatedConversation = [...chat.conversation];
        const lastIndex = updatedConversation.length - 1;
        if (updatedConversation[lastIndex]?.role === 'assistant' && !updatedConversation[lastIndex].content) {
          updatedConversation[lastIndex] = {
            ...updatedConversation[lastIndex],
            content: errorText,
          };
        }

        return {
          ...previous,
          [chatId]: {
            ...chat,
            conversation: updatedConversation,
            updatedAt: Date.now(),
          },
        };
      }, true);

      if (currentChatIdRef.current === chatId) {
        setConversation((previous) => {
          if (previous.length === 0) {
            return previous;
          }

          const updated = [...previous];
          const lastIndex = updated.length - 1;
          if (updated[lastIndex]?.role === 'assistant' && !updated[lastIndex].content) {
            updated[lastIndex] = { ...updated[lastIndex], content: errorText };
          }

          return updated;
        });
      }
    } finally {
      setSendingChatIds((previous) => {
        if (!previous[chatId]) {
          return previous;
        }

        const next = { ...previous };
        delete next[chatId];
        return next;
      });

      if (currentChatIdRef.current === chatId && !requestFailed) {
        setStatusText('Ready');
      }
    }
  };

  const contextPercentage = useMemo(
    () => Math.min(100, (contextWindow.current / contextWindow.total) * 100),
    [contextWindow]
  );

  const isCurrentChatSending = useMemo(
    () => (currentChatId ? Boolean(sendingChatIds[currentChatId]) : false),
    [currentChatId, sendingChatIds]
  );

  const sortedHistories = useMemo(
    () => Object.entries(chatHistories).sort(([, a], [, b]) => b.updatedAt - a.updatedAt),
    [chatHistories]
  );

  return {
    attachedFiles,
    availableModels,
    closeSidebar,
    contextPercentage,
    contextWindow,
    conversation,
    currentChatId,
    fileInputRef,
    handleAttach,
    handleDeleteChat,
    handleNewChat,
    handleSelectChat,
    handleSend,
    isCurrentChatSending,
    isDarkMode,
    isSearchEnabled,
    isSidebarOpen,
    openSidebar,
    prompt,
    removeAttachment,
    selectedModel,
    sendingChatIds,
    setIsSearchEnabled,
    setPrompt,
    setSelectedModel,
    sortedHistories,
    statusText,
    toggleTheme,
  };
}
