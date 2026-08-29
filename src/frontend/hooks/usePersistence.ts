import { useState, useMemo } from 'react';
import type { Chat, ApiChat, ApiMessage, ApiProject, Message, MessageRole } from '../types/chat';
import {
  apiFetchProjects,
  apiFetchChats,
  apiCreateChat,
  apiDeleteChat,
  apiSaveMessage,
  apiFetchMessages,
  apiUpdateProject,
} from '../lib/api';

function toMessageRole(role: string): MessageRole {
  if (role === 'user' || role === 'assistant' || role === 'system') {
    return role;
  }
  return 'assistant';
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
    try {
      const loadedProjects = await apiFetchProjects();
      const mapped: ApiProject[] = loadedProjects.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description ?? null,
        instructions: p.instructions ?? null,
        memory: p.memory ?? null,
        pinned: Boolean(p.pinned),
        createdAt: p.created_at ?? Date.now(),
      }));
      setProjects(mapped);
      return mapped;
    } catch {
      const response = await fetch('/api/projects');
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json() as { projects?: ApiProject[] };
      const loadedProjects = Array.isArray(data.projects) ? data.projects : [];
      setProjects(loadedProjects);
      return loadedProjects;
    }
  };

  const fetchChats = async () => {
    try {
      const loadedChats = await apiFetchChats();
      return loadedChats.map((c) => ({
        id: c.id,
        projectId: c.project_id ?? undefined,
        title: c.title,
        model: c.model ?? undefined,
        projectRoot: c.project_root ?? undefined,
        systemPrompt: c.system_prompt ?? undefined,
        pinned: Boolean(c.pinned),
        role: c.role ?? undefined,
        createdAt: c.created_at ?? Date.now(),
        updatedAt: c.updated_at ?? Date.now(),
      }));
    } catch {
      const response = await fetch('/api/chats');
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json() as { chats?: ApiChat[] };
      return Array.isArray(data.chats) ? data.chats : [];
    }
  };

  const upsertChat = async (chat: ApiChat) => {
    try {
      await apiCreateChat({
        id: chat.id,
        title: chat.title,
        project_id: chat.projectId,
        project_root: chat.projectRoot,
        system_prompt: chat.systemPrompt,
        model: chat.model,
        role: chat.role,
      });
    } catch {
      const response = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chat),
      });
      if (!response.ok) throw new Error(await response.text());
    }
  };

  const patchChat = async (id: string, updates: Partial<ApiChat>) => {
    const response = await fetch(`/api/chats/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json() as { chat?: ApiChat };
    if (!data.chat) throw new Error('Missing chat in response');
    return data.chat;
  };

  const deleteChat = async (id: string) => {
    try {
      await apiDeleteChat(id);
    } catch {
      const response = await fetch(`/api/chats/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error(await response.text());
    }
  };

  const saveMessage = async (chatId: string, message: Message, options?: { promptTokens?: number; completionTokens?: number }) => {
    try {
      await apiSaveMessage({
        id: message.id,
        chat_id: chatId,
        role: message.role,
        content: message.content,
      });
    } catch {
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
      if (!response.ok) throw new Error(await response.text());
    }
  };

  const patchProject = async (id: string, updates: Partial<ApiProject>) => {
    try {
      const updated = await apiUpdateProject(id, {
        name: updates.name,
        description: updates.description ?? undefined,
        instructions: updates.instructions ?? undefined,
        memory: updates.memory ?? undefined,
        pinned: updates.pinned,
      });
      if (updated) {
        const mapped: ApiProject = {
          id: updated.id,
          name: updated.name,
          description: updated.description ?? null,
          instructions: updated.instructions ?? null,
          memory: updated.memory ?? null,
          pinned: Boolean(updated.pinned),
          createdAt: updated.created_at ?? Date.now(),
        };
        setProjects((prev) => prev.map((p) => (p.id === id ? mapped : p)));
        return mapped;
      }
    } catch {
      // Fall through to web fetch
    }

    const response = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json() as { project?: ApiProject };
    if (!data.project) throw new Error('Missing project in response');
    
    setProjects((prev) => prev.map((p) => (p.id === id ? data.project! : p)));
    return data.project;
  };

  const loadMessages = async (chatId: string): Promise<Message[]> => {
    try {
      const msgs = await apiFetchMessages(chatId);
      return msgs.map((m) => ({
        id: m.id,
        role: toMessageRole(m.role),
        content: m.content,
        promptTokens: null,
        completionTokens: null,
        timestamp: m.created_at ?? Date.now(),
      }));
    } catch {
      const response = await fetch(`/api/messages?chatId=${encodeURIComponent(chatId)}`);
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json() as { messages?: ApiMessage[] };
      const messages = Array.isArray(data.messages) ? data.messages : [];
      return messages.map((m) => ({
        id: m.id,
        role: toMessageRole(m.role),
        content: m.content,
        promptTokens: m.promptTokens ?? null,
        completionTokens: m.completionTokens ?? null,
        timestamp: m.createdAt,
      }));
    }
  };

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
