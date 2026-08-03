import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createApp } from '../app.js';
import { OllamaService } from '../services/ollama.js';

function ndjsonResponse(lines: string[]): Response {
  return new Response(lines.join('\n') + '\n', {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
}

function appWith(overrides: Record<string, unknown>) {
  return createApp({
    getBaseUrl: () => 'http://ollama.local',
    getInstalledModels: async () => ['llama3'],
    getModelDetails: async () => ({ capabilities: ['chat'] }),
    listEnabledSkills: () => [],
    getSetting: () => null,
    embedOrNull: async () => null,
    searchMemoriesByKeyword: () => [],
    upsertMemory: vi.fn() as never,
    ...overrides,
  });
}

describe('server-side reply persistence', () => {
  beforeEach(() => {
    vi.spyOn(OllamaService, 'getInstalledModels').mockResolvedValue(['llama3']);
  });

  it('writes the finished reply with the client-supplied id', async () => {
    const insertMessage = vi.fn();
    const app = appWith({
      fetchFn: vi.fn<typeof fetch>().mockResolvedValue(
        ndjsonResponse([
          JSON.stringify({ message: { role: 'assistant', content: 'Sixteen ' } }),
          JSON.stringify({ message: { role: 'assistant', content: 'weeks.' } }),
          JSON.stringify({ done: true }),
        ]),
      ),
      getChat: () => ({ id: 'chat_1', projectId: 'proj_1', title: 'x' }) as never,
      insertMessage: insertMessage as never,
    });

    const response = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3',
        chatId: 'chat_1',
        assistantMessageId: 'msg_abc',
        messages: [{ role: 'user', content: 'how much parental leave?' }],
        stream: true,
      }),
    });
    await response.text();

    expect(insertMessage).toHaveBeenCalledTimes(1);
    expect(insertMessage.mock.calls[0][0]).toMatchObject({
      id: 'msg_abc',
      chatId: 'chat_1',
      role: 'assistant',
      content: 'Sixteen weeks.',
    });
  });

  it('creates the chat row first when the client has not saved it yet', async () => {
    const insertMessage = vi.fn();
    const upsertChat = vi.fn();
    const app = appWith({
      fetchFn: vi.fn<typeof fetch>().mockResolvedValue(
        ndjsonResponse([
          JSON.stringify({ message: { role: 'assistant', content: 'hello' } }),
          JSON.stringify({ done: true }),
        ]),
      ),
      getChat: () => null,
      insertMessage: insertMessage as never,
      upsertChat: upsertChat as never,
    });

    const response = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3',
        chatId: 'chat_new',
        assistantMessageId: 'msg_new',
        projectId: 'proj_1',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      }),
    });
    await response.text();

    // Foreign key on messages.chat_id means the chat must exist first.
    expect(upsertChat).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'chat_new', projectId: 'proj_1' }),
    );
    expect(insertMessage).toHaveBeenCalledTimes(1);
  });

  it('skips persistence when the client sends no message id', async () => {
    const insertMessage = vi.fn();
    const app = appWith({
      fetchFn: vi.fn<typeof fetch>().mockResolvedValue(
        ndjsonResponse([
          JSON.stringify({ message: { role: 'assistant', content: 'hello' } }),
          JSON.stringify({ done: true }),
        ]),
      ),
      getChat: () => ({ id: 'chat_1', projectId: 'proj_1', title: 'x' }) as never,
      insertMessage: insertMessage as never,
    });

    const response = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3',
        chatId: 'chat_1',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      }),
    });
    await response.text();

    expect(insertMessage).not.toHaveBeenCalled();
  });

  it('does not fail the response when the write throws', async () => {
    const app = appWith({
      fetchFn: vi.fn<typeof fetch>().mockResolvedValue(
        ndjsonResponse([
          JSON.stringify({ message: { role: 'assistant', content: 'hello' } }),
          JSON.stringify({ done: true }),
        ]),
      ),
      getChat: () => ({ id: 'chat_1', projectId: 'proj_1', title: 'x' }) as never,
      insertMessage: (() => {
        throw new Error('disk full');
      }) as never,
    });

    const response = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3',
        chatId: 'chat_1',
        assistantMessageId: 'msg_abc',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('hello');
  });
});
