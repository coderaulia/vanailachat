import { useState, useMemo } from 'react';
import type { Chat, ApiChat, ApiProject, Message, MessageRole } from '../types/chat';
import {
  apiFetchProjects,
  apiFetchChats,
  apiCreateChat,
  apiDeleteChat,
  apiPatchChat,
  apiSaveMessage,
  apiFetchMessages,
  apiUpdateProject,
} from '../lib/api';
import type { ApiChatDto, ApiMessageDto, ApiProjectDto } from '../lib/api';

function toMessageRole(role: string): MessageRole {
  if (role === 'user' || role === 'assistant' || role === 'system') {
    return role;
  }
  return 'assistant';
}

// Both backends return camelCase now; the snake_case fallbacks keep older
// desktop builds and exported files working.
function toProject(p: ApiProjectDto): ApiProject {
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? null,
    instructions: p.instructions ?? null,
    memory: p.memory ?? null,
    pinned: Boolean(p.pinned),
    createdAt: p.createdAt ?? p.created_at ?? Date.now(),
  };
}

function toChat(c: ApiChatDto): ApiChat {
  return {
    id: c.id,
    projectId: c.projectId ?? c.project_id ?? '',
    title: c.title,
    model: c.model ?? null,
    projectRoot: c.projectRoot ?? c.project_root ?? null,
    systemPrompt: c.systemPrompt ?? c.system_prompt ?? null,
    pinned: Boolean(c.pinned),
    archived: Boolean(c.archived),
    role: c.role ?? null,
    createdAt: c.createdAt ?? c.created_at ?? Date.now(),
    updatedAt: c.updatedAt ?? c.updated_at ?? Date.now(),
    usage: typeof c.usage === 'number' ? c.usage : 0,
  };
}

function toMessage(m: ApiMessageDto): Message {
  return {
    id: m.id,
    role: toMessageRole(m.role),
    content: m.content,
    promptTokens: m.promptTokens ?? m.prompt_tokens ?? null,
    completionTokens: m.completionTokens ?? m.completion_tokens ?? null,
    timestamp: m.createdAt ?? m.created_at ?? m.timestamp ?? Date.now(),
    versionOf: m.versionOf ?? m.version_of ?? null,
    versionCount: m.versionCount ?? m.version_count ?? 1,
  };
}

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
    deleteChat,
    saveMessage,
    loadMessages,
  };
}
