import { describe, expect, it, vi } from 'vitest';
import { openAIStreamToNDJSON } from '../services/streamAdapter.js';
import { CustomOpenAIProvider } from '../services/customOpenAIProvider.js';

function sseResponse(chunks: string[]): Response {
  return new Response(chunks.map((c) => `data: ${c}\n\n`).join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

async function readLines(response: Response): Promise<Array<Record<string, unknown>>> {
  const text = await response.text();
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('openAIStreamToNDJSON', () => {
  it('translates the trailing usage chunk into Ollama token fields', async () => {
    const upstream = sseResponse([
      JSON.stringify({ model: 'deepseek-chat', choices: [{ delta: { content: 'hi' } }] }),
      JSON.stringify({ model: 'deepseek-chat', choices: [{ delta: {}, finish_reason: 'stop' }] }),
      // Usage arrives with an empty choices array.
      JSON.stringify({
        model: 'deepseek-chat',
        choices: [],
        usage: { prompt_tokens: 1234, completion_tokens: 56, total_tokens: 1290 },
      }),
      '[DONE]',
    ]);

    const lines = await readLines(openAIStreamToNDJSON(upstream, 'deepseek-chat'));
    const final = lines[lines.length - 1];

    expect(final.done).toBe(true);
    expect(final.prompt_eval_count).toBe(1234);
    expect(final.eval_count).toBe(56);
    expect(final.usage).toEqual({ prompt_tokens: 1234, completion_tokens: 56, total_tokens: 1290 });
  });

  it('still terminates when the provider reports no usage', async () => {
    const upstream = sseResponse([
      JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }),
      '[DONE]',
    ]);

    const lines = await readLines(openAIStreamToNDJSON(upstream, 'm'));
    const final = lines[lines.length - 1];

    expect(final.done).toBe(true);
    expect(final.prompt_eval_count).toBeUndefined();
  });

  it('emits tool calls when finish_reason is tool_calls, not just stop', async () => {
    const upstream = sseResponse([
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":' } },
              ],
            },
          },
        ],
      }),
      JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"a.txt"}' } }] } }],
      }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      '[DONE]',
    ]);

    const lines = await readLines(openAIStreamToNDJSON(upstream, 'm'));
    const withToolCalls = lines.find((l) => (l.message as { tool_calls?: unknown })?.tool_calls);

    expect(withToolCalls).toBeDefined();
    const toolCalls = (withToolCalls!.message as { tool_calls: Array<{ function: { name: string; arguments: unknown } }> })
      .tool_calls;
    expect(toolCalls[0].function.name).toBe('read_file');
    expect(toolCalls[0].function.arguments).toEqual({ path: 'a.txt' });
  });
});

describe('OpenAI-compatible request', () => {
  it('asks for usage on streaming calls', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(sseResponse(['[DONE]']));
    vi.stubGlobal('fetch', fetchMock);

    try {
      const provider = new CustomOpenAIProvider();
      await provider.chatStream({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] });

      const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as {
        stream_options?: { include_usage?: boolean };
      };
      expect(body.stream_options).toEqual({ include_usage: true });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('retries without stream_options when the gateway rejects it', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('unknown field stream_options', { status: 400 }))
      .mockResolvedValueOnce(sseResponse(['[DONE]']));
    vi.stubGlobal('fetch', fetchMock);

    try {
      const provider = new CustomOpenAIProvider();
      await provider.chatStream({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const retryBody = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body)) as {
        stream_options?: unknown;
      };
      expect(retryBody.stream_options).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
