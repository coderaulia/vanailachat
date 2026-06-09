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
});
