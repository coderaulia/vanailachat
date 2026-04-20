import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';

describe('chat route', () => {
  it('executes tool calls and returns SSE payload', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: '',
                  tool_calls: [
                    {
                      id: 'call_1',
                      type: 'function',
                      function: {
                        name: 'search_web',
                        arguments: JSON.stringify({ query: 'latest ai news' }),
                      },
                    },
                  ],
                },
              },
            ],
            usage: { total_tokens: 32 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'Here is the latest update.',
                },
              },
            ],
            usage: { total_tokens: 48 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

    const executeTool = vi.fn().mockResolvedValue('[{"title":"AI update"}]');

    const app = createApp({
      executeTool,
      fetchFn: fetchMock,
      getBaseUrl: () => 'http://ollama.local',
    });

    const response = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3',
        messages: [{ role: 'user', content: 'news?' }],
        stream: true,
        search: true,
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const payload = await response.text();
    expect(payload).toContain('Here is the latest update.');
    expect(payload).toContain('"done":true');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(executeTool).toHaveBeenCalledWith('search_web', { query: 'latest ai news' });

    const firstCallInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(firstCallInit?.method).toBe('POST');
    const firstBody = JSON.parse(String(firstCallInit?.body)) as { tools?: unknown[] };
    expect(Array.isArray(firstBody.tools)).toBe(true);
  });
});
