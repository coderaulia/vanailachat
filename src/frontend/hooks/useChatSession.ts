import { useState, useRef, useEffect, useMemo } from 'react';
import type { ChangeEvent } from 'react';
import type { Attachment, ApiChat, ContextWindow, Message, ApiProject, Chat, PendingApproval } from '../types/chat';
import type { ModelRole } from '../config/modelRoles';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_CONTEXT_WINDOW } from '../config/constants';
import { toModelRole } from '../utils/chatUtils';
import { useSendMessage } from './useSendMessage';
import { useResearch } from './useResearch';

export function useChatSession(deps: {
  selectedModel: string;
  selectedRole: ModelRole;
  selectedProjectId: string | null;
  projects: ApiProject[];
  chatHistories: Record<string, Chat>;
  statusText: string;
  setStatusText: (text: string) => void;
  closeSidebar: () => void;
  saveMessage: (chatId: string, message: Message, options?: { promptTokens?: number; completionTokens?: number }) => Promise<void>;
  upsertChat: (chat: ApiChat) => Promise<void>;
  patchChat: (id: string, updates: Partial<ApiChat>) => Promise<ApiChat>;
  loadMessages: (id: string) => Promise<Message[]>;
  updateHistories: (updater: (prev: Record<string, Chat>) => Record<string, Chat>) => void;
  setSelectedModel: (model: string) => void;
  setSelectedRole: (role: ModelRole) => void;
  setSelectedProjectId: (id: string | null) => void;
  prompt: string;
  setPrompt: (value: string) => void;
  attachedFiles: Attachment[];
  setAttachedFiles: (files: Attachment[] | ((prev: Attachment[]) => Attachment[])) => void;
  persona?: string;
}) {
  // ── shared state ───────────────────────────────────────────────────────────
  const [conversation, setConversation] = useState<Message[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [projectRoot, setProjectRoot] = useState('');
  const [isSearchEnabled, setIsSearchEnabled] = useState(false);
  const [contextWindow, setContextWindow] = useState<ContextWindow>(DEFAULT_CONTEXT_WINDOW);
  const [sendingChatIds, setSendingChatIds] = useState<Record<string, boolean>>({});
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);

  const currentChatIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { currentChatIdRef.current = currentChatId; }, [currentChatId]);

  // ── sub-hooks ──────────────────────────────────────────────────────────────

  const { handleSend, handleRegenerate, handleEditAndResend, lastSentPromptRef } = useSendMessage({
    selectedModel: deps.selectedModel,
    selectedRole: deps.selectedRole,
    selectedProjectId: deps.selectedProjectId,
    projects: deps.projects,
    chatHistories: deps.chatHistories,
    personaId: deps.persona,
    prompt: deps.prompt,
    setPrompt: deps.setPrompt,
    attachedFiles: deps.attachedFiles,
    setAttachedFiles: deps.setAttachedFiles,
    conversation,
    setConversation,
    systemPrompt,
    projectRoot,
    isSearchEnabled,
    currentChatId,
    setCurrentChatId,
    currentChatIdRef,
    abortRef,
    activeRequestIdRef,
    setSendingChatIds,
    setContextWindow,
    setStatusText: deps.setStatusText,
    setPendingApproval,
    updateHistories: deps.updateHistories,
    saveMessage: deps.saveMessage,
    upsertChat: deps.upsertChat,
    patchChat: deps.patchChat,
  });

  /**
   * Answer a parked tool call. Cleared optimistically so the prompt cannot be
   * double-submitted while the request is in flight.
   */
  const respondToApproval = async (approved: boolean) => {
    const approval = pendingApproval;
    if (!approval) return;

    setPendingApproval(null);
    try {
      await fetch('/api/chat/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: approval.id, approved }),
      });
    } catch {
      deps.setStatusText('Could not send the decision — the request will time out and be denied.');
    }
  };

  const { handleResearch } = useResearch({
    selectedModel: deps.selectedModel,
    selectedProjectId: deps.selectedProjectId,
    projects: deps.projects,
    prompt: deps.prompt,
    setPrompt: deps.setPrompt,
    setConversation,
    currentChatIdRef,
    abortRef,
    activeRequestIdRef,
    setSendingChatIds,
    setStatusText: deps.setStatusText,
    setCurrentChatId,
    updateHistories: deps.updateHistories,
    saveMessage: deps.saveMessage,
    upsertChat: deps.upsertChat,
  });

  // ── simple handlers ────────────────────────────────────────────────────────

  const handleAbort = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      deps.setPrompt(lastSentPromptRef.current);
    }
  };

  const handleNewChat = () => {
    setConversation([]);
    setCurrentChatId(null);
    currentChatIdRef.current = null;
    deps.setPrompt('');
    deps.setAttachedFiles([]);
    setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
    setProjectRoot('');
    setContextWindow(DEFAULT_CONTEXT_WINDOW);
  };

  const handleSelectChat = (id: string) => {
    const chat = deps.chatHistories[id];
    if (!chat) {
      console.warn(`[HISTORY] Chat ${id} not found in history`);
      return;
    }

    setConversation(chat.conversation);
    setCurrentChatId(id);
    currentChatIdRef.current = id;
    deps.setSelectedProjectId(chat.projectId);
    if (chat.model) deps.setSelectedModel(chat.model);
    if (chat.role) deps.setSelectedRole(toModelRole(chat.role));
    setSystemPrompt(chat.systemPrompt || DEFAULT_SYSTEM_PROMPT);
    setProjectRoot(chat.projectRoot || '');
    setContextWindow(prev => ({ ...prev, current: chat.usage || 0 }));

    void (async () => {
      try {
        const messages = await deps.loadMessages(id);
        deps.updateHistories(prev => {
          const current = prev[id];
          if (!current) return prev;
          return { ...prev, [id]: { ...current, conversation: messages } };
        });
        if (currentChatIdRef.current === id) setConversation(messages);
      } catch (error) {
        console.error(error);
        deps.setStatusText('Failed to load messages');
      }
    })();
  };

  /** Formats the browser cannot read as text — the backend unpacks these. */
  const NEEDS_EXTRACTION = /\.(docx|xlsx|xlsm|pdf)$/i;

  const handleAttach = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    await Promise.all(Array.from(files).map(async file => {
      if (file.type.startsWith('image/')) {
        const content = await new Promise<string>(resolve => {
          const reader = new FileReader();
          reader.onload = e => resolve(e.target?.result as string);
          reader.readAsDataURL(file);
        });
        deps.setAttachedFiles(prev => [...prev, { name: file.name, content, type: 'image' } as Attachment]);
        return;
      }

      // Office and PDF files are ZIP/binary containers. Reading them as text
      // yields mojibake, so they go to the backend extractor instead.
      if (NEEDS_EXTRACTION.test(file.name)) {
        try {
          const form = new FormData();
          form.append('file', file);
          const response = await fetch('/api/attachments/extract', { method: 'POST', body: form });
          const payload = await response.json() as { text?: string; error?: string };

          if (!response.ok || typeof payload.text !== 'string') {
            throw new Error(payload.error || 'Extraction failed');
          }

          deps.setAttachedFiles(prev => [...prev, { name: file.name, content: payload.text!, type: 'text' } as Attachment]);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Extraction failed';
          deps.setStatusText(`Could not read ${file.name}: ${message}`);
        }
        return;
      }

      const content = await new Promise<string>(resolve => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target?.result as string);
        reader.readAsText(file);
      });
      deps.setAttachedFiles(prev => [...prev, { name: file.name, content, type: 'text' } as Attachment]);
    }));

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    deps.setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleProjectRootChange = (value: string) => setProjectRoot(value);
  const handleSystemPromptChange = (value: string) => setSystemPrompt(value);

  const handleSaveSystemPrompt = () => {
    const chatId = currentChatIdRef.current;
    if (!chatId) return;
    const normalized = systemPrompt.trim() ? systemPrompt : DEFAULT_SYSTEM_PROMPT;
    const updatedAt = Date.now();
    deps.updateHistories(prev => {
      const chat = prev[chatId];
      if (!chat) return prev;
      return { ...prev, [chatId]: { ...chat, systemPrompt: normalized, updatedAt } };
    });
    void deps.patchChat(chatId, { systemPrompt: normalized, updatedAt })
      .then(updated => {
        const u = updated as ApiChat;
        deps.updateHistories(prev => {
          const chat = prev[chatId];
          if (!chat) return prev;
          return { ...prev, [chatId]: { ...chat, systemPrompt: u.systemPrompt || normalized, updatedAt: u.updatedAt || chat.updatedAt } };
        });
      })
      .catch(err => { console.error(err); deps.setStatusText('Failed to save system prompt'); });
  };

  const handleSaveProjectRoot = () => {
    const chatId = currentChatIdRef.current;
    if (!chatId) return;
    const normalized = projectRoot.trim() || null;
    const updatedAt = Date.now();
    deps.updateHistories(prev => {
      const chat = prev[chatId];
      if (!chat) return prev;
      return { ...prev, [chatId]: { ...chat, projectRoot: normalized, updatedAt } };
    });
    void deps.patchChat(chatId, { projectRoot: normalized, updatedAt })
      .then(updated => {
        const u = updated as ApiChat;
        deps.updateHistories(prev => {
          const chat = prev[chatId];
          if (!chat) return prev;
          return { ...prev, [chatId]: { ...chat, projectRoot: u.projectRoot ?? normalized, updatedAt: u.updatedAt || chat.updatedAt } };
        });
      })
      .catch(err => { console.error(err); deps.setStatusText('Failed to save project root'); });
  };

  /**
   * Apply a workspace folder chosen in the in-app picker.
   *
   * This used to shell out to a native dialog, which the server could not
   * reliably display — the request hung and the button looked dead.
   */
  const handlePickProjectRoot = async (picked: string) => {
    const path = picked.trim();
    if (!path) return;

    setProjectRoot(path);
    deps.setStatusText(`Workspace: ${path}`);

    const chatId = currentChatIdRef.current;
    if (!chatId) return;

    const updatedAt = Date.now();
    deps.updateHistories(prev => {
      const chat = prev[chatId];
      if (!chat) return prev;
      return { ...prev, [chatId]: { ...chat, projectRoot: path, updatedAt } };
    });

    try {
      await deps.patchChat(chatId, { projectRoot: path, updatedAt });
    } catch (error) {
      console.error(error);
      deps.setStatusText('Could not save the workspace folder');
    }
  };

  // ── derived ────────────────────────────────────────────────────────────────

  const contextPercentage = useMemo(
    () => Math.min(100, (contextWindow.current / contextWindow.total) * 100),
    [contextWindow],
  );
  const isCurrentChatSending = useMemo(
    () => (currentChatId ? Boolean(sendingChatIds[currentChatId]) : false),
    [currentChatId, sendingChatIds],
  );

  return {
    prompt: deps.prompt,
    setPrompt: deps.setPrompt,
    conversation,
    setConversation,
    currentChatId,
    setCurrentChatId,
    attachedFiles: deps.attachedFiles,
    setAttachedFiles: deps.setAttachedFiles,
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
    handlePickProjectRoot,
    handleSend,
    pendingApproval,
    respondToApproval,
    handleRegenerate,
    handleEditAndResend,
    handleAbort,
    handleResearch,
    contextPercentage,
    isCurrentChatSending,
  };
}
