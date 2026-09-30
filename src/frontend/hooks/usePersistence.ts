import { useState, useMemo } from 'react';
import type { Chat, ApiChat, ApiProject, Message } from '../types/chat';
import {
  apiFetchProjects,
  apiFetchChats,
  apiCreateChat,
  apiCreateProject,
  apiDeleteChat,
  apiDeleteProject,
  apiPatchChat,
  apiSaveMessage,
  apiFetchMessages,
  apiUpdateProject,
} from '../lib/api';
import { toChat, toMessage, toProject } from '../lib/mappers';

export function usePersistence() {
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [chatHistories, setChatHistories] = useState<Record<string, Chat>>({});

  const sortedHistories = useMemo(() => {
    return Object.entries(chatHistories).sort((a, b) => {
      if (a[1].pinned && !b[1].pinned) return -1;
      if (!a[1].pinned && b[1].pinned) return 1;
      return b[1].updatedAt - a[1].updatedAt;
    });
  }, [chatHistories]);

  const fetchProjects = async () => {
    const mapped = (await apiFetchProjects()).map(toProject);
    setProjects(mapped);
    return mapped;
  };

  const fetchChats = async () => (await apiFetchChats()).map(toChat);

  const upsertChat = async (chat: ApiChat) => {
    await apiCreateChat({
      id: chat.id,
      title: chat.title,
      projectId: chat.projectId,
      projectRoot: chat.projectRoot,
      systemPrompt: chat.systemPrompt,
      model: chat.model,
      role: chat.role,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      pinned: chat.pinned,
    });
  };

  const patchChat = async (id: string, updates: Partial<ApiChat>) => toChat(await apiPatchChat(id, updates));

  const deleteChat = async (id: string) => {
    await apiDeleteChat(id);
  };

  const saveMessage = async (
    chatId: string,
    message: Message,
    options?: { promptTokens?: number; completionTokens?: number },
  ) => {
    await apiSaveMessage({
      id: message.id,
      chatId,
      role: message.role,
      content: message.content,
      promptTokens: options?.promptTokens,
      completionTokens: options?.completionTokens,
      createdAt: message.timestamp,
      versionOf: message.versionOf ?? null,
    });
  };

  const createProject = async (input: { name: string; description?: string; instructions?: string; projectRoot?: string }) => {
    const created = await apiCreateProject({
      id: `project_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ...input,
    });
    const mapped = toProject(created);
    setProjects((prev) => [...prev, mapped]);
    return mapped;
  };

  const deleteProject = async (id: string) => {
    await apiDeleteProject(id);
    setProjects((prev) => prev.filter((project) => project.id !== id));
  };

  const patchProject = async (id: string, updates: Partial<ApiProject>) => {
    const updated = await apiUpdateProject(id, {
      name: updates.name,
      description: updates.description ?? undefined,
      instructions: updates.instructions ?? undefined,
      memory: updates.memory ?? undefined,
      pinned: updates.pinned,
    });
    if (!updated) throw new Error('Missing project in response');
    const mapped = toProject(updated);
    setProjects((prev) => prev.map((p) => (p.id === id ? mapped : p)));
    return mapped;
  };

  const loadMessages = async (chatId: string): Promise<Message[]> => (await apiFetchMessages(chatId)).map(toMessage);

  return {
    projects,
    setProjects,
    selectedProjectId,
    setSelectedProjectId,
    chatHistories,
    setChatHistories,
    sortedHistories,
    fetchProjects,
    fetchChats,
    upsertChat,
    patchChat,
    patchProject,
    createProject,
    deleteProject,
    deleteChat,
    saveMessage,
    loadMessages,
  };
}
