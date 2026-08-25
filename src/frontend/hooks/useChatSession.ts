import { useState, useRef, useEffect, useMemo } from 'react';
import type { ChangeEvent } from 'react';
import type { Attachment, ApiChat, ContextWindow, Message, ApiProject, Chat, PendingApproval } from '../types/chat';
import type { ModelRole } from '../config/modelRoles';
import { DEFAULT_SYSTEM_PROMPT } from '../config/constants';
import { toModelRole } from '../utils/chatUtils';
import type { ModelMetadataMap } from '../config/modelMetadata';
import { getContextWindowForModel } from '../config/modelMetadata';
import { useSendMessage } from './useSendMessage';
import { useResearch } from './useResearch';

export function useChatSession(deps: {
  selectedModel: string;
  modelMetadata?: ModelMetadataMap;
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
  setProjects?: React.Dispatch<React.SetStateAction<ApiProject[]>>;
}) {
  // ── shared state ───────────────────────────────────────────────────────────
  const [conversation, setConversation] = useState<Message[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [projectRoot, setProjectRoot] = useState('');
  const [isSearchEnabled, setIsSearchEnabled] = useState(false);
  const [isAutoApprove, setIsAutoApprove] = useState(false);
  const [contextWindow, setContextWindow] = useState<ContextWindow>(() => ({
    current: 0,
    total: getContextWindowForModel(deps.selectedModel, deps.modelMetadata?.[deps.selectedModel]),
  }));
  const [sendingChatIds, setSendingChatIds] = useState<Record<string, boolean>>({});
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);

  const currentChatIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { currentChatIdRef.current = currentChatId; }, [currentChatId]);

  useEffect(() => {
    fetch('/api/settings/require_tool_approval')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (data && typeof (data as { value?: string }).value === 'string') {
          setIsAutoApprove((data as { value: string }).value === 'false');
        }
      })
      .catch(() => {});
  }, []);

  const toggleAutoApprove = async () => {
    const next = !isAutoApprove;
    setIsAutoApprove(next);
    try {
      await fetch('/api/settings/require_tool_approval', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: next ? 'false' : 'true' }),
      });
      deps.setStatusText(
        next
          ? 'Auto-approve enabled: Tools will execute automatically'
          : 'Auto-approve disabled: Tools will require confirmation',
      );
    } catch {
      deps.setStatusText('Failed to save auto-approve setting');
    }
  };

  useEffect(() => {
    const total = getContextWindowForModel(
      deps.selectedModel,
      deps.modelMetadata?.[deps.selectedModel],
    );
    setContextWindow((prev) => ({
      ...prev,
      total,
    }));
  }, [deps.selectedModel, deps.modelMetadata]);

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
  const respondToApproval = async (approved: boolean, autoApproveRemaining?: boolean) => {
    const approval = pendingApproval;
    if (!approval) return;

    setPendingApproval(null);

    if (autoApproveRemaining) {
      setIsAutoApprove(true);
      void fetch('/api/settings/require_tool_approval', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'false' }),
      }).catch(() => {});
    }

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

  // Keep projectRoot in sync with active project's root folder
  useEffect(() => {
    if (!currentChatId && deps.selectedProjectId) {
      const activeProj = deps.projects.find((p) => p.id === deps.selectedProjectId);
      if (activeProj?.projectRoot) {
        setProjectRoot(activeProj.projectRoot);
      }
    }
  }, [deps.selectedProjectId, deps.projects, currentChatId]);

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
    const activeProj = deps.selectedProjectId
      ? deps.projects.find((p) => p.id === deps.selectedProjectId)
      : null;
    setProjectRoot(activeProj?.projectRoot || '');
    const total = getContextWindowForModel(
      deps.selectedModel,
      deps.modelMetadata?.[deps.selectedModel],
    );
    setContextWindow({ current: 0, total });
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
    const modelToUse = chat.model || deps.selectedModel;
    const total = getContextWindowForModel(
      modelToUse,
      deps.modelMetadata?.[modelToUse],
    );
    const initialUsage = chat.usage || chat.conversation.reduce((acc, m) => acc + Math.ceil((m.content?.length || 0) / 4), 0);
    setContextWindow({ current: initialUsage, total });

    // Only reload from database if chat is not actively streaming in the background
    if (!sendingChatIds[id]) {
      void (async () => {
        try {
          const messages = await deps.loadMessages(id);
          deps.updateHistories(prev => {
            const current = prev[id];
            if (!current) return prev;
            return { ...prev, [id]: { ...current, conversation: messages } };
          });
          if (currentChatIdRef.current === id) {
            setConversation(messages);
            const calculatedUsage = chat.usage || messages.reduce((acc, m) => acc + Math.ceil((m.content?.length || 0) / 4), 0);
            setContextWindow(prev => ({ ...prev, current: calculatedUsage }));
          }
        } catch (error) {
          console.error(error);
          deps.setStatusText('Failed to load messages');
        }
      })();
    }
  };

  /** Formats the browser cannot read as text — the backend unpacks these. */
  const NEEDS_EXTRACTION = /\.(docx|xlsx|xlsm|pdf)$/i;

  const handleAttach = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const newAttachments: Attachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve) => {
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        newAttachments.push({ name: file.name, type: 'image', content: base64 });
      } else if (NEEDS_EXTRACTION.test(file.name)) {
        try {
          deps.setStatusText(`Extracting text from ${file.name}…`);
          const formData = new FormData();
          formData.append('file', file);
          const response = await fetch('/api/attachments/extract', {
            method: 'POST',
            body: formData,
          });
          if (!response.ok) {
            const err = await response.text().catch(() => 'Extraction failed');
            throw new Error(err);
          }
          const data = (await response.json()) as { name?: string; text?: string };
          newAttachments.push({
            name: file.name,
            type: 'file',
            content: data.text ?? '',
          });
          deps.setStatusText('Extracted document text');
        } catch (error) {
          console.error(error);
          deps.setStatusText(`Could not extract text from ${file.name}`);
        }
      } else {
        const text = await file.text();
        newAttachments.push({ name: file.name, type: 'file', content: text });
      }
    }
    deps.setAttachedFiles((prev) => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    deps.setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
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
   * Apply a workspace folder chosen in the in-app picker and auto-organize into a Project.
   */
  const handlePickProjectRoot = async (picked: string) => {
    const path = picked.trim();
    if (!path) return;

    setProjectRoot(path);
    deps.setStatusText(`Workspace: ${path}`);

    // Auto-create / associate Project for this workspace directory
    const existing = deps.projects.find((p) => (p.projectRoot || '').trim() === path);
    let targetProjectId = deps.selectedProjectId;
    if (existing) {
      targetProjectId = existing.id;
      deps.setSelectedProjectId(existing.id);
    } else {
      const folderName = path.split(/[\\/]/).filter(Boolean).pop() || 'Workspace';
      try {
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: folderName, projectRoot: path }),
        });
        if (res.ok) {
          const data = (await res.json()) as { project?: ApiProject };
          if (data.project) {
            targetProjectId = data.project.id;
            deps.setProjects?.((prev) => [...prev, data.project!]);
            deps.setSelectedProjectId(data.project.id);
          }
        }
      } catch (e) {
        console.warn('[WORKSPACE PROJECT] Failed to auto-create project:', e);
      }
    }

    const chatId = currentChatIdRef.current;
    if (!chatId) return;

    const updatedAt = Date.now();
    deps.updateHistories((prev) => {
      const chat = prev[chatId];
      if (!chat) return prev;
      return {
        ...prev,
        [chatId]: {
          ...chat,
          projectRoot: path,
          projectId: targetProjectId || chat.projectId,
          updatedAt,
        },
      };
    });

    try {
      await deps.patchChat(chatId, {
        projectRoot: path,
        projectId: targetProjectId || undefined,
        updatedAt,
      });
    } catch (error) {
      console.error(error);
      deps.setStatusText('Could not save the workspace folder');
    }
  };

  // ── derived ────────────────────────────────────────────────────────────────

  const contextPercentage = useMemo(
    () => Math.min(100, (contextWindow.current / (contextWindow.total || 32768)) * 100),
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
    isAutoApprove,
    toggleAutoApprove,
  };
}
