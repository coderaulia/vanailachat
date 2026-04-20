import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import type { Attachment, Chat, ContextWindow, Message, MessageRole } from '../types/chat';

const DEFAULT_CONTEXT_WINDOW: ContextWindow = { current: 0, total: 32768 };
const MAX_CONVERSATION_HISTORY = 20;
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.';
const THEME_STORAGE_KEY = 'vanaila-theme';
const MODEL_STORAGE_KEY = 'vanaila-model';

type SendMessagePart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

interface ApiChat {
  id: string;
  projectId: string;
  title: string;
  model: string | null;
  systemPrompt?: string;
  pinned?: boolean;
  role?: string | null;
  createdAt: number;
  updatedAt: number;
  usage?: number;
}

interface ApiMessage {
  id: string;
  chatId: string;
  role: string;
  content: string;
  promptTokens?: number | null;
  completionTokens?: number | null;
  createdAt: number;
}

interface ApiProject {
  id: string;
  name: string;
  createdAt: number;
}

interface StreamEvent {
  message?: { content?: string };
  usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

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

function toMessageRole(role: string): MessageRole {
  if (role === 'user' || role === 'assistant' || role === 'system') {
    return role;
  }
  return 'assistant';
}

function parseStreamLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const payload = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
  if (!payload || payload === '[DONE]') {
    return null;
  }

  try {
    return JSON.parse(payload) as StreamEvent;
  } catch {
    return null;
  }
}

