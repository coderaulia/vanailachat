import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import type { ApiChat as Chat } from '../../frontend/types/chat';

describe('chats route', () => {
  const mockChat: Chat = {
    id: 'chat_1',
    title: 'Test Chat',
    projectId: 'proj_1',
    model: 'llama3',
    systemPrompt: 'System',
    pinned: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it('GET /api/chats returns chats, optionally filtered by project', async () => {
    const listChats = vi.fn().mockReturnValue([mockChat]);
    const app = createApp({ listChats });

    // Without filter — a default page size is always applied
    const response1 = await app.request('/api/chats');
    expect(response1.status).toBe(200);
    expect(await response1.json()).toEqual({ chats: [mockChat] });
    expect(listChats).toHaveBeenCalledWith(undefined, 200);

    // With filter
    const response2 = await app.request('/api/chats?projectId=proj_1');
    expect(response2.status).toBe(200);
    expect(listChats).toHaveBeenCalledWith('proj_1', 200);
  });

  it('GET /api/chats clamps a caller-supplied limit to the maximum', async () => {
    const listChats = vi.fn().mockReturnValue([mockChat]);
    const app = createApp({ listChats });

    await app.request('/api/chats?limit=5');
    expect(listChats).toHaveBeenCalledWith(undefined, 5);

    await app.request('/api/chats?limit=9999');
    expect(listChats).toHaveBeenCalledWith(undefined, 200);

    await app.request('/api/chats?limit=abc');
    expect(listChats).toHaveBeenCalledWith(undefined, 200);
  });

  it('POST /api/chats upserts a chat', async () => {
    const upsertChat = vi.fn().mockReturnValue(mockChat);
    const app = createApp({ upsertChat });

    const response = await app.request('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mockChat),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ chat: mockChat });
    expect(upsertChat).toHaveBeenCalled();
  });

  it('DELETE /api/chats/:id deletes a chat', async () => {
    const deleteChat = vi.fn().mockReturnValue(true);
    const app = createApp({ deleteChat });

    const response = await app.request('/api/chats/chat_1', {
      method: 'DELETE',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(deleteChat).toHaveBeenCalledWith('chat_1');
  });
});

describe('messages route', () => {
  it('GET /api/messages returns messages for a chat', async () => {
    const mockMessages = [{ id: 'm1', content: 'hello' }];
    const listMessages = vi.fn().mockReturnValue(mockMessages);
    const app = createApp({ listMessages });

    const response = await app.request('/api/messages?chatId=chat_1');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ messages: mockMessages });
    expect(listMessages).toHaveBeenCalledWith('chat_1', 500);
  });

  it('POST /api/messages inserts a message', async () => {
    const mockMsg = { id: 'm1', chatId: 'chat_1', role: 'user', content: 'hello' };
    const insertMessage = vi.fn().mockReturnValue(mockMsg);
    const app = createApp({ insertMessage });

    const response = await app.request('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mockMsg),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ message: mockMsg });
    expect(insertMessage).toHaveBeenCalled();
  });
});
