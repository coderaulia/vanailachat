import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';

describe('data route', () => {
  it('GET /api/export bundles projects, chats, and messages', async () => {
    const projects = [{ id: 'p1', name: 'P', description: null, instructions: null, memory: null, pinned: false, createdAt: 1 }];
    const chats = [{ id: 'c1', projectId: 'p1', title: 'Hi', model: null, projectRoot: null, systemPrompt: null, pinned: false, role: null, createdAt: 1, updatedAt: 1, usage: 0 }];
    const messages = [{ id: 'm1', chatId: 'c1', role: 'user', content: 'hello', promptTokens: null, completionTokens: null, createdAt: 1 }];

    const listProjects = vi.fn().mockReturnValue(projects);
    const listChats = vi.fn().mockReturnValue(chats);
    const listMessages = vi.fn().mockReturnValue(messages);

    const app = createApp({ listProjects, listChats, listMessages });

    const response = await app.request('/api/export');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { projects: typeof projects; chats: typeof chats; messages: typeof messages };
    expect(body.projects).toEqual(projects);
    expect(body.chats).toEqual(chats);
    expect(body.messages).toEqual(messages);
  });

  it('POST /api/import skips existing chat IDs', async () => {
    const listProjects = vi.fn().mockReturnValue([]);
    const listChats = vi.fn().mockReturnValue([
      { id: 'c1', projectId: 'p1', title: 'old', model: null, projectRoot: null, systemPrompt: null, pinned: false, role: null, createdAt: 1, updatedAt: 1, usage: 0 },
    ]);
    const createProject = vi.fn().mockImplementation((p) => p);
    const upsertChat = vi.fn();
    const insertMessage = vi.fn();

    const app = createApp({ listProjects, listChats, createProject, upsertChat, insertMessage });

    const response = await app.request('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projects: [{ id: 'p1', name: 'P' }],
        chats: [
          { id: 'c1', projectId: 'p1', title: 'duplicate' },
          { id: 'c2', projectId: 'p1', title: 'new' },
        ],
        messages: [
          { id: 'm1', chatId: 'c2', role: 'user', content: 'hello' },
        ],
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { importedChats: number; skippedChats: number; importedMessages: number };
    expect(body.importedChats).toBe(1);
    expect(body.skippedChats).toBe(1);
    expect(body.importedMessages).toBe(1);
    expect(upsertChat).toHaveBeenCalledOnce();
    expect(insertMessage).toHaveBeenCalledOnce();
  });

  it('POST /api/pick-directory returns selected path', async () => {
    const pickDirectory = vi.fn().mockResolvedValue('/home/user/project');
    const app = createApp({ pickDirectory });

    const response = await app.request('/api/pick-directory', { method: 'POST' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { path: string };
    expect(body.path).toBe('/home/user/project');
  });
});