export function useChatApp() {
  const [conversation, setConversation] = useState<Message[]>([]);
  const [chatHistories, setChatHistories] = useState<Record<string, Chat>>({});
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModelState] = useState('');
  const [sendingChatIds, setSendingChatIds] = useState<Record<string, boolean>>({});
  const [statusText, setStatusText] = useState('Ready');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(getInitialTheme);
  const [attachedFiles, setAttachedFiles] = useState<Attachment[]>([]);
  const [prompt, setPrompt] = useState('');
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [isSearchEnabled, setIsSearchEnabled] = useState(false);
  const [contextWindow, setContextWindow] = useState<ContextWindow>(DEFAULT_CONTEXT_WINDOW);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentChatIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);

  useEffect(() => {
    currentChatIdRef.current = currentChatId;
  }, [currentChatId]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const updateHistories = (updater: (prev: Record<string, Chat>) => Record<string, Chat>) => {
    setChatHistories((prev) => updater(prev));
  };

  const upsertChat = async (chat: {
    id: string;
    projectId: string;
    title: string;
    model: string | null;
    systemPrompt: string | null;
    pinned?: boolean;
    createdAt: number;
    updatedAt: number;
  }) => {
    const response = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chat),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }
  };

  const patchChat = async (
    id: string,
    updates: { title?: string; pinned?: boolean; systemPrompt?: string | null; updatedAt?: number }
  ): Promise<ApiChat> => {
    const response = await fetch(`/api/chats/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const data = (await response.json()) as { chat?: ApiChat };
    if (!data.chat) {
      throw new Error('Missing chat in response');
    }

    return data.chat;
  };

  const saveMessage = async (
    chatId: string,
    message: Message,
    options?: { promptTokens?: number; completionTokens?: number }
  ) => {
    const response = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: message.id,
        chatId,
        role: message.role,
        content: message.content,
        promptTokens: options?.promptTokens,
        completionTokens: options?.completionTokens,
        createdAt: message.timestamp,
      }),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }
  };

  const loadMessages = async (chatId: string): Promise<Message[]> => {
    const response = await fetch(`/api/messages?chatId=${encodeURIComponent(chatId)}`);
    if (!response.ok) {
      throw new Error(await response.text());
    }

    const data = (await response.json()) as { messages?: ApiMessage[] };
    const messages = Array.isArray(data.messages) ? data.messages : [];

    return messages.map((message) => ({
      id: message.id,
      role: toMessageRole(message.role),
      content: message.content,
      timestamp: message.createdAt,
    }));
  };

  const fetchModels = async () => {
    setStatusText('Checking Ollama…');
    try {
      const response = await fetch('/api/models');
      const data = (await response.json()) as { models?: string[] };

      const models = Array.isArray(data.models) ? data.models : [];
      setAvailableModels(models);
      if (models.length > 0) {
        setSelectedModelState((current) => current || models[0]);
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
    const initialize = async () => {
      try {
        const projectResponse = await fetch('/api/projects');
        if (!projectResponse.ok) {
          throw new Error(await projectResponse.text());
        }

        const projectData = (await projectResponse.json()) as { projects?: ApiProject[] };
        const loadedProjects = Array.isArray(projectData.projects) ? projectData.projects : [];

        if (loadedProjects.length > 0) {
          setProjects(loadedProjects);
          setSelectedProjectId((current) => current || loadedProjects[0].id);
        }

        const chatsResponse = await fetch('/api/chats');
        if (!chatsResponse.ok) {
          throw new Error(await chatsResponse.text());
        }

        const chatsData = (await chatsResponse.json()) as { chats?: ApiChat[] };
        const chats = Array.isArray(chatsData.chats) ? chatsData.chats : [];
        const fallbackProjectId = loadedProjects[0]?.id ?? 'default';

        const histories = chats.reduce<Record<string, Chat>>((accumulator, chat) => {
          accumulator[chat.id] = {
            id: chat.id,
            projectId: chat.projectId || fallbackProjectId,
            title: chat.title || 'Untitled chat',
            conversation: [],
            createdAt: chat.createdAt,
            updatedAt: chat.updatedAt,
            pinned: Boolean(chat.pinned),
            model: chat.model,
            systemPrompt: typeof chat.systemPrompt === 'string' ? chat.systemPrompt : null,
            usage: chat.usage ?? 0,
          };
          return accumulator;
        }, {});

        setChatHistories(histories);
      } catch (error) {
        console.error(error);
        setStatusText('Failed to load chats');
      }

      await fetchModels();
    };

    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === 'dark' || savedTheme === 'light') {
      document.documentElement.setAttribute('data-theme', savedTheme);
      setIsDarkMode(savedTheme === 'dark');
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.setAttribute('data-theme', 'dark');
      setIsDarkMode(true);
    }

    const savedModel = localStorage.getItem(MODEL_STORAGE_KEY);
    if (savedModel) {
      setSelectedModelState(savedModel);
    }

    void initialize();
  }, []);

  useEffect(() => {
    if (!selectedModel) {
      return;
    }

    localStorage.setItem(MODEL_STORAGE_KEY, selectedModel);

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

  const setSelectedModel = (model: string) => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      activeRequestIdRef.current = null;
      setSendingChatIds({});
      setStatusText('Ready');
    }

    setSelectedModelState(model);
  };

  const openSidebar = () => setIsSidebarOpen(true);
  const closeSidebar = () => setIsSidebarOpen(false);

  const handleNewChat = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      activeRequestIdRef.current = null;
      setSendingChatIds({});
    }

    setConversation([]);
    setCurrentChatId(null);
    currentChatIdRef.current = null;
    setAttachedFiles([]);
    setPrompt('');
    setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
    closeSidebar();
    setContextWindow((previous) => ({ ...previous, current: 0 }));
    setStatusText('Ready');
  };

  const handleSelectProject = (projectId: string) => {
    setSelectedProjectId(projectId);

    if (currentChatId) {
      const activeChat = chatHistories[currentChatId];
      if (activeChat && activeChat.projectId !== projectId) {
        handleNewChat();
      }
    }
  };

  const handleCreateProject = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }

    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data = (await response.json()) as { project?: ApiProject };
      if (!data.project) {
        throw new Error('Missing project in response');
      }

      setProjects((previous) => [...previous, data.project!]);
      setSelectedProjectId(data.project.id);
      handleNewChat();
    } catch (error) {
      console.error(error);
      setStatusText('Failed to create project');
    }
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
    setSelectedProjectId(chat.projectId);
    if (chat.model) {
      setSelectedModelState(chat.model);
    }
    setSystemPrompt(chat.systemPrompt || DEFAULT_SYSTEM_PROMPT);
    setContextWindow((previous) => ({ ...previous, current: chat.usage || 0 }));
    closeSidebar();

    void (async () => {
      try {
        const messages = await loadMessages(id);
        updateHistories((previous) => {
          const current = previous[id];
          if (!current) {
            return previous;
          }

          return {
            ...previous,
            [id]: {
              ...current,
              conversation: messages,
            },
          };
        });

        if (currentChatIdRef.current === id) {
          setConversation(messages);
        }
      } catch (error) {
        console.error(error);
        setStatusText('Failed to load messages');
      }
    })();
  };

  const handleDeleteChat = (id: string) => {
    if (!chatHistories[id]) {
      console.warn(`[HISTORY] Chat ${id} not found in history`);
      return;
    }

    updateHistories((previous) => {
      const nextHistories = { ...previous };
      delete nextHistories[id];
      return nextHistories;
    });

    if (currentChatId === id) {
      handleNewChat();
    }

    void (async () => {
      try {
        const response = await fetch(`/api/chats/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }
      } catch (error) {
        console.error(error);
        setStatusText('Failed to delete chat');
      }
    })();
  };

  const handleTogglePin = (id: string) => {
    const chat = chatHistories[id];
    if (!chat) {
      return;
    }

    const nextPinned = !chat.pinned;
    const updatedAt = Date.now();

    updateHistories((previous) => ({
      ...previous,
      [id]: {
        ...previous[id],
        pinned: nextPinned,
        updatedAt,
      },
    }));

    void patchChat(id, { pinned: nextPinned, updatedAt })
      .then((updatedChat) => {
        updateHistories((previous) => {
          const current = previous[id];
          if (!current) {
            return previous;
          }

          return {
            ...previous,
            [id]: {
              ...current,
              title: updatedChat.title || current.title,
              pinned: Boolean(updatedChat.pinned),
              updatedAt: updatedChat.updatedAt || current.updatedAt,
              model: updatedChat.model ?? current.model,
              systemPrompt:
                typeof updatedChat.systemPrompt === 'string'
                  ? updatedChat.systemPrompt
                  : current.systemPrompt,
              usage: updatedChat.usage ?? current.usage,
            },
          };
        });
      })
      .catch((error) => {
        console.error(error);
        setStatusText('Failed to update pin');
        updateHistories((previous) => ({
          ...previous,
          [id]: {
            ...previous[id],
            pinned: chat.pinned,
            updatedAt: chat.updatedAt,
          },
        }));
      });
  };

  const handleRenameChat = (id: string, nextTitle: string) => {
    const chat = chatHistories[id];
    if (!chat) {
      return;
    }

    const trimmedTitle = nextTitle.trim();
    if (!trimmedTitle || trimmedTitle === chat.title) {
      return;
    }

    const updatedAt = Date.now();

    updateHistories((previous) => ({
      ...previous,
      [id]: {
        ...previous[id],
        title: trimmedTitle,
        updatedAt,
      },
    }));

    void patchChat(id, { title: trimmedTitle, updatedAt })
      .then((updatedChat) => {
        updateHistories((previous) => {
          const current = previous[id];
          if (!current) {
            return previous;
          }

          return {
            ...previous,
            [id]: {
              ...current,
              title: updatedChat.title || current.title,
              pinned: Boolean(updatedChat.pinned),
              updatedAt: updatedChat.updatedAt || current.updatedAt,
              model: updatedChat.model ?? current.model,
              systemPrompt:
                typeof updatedChat.systemPrompt === 'string'
                  ? updatedChat.systemPrompt
                  : current.systemPrompt,
              usage: updatedChat.usage ?? current.usage,
            },
          };
        });
      })
      .catch((error) => {
        console.error(error);
        setStatusText('Failed to rename chat');
        updateHistories((previous) => ({
          ...previous,
          [id]: {
            ...previous[id],
            title: chat.title,
            updatedAt: chat.updatedAt,
          },
        }));
      });
  };

  const handleSystemPromptChange = (value: string) => {
    setSystemPrompt(value);
  };

  const handleSaveSystemPrompt = () => {
    const chatId = currentChatIdRef.current;
    if (!chatId) {
      return;
    }

    const currentChat = chatHistories[chatId];
    const normalizedPrompt = systemPrompt.trim() ? systemPrompt : DEFAULT_SYSTEM_PROMPT;
    const updatedAt = Date.now();

    updateHistories((previous) => {
      const chat = previous[chatId];
      if (!chat) {
        return previous;
      }

      return {
        ...previous,
        [chatId]: {
          ...chat,
          systemPrompt: normalizedPrompt,
          updatedAt,
        },
      };
    });

    void patchChat(chatId, { systemPrompt: normalizedPrompt, updatedAt })
      .then((updatedChat) => {
        updateHistories((previous) => {
          const chat = previous[chatId];
          if (!chat) {
            return previous;
          }

          return {
            ...previous,
            [chatId]: {
              ...chat,
              systemPrompt:
                typeof updatedChat.systemPrompt === 'string'
                  ? updatedChat.systemPrompt
                  : normalizedPrompt,
              updatedAt: updatedChat.updatedAt || chat.updatedAt,
            },
          };
        });
      })
      .catch((error) => {
        console.error(error);
        setStatusText('Failed to save system prompt');
        if (!currentChat) {
          return;
        }

        updateHistories((previous) => ({
          ...previous,
          [chatId]: {
            ...previous[chatId],
            systemPrompt: currentChat.systemPrompt,
            updatedAt: currentChat.updatedAt,
          },
        }));
      });
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

    if (!prompt.trim() && attachedFiles.length === 0) {
      return;
    }

    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      activeRequestIdRef.current = null;
      setSendingChatIds({});
    }

    const abortController = new AbortController();
    abortRef.current = abortController;
    const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    activeRequestIdRef.current = requestId;

    const activeChatId = currentChatId;

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
    const existingChat = chatHistories[chatId];
    const activeProjectId = existingChat?.projectId || selectedProjectId || projects[0]?.id || 'default';
    const createdAt = existingChat?.createdAt || startedAt;

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

    const title =
      existingChat?.title && existingChat.title.trim() && existingChat.title !== 'Untitled chat'
        ? existingChat.title
        : userMessage.content.slice(0, 50) || 'Untitled chat';

    updateHistories((previous) => ({
      ...previous,
      [chatId]: {
        id: chatId,
        projectId: activeProjectId,
        title,
        conversation: optimisticConversation,
        createdAt,
        updatedAt: startedAt,
        pinned: existingChat?.pinned ?? false,
        model: selectedModel || null,
        systemPrompt: existingChat?.systemPrompt ?? systemPrompt,
        usage: existingChat?.usage || 0,
      },
    }));

    void upsertChat({
      id: chatId,
      projectId: activeProjectId,
      title,
      pinned: existingChat?.pinned ?? false,
      model: selectedModel || null,
      systemPrompt: existingChat?.systemPrompt ?? systemPrompt,
      createdAt,
      updatedAt: startedAt,
    }).catch((error) => {
      console.error(error);
      setStatusText('Failed to save chat');
    });

    let requestFailed = false;
    let requestAborted = false;
    let fullContent = '';
    let finalUsage = existingChat?.usage || 0;
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    let assistantContentForSave = '';

    try {
      const recentConversation = conversation.slice(-MAX_CONVERSATION_HISTORY);

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          model: selectedModel || null,
          chatId,
          messages: [
            ...recentConversation.map((message) => ({ role: message.role, content: message.content })),
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

      const decoder = new TextDecoder();
      let streamBuffer = '';

      const applyStreamEvent = (data: StreamEvent) => {
        const contentChunk = data.message?.content || '';
        if (contentChunk) {
          fullContent += contentChunk;
          assistantContentForSave = fullContent;
        }

        if (data.usage) {
          finalUsage = parseUsage(data.usage);
          if (typeof data.usage.prompt_tokens === 'number') {
            promptTokens = data.usage.prompt_tokens;
          }
          if (typeof data.usage.completion_tokens === 'number') {
            completionTokens = data.usage.completion_tokens;
          }
        }

        if (typeof data.prompt_eval_count === 'number' && typeof data.eval_count === 'number') {
          promptTokens = data.prompt_eval_count;
          completionTokens = data.eval_count;
          finalUsage = data.prompt_eval_count + data.eval_count;
        }

        if (currentChatIdRef.current === chatId && finalUsage > 0) {
          setContextWindow((previous) => ({ ...previous, current: finalUsage }));
        }

        if (!contentChunk && !data.done) {
          return;
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
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        streamBuffer += decoder.decode(value, { stream: true });
        const lines = streamBuffer.split('\n');
        streamBuffer = lines.pop() ?? '';

        for (const line of lines) {
          const data = parseStreamLine(line);
          if (!data) {
            continue;
          }
          applyStreamEvent(data);
        }
      }

      streamBuffer += decoder.decode();
      if (streamBuffer.trim()) {
        const data = parseStreamLine(streamBuffer);
        if (data) {
          applyStreamEvent(data);
        }
      }

      assistantContentForSave = fullContent;

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
      });
    } catch (error) {
      const isAbortError =
        (error instanceof DOMException && error.name === 'AbortError') ||
        (error instanceof Error && error.name === 'AbortError');

      if (isAbortError) {
        requestAborted = true;

        if (!assistantContentForSave) {
          updateHistories((previous) => {
            const chat = previous[chatId];
            if (!chat || chat.conversation.length === 0) {
              return previous;
            }

            const updatedConversation = [...chat.conversation];
            const lastIndex = updatedConversation.length - 1;
            if (updatedConversation[lastIndex]?.role === 'assistant' && !updatedConversation[lastIndex].content) {
              updatedConversation.pop();
            }

            return {
              ...previous,
              [chatId]: {
                ...chat,
                conversation: updatedConversation,
                updatedAt: Date.now(),
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
              if (updated[lastIndex]?.role === 'assistant' && !updated[lastIndex].content) {
                updated.pop();
              }
              return updated;
            });
          }
        }
      } else {
        requestFailed = true;
        const message = error instanceof Error ? error.message : 'Unknown error';
        const errorText = `Error: ${message}`;

        if (!assistantContentForSave) {
          assistantContentForSave = errorText;
        }

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
        });

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
      }
    } finally {
      const isActiveRequest = activeRequestIdRef.current === requestId;
      const finishedAt = Date.now();
      const assistantMessageToPersist: Message = {
        ...assistantMessage,
        content: assistantContentForSave,
      };

      try {
        await upsertChat({
          id: chatId,
          projectId: activeProjectId,
          title,
          pinned: existingChat?.pinned ?? false,
          model: selectedModel || null,
          systemPrompt: existingChat?.systemPrompt ?? systemPrompt,
          createdAt,
          updatedAt: finishedAt,
        });

        await saveMessage(chatId, userMessage);
        if (assistantMessageToPersist.content.trim().length > 0 || !requestAborted) {
          await saveMessage(chatId, assistantMessageToPersist, {
            promptTokens,
            completionTokens,
          });
        }
      } catch (error) {
        console.error(error);
        setStatusText('Failed to persist messages');
      }

      if (isActiveRequest) {
        activeRequestIdRef.current = null;
        abortRef.current = null;

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
    () =>
      Object.entries(chatHistories)
        .filter(([, chat]) => !selectedProjectId || chat.projectId === selectedProjectId)
        .sort(([, a], [, b]) => {
          if (a.pinned !== b.pinned) {
            return a.pinned ? -1 : 1;
          }
          return b.updatedAt - a.updatedAt;
        }),
    [chatHistories, selectedProjectId]
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
    handleCreateProject,
    handleRenameChat,
    handleNewChat,
    handleSaveSystemPrompt,
    handleSelectProject,
    handleSelectChat,
    handleTogglePin,
    handleSend,
    isCurrentChatSending,
    isDarkMode,
    isSearchEnabled,
    isSidebarOpen,
    openSidebar,
    prompt,
    projects,
    removeAttachment,
    selectedProjectId,
    selectedModel,
    sendingChatIds,
    setIsSearchEnabled,
    setPrompt,
    setSelectedModel,
    sortedHistories,
    statusText,
    systemPrompt,
    toggleTheme,
    handleSystemPromptChange,
  };
}
