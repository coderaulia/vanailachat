import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';

async function systemPromptFor(body: Record<string, unknown>, getChat: () => unknown = () => null) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify({ done: true }), { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } }),
  );
  const app = createApp({
    fetchFn: fetchMock,
    getBaseUrl: () => 'http://ollama.local',
    getInstalledModels: async () => ['llama3'],
    getModelDetails: async () => ({ capabilities: ['chat'] }),
    listEnabledSkills: () => [],
    getSetting: () => null,
    getChat: getChat as never,
    getProject: ((id: string) =>
      id === 'p1'
        ? { id: 'p1', name: 'Docs', description: null, instructions: 'Write in British English.', memory: 'Ships on Fridays.', pinned: false, createdAt: 0, projectRoot: null }
        : null) as never,
  });
  const response = await app.request('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'llama3', skipMemory: true, messages: [{ role: 'user', content: 'hello there' }], stream: true, ...body }),
  });
  await response.text();
  const sent = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as { messages: Array<{ content: string }> };
  return sent.messages[0].content;
}

describe('project instructions in the system prompt', () => {
  it('apply to the first message of a brand-new chat, which has no row yet', async () => {
    const prompt = await systemPromptFor({ projectId: 'p1' });
    expect(prompt).toContain('[Project Instructions]\nWrite in British English.');
    expect(prompt).toContain('[Shared Project Memory]\nShips on Fridays.');
  });

  it('prefer the saved chat’s project over the one in the request', async () => {
    const prompt = await systemPromptFor(
      { projectId: 'other', chatId: 'c1' },
      () => ({ id: 'c1', projectId: 'p1', title: 't', systemPrompt: null, projectRoot: null, pinned: false, archived: false, model: null, role: null, createdAt: 0, updatedAt: 0, usage: 0 }),
    );
    expect(prompt).toContain('Write in British English.');
  });

  it('are skipped for an unknown project', async () => {
    expect(await systemPromptFor({ projectId: 'default' })).not.toContain('[Project Instructions]');
  });
});
