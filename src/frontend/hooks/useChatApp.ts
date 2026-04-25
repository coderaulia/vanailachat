// Refactored useChatApp.ts with explicit exports
import { useEffect, useState } from 'react';
import type { ApiProject, Chat } from '../types/chat';
import type { ModelRole } from '../config/modelRoles';
import { useModelManager } from './useModelManager';
import { usePersistence } from './usePersistence';
import { useUIState } from './useUIState';
import { useChatSession } from './useChatSession';
import { DEFAULT_MODEL_ROLE } from '../config/constants';

export function useChatApp() {
  const [prompt, setPrompt] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<any[]>([]);
  const hasImageAttachment = attachedFiles.some(f => f.type === 'image');

  const uiState = useUIState();
  const [viewMode, setViewMode] = useState<'chat' | 'project'>('chat');
  const persistence = usePersistence();
  const modelManager = useModelManager(prompt, hasImageAttachment);

  const {
    setSelectedModel,
    setSelectedRole,
    getRoleRecommendedModels,
    selectedModel,
    selectedRole,
  } = modelManager;

  const {
    fetchProjects,
    fetchChats,
    setSelectedProjectId,
    setChatHistories,
    patchChat,
    chatHistories,
    selectedProjectId,
    projects,
  } = persistence;

  const { setStatusText, closeSidebar } = uiState;

  const chatSession = useChatSession({
    selectedModel,
    selectedRole,
    selectedProjectId,
    projects,
    chatHistories,
    statusText: uiState.statusText,
    setStatusText,
    closeSidebar,
    saveMessage: persistence.saveMessage,
    upsertChat: persistence.upsertChat,
    patchChat,
    loadMessages: persistence.loadMessages,
    updateHistories: (updater) => setChatHistories(updater),
    setSelectedModel,
    setSelectedRole,
    setSelectedProjectId,
    prompt,
    setPrompt,
    attachedFiles,
    setAttachedFiles,
  });

  const { handleNewChat, currentChatIdRef } = chatSession;

  const updateHistories = (updater: (prev: Record<string, Chat>) => Record<string, Chat>) => {
    setChatHistories((prev) => updater(prev));
  };

  useEffect(() => {
    const initialize = async () => {
      try {
        const loadedProjects = await fetchProjects();
        const loadedChats = await fetchChats();

        const histories = loadedChats.reduce<Record<string, Chat>>((acc, chat) => {
          acc[chat.id] = {
            id: chat.id,
            projectId: chat.projectId || loadedProjects[0]?.id || 'default',
            title: chat.title || 'Untitled chat',
            conversation: [],
            createdAt: chat.createdAt,
            updatedAt: chat.updatedAt,
            pinned: Boolean(chat.pinned),
            role: chat.role || DEFAULT_MODEL_ROLE,
            model: chat.model,
            projectRoot: chat.projectRoot || null,
            systemPrompt: chat.systemPrompt || null,
            usage: chat.usage ?? 0,
          };
          return acc;
        }, {});
        setChatHistories(histories);

        if (loadedProjects.length > 0 && !selectedProjectId) {
          setSelectedProjectId(loadedProjects[0].id);
        }
      } catch (error) {
        console.error(error);
        setStatusText('Failed to load workspace');
      }
    };
    initialize();
  }, []);

  const handleSelectRole = (role: ModelRole) => {
    setSelectedRole(role);
    modelManager.setDismissedSuggestionPrompt(null);

    const recommendedModels = getRoleRecommendedModels(role);
    if (recommendedModels.length > 0 && !recommendedModels.includes(selectedModel)) {
      setSelectedModel(recommendedModels[0]);
    }

    const chatId = currentChatIdRef.current;
    if (!chatId) return;

    const updatedAt = Date.now();
    updateHistories((prev) => {
      const chat = prev[chatId];
      if (!chat) return prev;
      return { ...prev, [chatId]: { ...chat, role, updatedAt } };
    });

    void patchChat(chatId, { role, updatedAt }).catch((err) => {
      console.error(err);
      setStatusText('Failed to save role');
    });
  };

  const handleAcceptRoleSuggestion = () => {
    const lowered = prompt.toLowerCase();
    const hasCode = lowered.includes('```') || /\b[\w-]+\.(ts|tsx|js|jsx|py|go|rs|java|cpp|c|cs|rb|php|html|css|json)\b/.test(lowered);
    const role = hasCode ? 'coding' : null;
    if (role) {
      handleSelectRole(role as ModelRole);
    }
  };

  const handleDismissRoleSuggestion = () => {
    modelManager.setDismissedSuggestionPrompt(prompt);
  };

  const handleExportData = async () => {
    try {
      const res = await fetch('/api/export');
      if (!res.ok) throw new Error(await res.text());
      const backup = await res.json();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `vanaila-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      setStatusText('Failed to export data');
    }
  };

  const handleImportData = async (file: File) => {
    try {
      const content = await file.text();
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(JSON.parse(content)),
      });
      if (!res.ok) throw new Error(await res.text());
      window.location.reload();
    } catch (err) {
      console.error(err);
      setStatusText('Failed to import data');
    }
  };

  const handleSelectProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    if (chatSession.currentChatId) {
      const activeChat = chatHistories[chatSession.currentChatId];
      if (activeChat && activeChat.projectId !== projectId) {
        handleNewChat();
      }
    }
  };

  const handleCreateProject = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as { project?: ApiProject };
      if (!data.project) throw new Error('Missing project in response');
      persistence.setProjects((prev) => [...prev, data.project!]);
      setSelectedProjectId(data.project.id);
      handleNewChat();
    } catch (error) {
      console.error(error);
      setStatusText('Failed to create project');
    }
  };

  const handleUpdateProject = async (projectId: string, updates: Partial<ApiProject>) => {
    try {
      await persistence.patchProject(projectId, updates);
      setStatusText('Project updated');
    } catch (error) {
      console.error(error);
      setStatusText('Failed to update project');
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await response.text());
      
      persistence.setProjects((prev) => prev.filter(p => p.id !== projectId));
      
      // If deleted project was selected, switch to first available or default
      if (selectedProjectId === projectId) {
        const remaining = persistence.projects.filter(p => p.id !== projectId);
        if (remaining.length > 0) {
          setSelectedProjectId(remaining[0].id);
        }
      }
      
      setStatusText('Project deleted');
      setViewMode('chat');
    } catch (error) {
      console.error(error);
      setStatusText('Failed to delete project');
    }
  };

  const handleDeleteChat = (id: string) => {
    if (!chatHistories[id]) return;
    updateHistories((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (chatSession.currentChatId === id) handleNewChat();
    void fetch(`/api/chats/${encodeURIComponent(id)}`, { method: 'DELETE' })
      .catch((err) => { console.error(err); setStatusText('Failed to delete chat'); });
  };

  const handleTogglePin = (id: string) => {
    const chat = chatHistories[id];
    if (!chat) return;
    const nextPinned = !chat.pinned;
    const updatedAt = Date.now();
    updateHistories(prev => ({ ...prev, [id]: { ...prev[id], pinned: nextPinned, updatedAt } }));
    void patchChat(id, { pinned: nextPinned, updatedAt })
      .catch(err => {
        console.error(err);
        setStatusText('Failed to update pin');
        updateHistories(prev => ({ ...prev, [id]: { ...prev[id], pinned: chat.pinned, updatedAt: chat.updatedAt } }));
      });
  };

  const handleRenameChat = (id: string, nextTitle: string) => {
    const chat = chatHistories[id];
    if (!chat) return;
    const trimmed = nextTitle.trim();
    if (!trimmed || trimmed === chat.title) return;
    const updatedAt = Date.now();
    updateHistories(prev => ({ ...prev, [id]: { ...prev[id], title: trimmed, updatedAt } }));
    void patchChat(id, { title: trimmed, updatedAt })
      .catch(err => {
        console.error(err);
        setStatusText('Failed to rename chat');
        updateHistories(prev => ({ ...prev, [id]: { ...prev[id], title: chat.title, updatedAt: chat.updatedAt } }));
      });
  };

  return {
    // UI State
    isSidebarOpen: uiState.isSidebarOpen,
    setIsSidebarOpen: uiState.setIsSidebarOpen,
    statusText: uiState.statusText,
    setStatusText: uiState.setStatusText,
    isDarkMode: uiState.isDarkMode,
    toggleTheme: uiState.toggleTheme,
    openSidebar: uiState.openSidebar,
    closeSidebar: uiState.closeSidebar,
    toggleSidebar: uiState.toggleSidebar,

    // Persistence
    projects: persistence.projects,
    selectedProjectId: persistence.selectedProjectId,
    chatHistories: persistence.chatHistories,
    sortedHistories: persistence.sortedHistories,

    // Model Manager
    availableModels: modelManager.availableModels,
    modelMetadata: modelManager.modelMetadata,
    selectedModel: modelManager.selectedModel,
    selectedRole: modelManager.selectedRole,
    filteredAvailableModels: modelManager.filteredAvailableModels,
    shouldShowRoleSuggestion: modelManager.shouldShowRoleSuggestion,
    suggestedRoleLabel: modelManager.suggestedRoleLabel,
    suggestedModelName: modelManager.suggestedModelName,

    // Session
    conversation: chatSession.conversation,
    currentChatId: chatSession.currentChatId,
    attachedFiles: chatSession.attachedFiles,
    systemPrompt: chatSession.systemPrompt,
    projectRoot: chatSession.projectRoot,
    isSearchEnabled: chatSession.isSearchEnabled,
    setIsSearchEnabled: chatSession.setIsSearchEnabled,
    contextWindow: chatSession.contextWindow,
    sendingChatIds: chatSession.sendingChatIds,
    contextPercentage: chatSession.contextPercentage,
    isCurrentChatSending: chatSession.isCurrentChatSending,
    fileInputRef: chatSession.fileInputRef,

    // Handlers
    handleSend: chatSession.handleSend,
    handleAbort: chatSession.handleAbort,
    handleAttach: chatSession.handleAttach,
    removeAttachment: chatSession.removeAttachment,
    handleNewChat: chatSession.handleNewChat,
    handleSelectChat: chatSession.handleSelectChat,
    handleSelectRole,
    handleAcceptRoleSuggestion,
    handleDismissRoleSuggestion,
    handleSelectProject,
    handleCreateProject,
    handleUpdateProject,
    handleDeleteProject,
    handleDeleteChat,
    handleTogglePin,
    handleRenameChat,
    handleExportData,
    handleImportData,
    handleProjectRootChange: chatSession.handleProjectRootChange,
    handleSystemPromptChange: chatSession.handleSystemPromptChange,
    handleSaveSystemPrompt: chatSession.handleSaveSystemPrompt,
    handleSaveProjectRoot: chatSession.handleSaveProjectRoot,
    handlePickProjectRoot: chatSession.handlePickProjectRoot,
    handleRefreshModels: modelManager.fetchModels,

    // View State
    viewMode,
    setViewMode,

    // Shared
    prompt,
    setPrompt,
    setSelectedModel,
    setSelectedRole,
  };
}
