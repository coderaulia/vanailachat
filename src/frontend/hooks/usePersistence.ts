import { useState, useMemo } from 'react';
import type { Chat, ApiChat, ApiMessage, ApiProject, Message, MessageRole } from '../types/chat';

const DEFAULT_MODEL_ROLE = 'general';

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
    const response = await fetch('/api/projects');
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json() as { projects?: ApiProject[] };
    const loadedProjects = Array.isArray(data.projects) ? data.projects : [];
    setProjects(loadedProjects);
    return loadedProjects;
  };

  const fetchChats = async () => {
    const response = await fetch('/api/chats');
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json() as { chats?: ApiChat[] };
    return Array.isArray(data.chats) ? data.chats : [];
  };

  const upsertChat = async (chat: ApiChat) => {
    const response = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chat),
    });
    if (!response.ok) throw new Error(await response.text());
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
    const response = await fetch(`/api/chats/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error(await response.text());
  };

  const saveMessage = async (chatId: string, message: Message, options?: { promptTokens?: number; completionTokens?: number }) => {
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
  };

  const loadMessages = async (chatId: string): Promise<Message[]> => {
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
    deleteChat,
    saveMessage,
    loadMessages,
  };
}
