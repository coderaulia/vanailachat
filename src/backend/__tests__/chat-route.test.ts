import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createApp } from '../app';
import { OllamaService } from '../services/ollama';

describe('chat route', () => {
  beforeEach(() => {
    // OllamaProvider.isModelAvailable → OllamaService.getInstalledModels (real HTTP).
    // Stub it so tests don't need a running Ollama instance.
    vi.spyOn(OllamaService, 'getInstalledModels').mockResolvedValue(['llama3']);
  });

  it('pipes Ollama chat stream and normalizes multimodal messages', async () => {
    const streamPayload = [
      JSON.stringify({ message: { role: 'assistant', content: 'Here ' }, done: false }),
      JSON.stringify({ message: { role: 'assistant', content: 'you go.' }, done: false }),
      JSON.stringify({ done: true, prompt_eval_count: 20, eval_count: 8 }),
    ].join('\n');

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(streamPayload, {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
      })
    );

    const app = createApp({
      fetchFn: fetchMock,
      getBaseUrl: () => 'http://ollama.local',
      getInstalledModels: async () => ['llama3'],
      getModelDetails: async () => ({ capabilities: ['chat'] }),
    });

    const response = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this image' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } },
            ],
          },
        ],
        stream: true,
        search: true,
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');

    const payload = await response.text();
    expect(payload).toContain('Here ');
    expect(payload).toContain('prompt_eval_count');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://ollama.local/api/chat');

    const firstCallInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(firstCallInit?.method).toBe('POST');

    const requestBody = JSON.parse(String(firstCallInit?.body)) as {
      stream: boolean;
      messages: Array<{ role: string; content: string; images?: string[] }>;
    };

    expect(requestBody.stream).toBe(true);
    expect(requestBody.messages[0].role).toBe('system');
    expect(requestBody.messages[0].content).toContain('Web search is enabled');
    expect(requestBody.messages[1]).toEqual({
      role: 'user',
      content: 'Describe this image',
      images: ['abc123'],
    });
  });

  it('injects the onboarding user profile into the system prompt', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ done: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
      })
    );

    const settings: Record<string, string> = {
      user_name: 'Aulia Satrio',
      user_role: 'HR Business Partner & Programmer',
      base_instructions: 'keep it concise',
    };

    const app = createApp({
      fetchFn: fetchMock,
      getBaseUrl: () => 'http://ollama.local',
      getInstalledModels: async () => ['llama3'],
      getModelDetails: async () => ({ capabilities: ['chat'] }),
      getSetting: (key: string) => settings[key] ?? null,
    });

    const response = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3',
        messages: [{ role: 'user', content: 'who am i?' }],
        stream: true,
      }),
    });
    // The upstream call happens while the stream is piped — drain it first.
    await response.text();

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit)?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };

    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('Aulia Satrio');
    expect(body.messages[0].content).toContain('HR Business Partner & Programmer');
    expect(body.messages[0].content).toContain('keep it concise');
  });

  it('omits the profile from synthetic title-generation calls', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ done: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
      })
    );

    const app = createApp({
      fetchFn: fetchMock,
      getBaseUrl: () => 'http://ollama.local',
      getInstalledModels: async () => ['llama3'],
      getModelDetails: async () => ({ capabilities: ['chat'] }),
      getSetting: (key: string) => (key === 'user_name' ? 'Aulia Satrio' : null),
    });

    const response = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3',
        messages: [{ role: 'user', content: 'title this' }],
        stream: true,
        skipMemory: true,
      }),
    });
    await response.text();

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit)?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };

    expect(body.messages[0].content).not.toContain('Aulia Satrio');
  });
});
