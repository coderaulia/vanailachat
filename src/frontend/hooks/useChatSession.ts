import { useState, useRef, useEffect, useMemo } from 'react';
import type { FormEvent, ChangeEvent } from 'react';
import type { Attachment, ContextWindow, Message, ApiChat, ApiProject, SendMessagePart, StreamEvent, Chat } from '../types/chat';
import type { ModelRole } from '../config/modelRoles';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_CONTEXT_WINDOW, MAX_CONVERSATION_HISTORY } from '../config/constants';
import { toModelRole, parseUsage, parseStreamLine } from '../utils/chatUtils';

export function useChatSession(deps: {
  selectedModel: string;
  selectedRole: ModelRole;
  selectedProjectId: string | null;
  projects: ApiProject[];
  chatHistories: Record<string, Chat>;
  statusText: string;
  setStatusText: (text: string) => void;
  closeSidebar: () => void;
  saveMessage: (chatId: string, message: Message, options?: any) => Promise<void>;
  upsertChat: (chat: any) => Promise<void>;
  patchChat: (id: string, updates: any) => Promise<any>;
  loadMessages: (id: string) => Promise<Message[]>;
  updateHistories: (updater: (prev: Record<string, Chat>) => Record<string, Chat>) => void;
  setSelectedModel: (model: string) => void;
  setSelectedRole: (role: ModelRole) => void;
  setSelectedProjectId: (id: string | null) => void;
  prompt: string;
  setPrompt: (value: string) => void;
  attachedFiles: Attachment[];
  setAttachedFiles: (files: Attachment[] | ((prev: Attachment[]) => Attachment[])) => void;
}) {
  const {
    selectedModel,
    selectedRole,
    selectedProjectId,
    projects,
    chatHistories,
    statusText,
    setStatusText,
    closeSidebar,
    saveMessage,
    upsertChat,
    patchChat,
    loadMessages,
    updateHistories,
    setSelectedModel,
    setSelectedRole,
    setSelectedProjectId,
    prompt,
    setPrompt,
    attachedFiles,
    setAttachedFiles,
  } = deps;

  const [conversation, setConversation] = useState<Message[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  // removed local attachedFiles state
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [projectRoot, setProjectRoot] = useState('');
  const [isSearchEnabled, setIsSearchEnabled] = useState(false);
  const [contextWindow, setContextWindow] = useState<ContextWindow>(DEFAULT_CONTEXT_WINDOW);
  const [sendingChatIds, setSendingChatIds] = useState<Record<string, boolean>>({});

  const currentChatIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    currentChatIdRef.current = currentChatId;
  }, [currentChatId]);

  const handleNewChat = () => {
    setConversation([]);
    setCurrentChatId(null);
    currentChatIdRef.current = null;
    setPrompt('');
    setAttachedFiles([]);
    setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
    setProjectRoot('');
    setContextWindow(DEFAULT_CONTEXT_WINDOW);
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
      setSelectedModel(chat.model);
    }
    
    if (chat.role) {
      setSelectedRole(toModelRole(chat.role));
    }
    
    setSystemPrompt(chat.systemPrompt || DEFAULT_SYSTEM_PROMPT);
    setProjectRoot(chat.projectRoot || '');
    setContextWindow((previous) => ({ ...previous, current: chat.usage || 0 }));

    void (async () => {
      try {
        const messages = await loadMessages(id);
        updateHistories((previous) => {
          const current = previous[id];
          if (!current) return previous;
          return { ...previous, [id]: { ...current, conversation: messages } };
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

  const handleAttach = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const filePromises = Array.from(files).map((file) => {
      return new Promise<void>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target?.result as string;
          const type = file.type.startsWith('image/') ? 'image' : 'text';
          setAttachedFiles((prev) => [...prev, { name: file.name, content, type }]);
          resolve();
        };
        if (file.type.startsWith('image/')) {
          reader.readAsDataURL(file);
        } else {
          reader.readAsText(file);
        }
      });
    });

    await Promise.all(filePromises);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleProjectRootChange = (value: string) => setProjectRoot(value);
  const handleSystemPromptChange = (value: string) => setSystemPrompt(value);

  const handleSaveSystemPrompt = () => {
    const chatId = currentChatIdRef.current;
    if (!chatId) return;
    const normalizedPrompt = systemPrompt.trim() ? systemPrompt : DEFAULT_SYSTEM_PROMPT;
    const updatedAt = Date.now();

    updateHistories((prev) => {
      const chat = prev[chatId];
      if (!chat) return prev;
      return { ...prev, [chatId]: { ...chat, systemPrompt: normalizedPrompt, updatedAt } };
    });

    void patchChat(chatId, { systemPrompt: normalizedPrompt, updatedAt })
      .then((updated) => {
        updateHistories((prev) => {
          const chat = prev[chatId];
          if (!chat) return prev;
          return { ...prev, [chatId]: { ...chat, systemPrompt: updated.systemPrompt || normalizedPrompt, updatedAt: updated.updatedAt || chat.updatedAt } };
        });
      })
      .catch((err) => {
        console.error(err);
        setStatusText('Failed to save system prompt');
      });
  };

  const handleSaveProjectRoot = () => {
    const chatId = currentChatIdRef.current;
    if (!chatId) return;
    const normalizedRoot = projectRoot.trim() || null;
    const updatedAt = Date.now();

    updateHistories((prev) => {
      const chat = prev[chatId];
      if (!chat) return prev;
      return { ...prev, [chatId]: { ...chat, projectRoot: normalizedRoot, updatedAt } };
    });

    void patchChat(chatId, { projectRoot: normalizedRoot, updatedAt })
      .then((updated) => {
        updateHistories((prev) => {
          const chat = prev[chatId];
          if (!chat) return prev;
          return { ...prev, [chatId]: { ...chat, projectRoot: updated.projectRoot ?? normalizedRoot, updatedAt: updated.updatedAt || chat.updatedAt } };
        });
      })
      .catch((err) => {
        console.error(err);
        setStatusText('Failed to save project root');
      });
  };

  // handleSend implementation
  const handleSend = async (event?: FormEvent) => {
    if (event) event.preventDefault();
    if (!prompt.trim() && attachedFiles.length === 0) return;

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
    const textMessagePart: Extract<SendMessagePart, { type: 'text' }> = { type: 'text', text: prompt };
    const messageContent: SendMessagePart[] = [textMessagePart];
    attachedFiles.filter(f => f.type === 'image').forEach(f => messageContent.push({ type: 'image_url', image_url: { url: f.content } }));

    const fileContext = attachedFiles.filter(f => f.type === 'text').map(f => `[File: ${f.name}]\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n');
    const finalPrompt = fileContext ? `${fileContext}\n\n${prompt}` : prompt;
    if (fileContext) textMessagePart.text = finalPrompt;

    const startedAt = Date.now();
    const chatId = activeChatId || `chat_${startedAt}_${Math.random().toString(36).slice(2, 11)}`;
    const existingChat = chatHistories[chatId];
    const activeProjectId = existingChat?.projectId || selectedProjectId || projects[0]?.id || 'default';
    const createdAt = existingChat?.createdAt || startedAt;

    const userMessage: Message = { id: `${startedAt}_user_${Math.random().toString(36).slice(2, 8)}`, role: 'user', content: finalPrompt, timestamp: startedAt };
    const assistantMessage: Message = { id: `${startedAt}_assistant_${Math.random().toString(36).slice(2, 8)}`, role: 'assistant', content: '', timestamp: startedAt + 1 };

    const optimisticConversation = [...conversation, userMessage, assistantMessage];
    setConversation(optimisticConversation);
    setPrompt('');
    setAttachedFiles([]);

    if (!activeChatId) {
      setCurrentChatId(chatId);
      currentChatIdRef.current = chatId;
    }

    setSendingChatIds(prev => ({ ...prev, [chatId]: true }));
    setStatusText('Thinking…');

    const title = existingChat?.title && existingChat.title.trim() && existingChat.title !== 'Untitled chat' ? existingChat.title : userMessage.content.slice(0, 50) || 'Untitled chat';

    updateHistories(prev => ({
      ...prev,
      [chatId]: {
        id: chatId,
        projectId: activeProjectId,
        title,
        conversation: optimisticConversation,
        createdAt,
        updatedAt: startedAt,
        pinned: existingChat?.pinned ?? false,
        role: existingChat?.role ?? selectedRole,
        model: selectedModel || (currentChatId ? chatHistories[currentChatId]?.model : null) || null,
        projectRoot: existingChat?.projectRoot ?? (projectRoot.trim() || null),
        systemPrompt: existingChat?.systemPrompt ?? systemPrompt,
        usage: existingChat?.usage || 0,
      }
    }));

    void upsertChat({
      id: chatId,
      projectId: activeProjectId,
      title,
      pinned: existingChat?.pinned ?? false,
      role: existingChat?.role ?? selectedRole,
      model: selectedModel || (currentChatId ? chatHistories[currentChatId]?.model : null) || null,
      projectRoot: existingChat?.projectRoot ?? (projectRoot.trim() || null),
      systemPrompt: existingChat?.systemPrompt ?? systemPrompt,
      createdAt,
      updatedAt: startedAt,
    }).catch(err => { console.error(err); setStatusText('Failed to save chat'); });

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
          model: selectedModel || (currentChatId ? chatHistories[currentChatId]?.model : null) || null,
          chatId,
          messages: [
            ...recentConversation.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: messageContent },
          ],
          stream: true,
          search: isSearchEnabled,
        }),
      });

      if (!response.ok) throw new Error(await response.text());
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader');

      const decoder = new TextDecoder();
      let streamBuffer = '';

      const applyStreamEventLocal = (data: StreamEvent) => {
        const contentChunk = data.message?.content || '';
        if (contentChunk) {
          fullContent += contentChunk;
          assistantContentForSave = fullContent;
        }

        if (data.usage) {
          finalUsage = parseUsage(data.usage);
          if (typeof data.usage.prompt_tokens === 'number') promptTokens = data.usage.prompt_tokens;
          if (typeof data.usage.completion_tokens === 'number') completionTokens = data.usage.completion_tokens;
        }

        if (typeof data.prompt_eval_count === 'number' && typeof data.eval_count === 'number') {
          promptTokens = data.prompt_eval_count;
          completionTokens = data.eval_count;
          finalUsage = data.prompt_eval_count + data.eval_count;
        }

        if (currentChatIdRef.current === chatId && finalUsage > 0) {
          setContextWindow(prev => ({ ...prev, current: finalUsage }));
        }

        if (!contentChunk && !data.done) return;

        updateHistories(prev => {
          const chat = prev[chatId];
          if (!chat || chat.conversation.length === 0) return prev;
          const updatedConversation = [...chat.conversation];
          const lastIndex = updatedConversation.length - 1;
          if (updatedConversation[lastIndex]?.role === 'assistant') {
            updatedConversation[lastIndex] = { ...updatedConversation[lastIndex], content: fullContent };
          }
          return { ...prev, [chatId]: { ...chat, conversation: updatedConversation, updatedAt: Date.now(), usage: finalUsage || chat.usage } };
        });

        if (currentChatIdRef.current === chatId) {
          setConversation(prev => {
            if (prev.length === 0) return prev;
            const updated = [...prev];
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
        if (done) break;
        streamBuffer += decoder.decode(value, { stream: true });
        const lines = streamBuffer.split('\n');
        streamBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const data = parseStreamLine(line);
          if (data) applyStreamEventLocal(data);
        }
      }

      streamBuffer += decoder.decode();
      if (streamBuffer.trim()) {
        const data = parseStreamLine(streamBuffer);
        if (data) applyStreamEventLocal(data);
      }
      assistantContentForSave = fullContent;
    } catch (error) {
      const isAbortError = (error instanceof DOMException && error.name === 'AbortError') || (error instanceof Error && error.name === 'AbortError');
      if (isAbortError) {
        requestAborted = true;
        if (!assistantContentForSave) {
          updateHistories(prev => {
            const chat = prev[chatId];
            if (!chat || chat.conversation.length === 0) return prev;
            const updatedConversation = [...chat.conversation];
            const lastIndex = updatedConversation.length - 1;
            if (updatedConversation[lastIndex]?.role === 'assistant' && !updatedConversation[lastIndex].content) updatedConversation.pop();
            return { ...prev, [chatId]: { ...chat, conversation: updatedConversation, updatedAt: Date.now() } };
          });
          if (currentChatIdRef.current === chatId) {
            setConversation(prev => {
              if (prev.length === 0) return prev;
              const updated = [...prev];
              const lastIndex = updated.length - 1;
              if (updated[lastIndex]?.role === 'assistant' && !updated[lastIndex].content) updated.pop();
              return updated;
            });
          }
        }
      } else {
        requestFailed = true;
        const message = error instanceof Error ? error.message : 'Unknown error';
        const errorText = `Error: ${message}`;
        if (!assistantContentForSave) assistantContentForSave = errorText;
        if (currentChatIdRef.current === chatId) setStatusText(errorText);

        updateHistories(prev => {
          const chat = prev[chatId];
          if (!chat || chat.conversation.length === 0) return prev;
          const updatedConversation = [...chat.conversation];
          const lastIndex = updatedConversation.length - 1;
          if (updatedConversation[lastIndex]?.role === 'assistant' && !updatedConversation[lastIndex].content) {
            updatedConversation[lastIndex] = { ...updatedConversation[lastIndex], content: errorText };
          }
          return { ...prev, [chatId]: { ...chat, conversation: updatedConversation, updatedAt: Date.now() } };
        });

        if (currentChatIdRef.current === chatId) {
          setConversation(prev => {
            if (prev.length === 0) return prev;
            const updated = [...prev];
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
      const assistantMessageToPersist: Message = { id: assistantMessage.id, role: 'assistant', content: assistantContentForSave, timestamp: assistantMessage.timestamp, promptTokens: promptTokens ?? null, completionTokens: completionTokens ?? null };

      updateHistories(prev => {
        const chat = prev[chatId];
        if (!chat || chat.conversation.length === 0) return prev;
        const updatedConversation = [...chat.conversation];
        const lastIndex = updatedConversation.length - 1;
        if (updatedConversation[lastIndex]?.role === 'assistant') {
          updatedConversation[lastIndex] = { ...updatedConversation[lastIndex], promptTokens: assistantMessageToPersist.promptTokens, completionTokens: assistantMessageToPersist.completionTokens };
        }
        return { ...prev, [chatId]: { ...chat, conversation: updatedConversation } };
      });

      if (currentChatIdRef.current === chatId) {
        setConversation(prev => {
          if (prev.length === 0) return prev;
          const updated = [...prev];
          const lastIndex = updated.length - 1;
          if (updated[lastIndex]?.role === 'assistant') {
            updated[lastIndex] = { ...updated[lastIndex], promptTokens: assistantMessageToPersist.promptTokens, completionTokens: assistantMessageToPersist.completionTokens };
          }
          return updated;
        });
      }

      try {
        await upsertChat({
          id: chatId,
          projectId: activeProjectId,
          title,
          pinned: existingChat?.pinned ?? false,
          role: existingChat?.role ?? selectedRole,
          model: selectedModel || (currentChatId ? chatHistories[currentChatId]?.model : null) || null,
          projectRoot: existingChat?.projectRoot ?? (projectRoot.trim() || null),
          systemPrompt: existingChat?.systemPrompt ?? systemPrompt,
          createdAt,
          updatedAt: finishedAt,
        });

        await saveMessage(chatId, userMessage);
        if (assistantMessageToPersist.content.trim().length > 0 || !requestAborted) {
          await saveMessage(chatId, assistantMessageToPersist, { promptTokens, completionTokens });
        }
      } catch (error) {
        console.error(error);
        setStatusText('Failed to persist messages');
      }

      if (isActiveRequest) {
        activeRequestIdRef.current = null;
        abortRef.current = null;
        setSendingChatIds(prev => {
          if (!prev[chatId]) return prev;
          const next = { ...prev };
          delete next[chatId];
          return next;
        });
        if (currentChatIdRef.current === chatId && !requestFailed) setStatusText('Ready');
      }
    }
  };

  const contextPercentage = useMemo(() => Math.min(100, (contextWindow.current / contextWindow.total) * 100), [contextWindow]);
  const isCurrentChatSending = useMemo(() => (currentChatId ? Boolean(sendingChatIds[currentChatId]) : false), [currentChatId, sendingChatIds]);

  return {
    prompt,
    setPrompt,
    conversation,
    setConversation,
    currentChatId,
    setCurrentChatId,
    attachedFiles,
    setAttachedFiles,
    systemPrompt,
    setSystemPrompt,
    projectRoot,
    setProjectRoot,
    isSearchEnabled,
    setIsSearchEnabled,
    contextWindow,
    setContextWindow,
    sendingChatIds,
    setSendingChatIds,
    fileInputRef,
    currentChatIdRef,
    abortRef,
    activeRequestIdRef,
    handleNewChat,
    handleSelectChat,
    handleAttach,
    removeAttachment,
    handleProjectRootChange,
    handleSystemPromptChange,
    handleSaveSystemPrompt,
    handleSaveProjectRoot,
    handleSend,
    contextPercentage,
    isCurrentChatSending,
  };
}
