import { describe, expect, it } from 'vitest';
import { hasToolCalls, toOpenAICompatibleMessage } from '../services/openAICompat.js';

describe('OpenAI-compatible message normalization', () => {
  it('omits empty tool_calls arrays', () => {
    expect(
      toOpenAICompatibleMessage({
        role: 'assistant',
        content: 'Inspecting the project',
        tool_calls: [],
      }),
    ).toEqual({ role: 'assistant', content: 'Inspecting the project' });
  });

  it('preserves non-empty tool calls and tool result IDs', () => {
    const toolCalls = [{
      id: 'call-1',
      type: 'function',
      function: { name: 'create_document', arguments: { filename: 'offer.docx' } },
    }];

    expect(
      toOpenAICompatibleMessage({
        role: 'assistant',
        content: '',
        tool_call_id: 'result-1',
        tool_calls: toolCalls,
      }),
    ).toEqual({
      role: 'assistant',
      content: '',
      tool_call_id: 'result-1',
      tool_calls: [{
        id: 'call-1',
        type: 'function',
        function: {
          name: 'create_document',
          arguments: '{"filename":"offer.docx"}',
        },
      }],
    });
    expect(hasToolCalls(toolCalls)).toBe(true);
    expect(hasToolCalls([])).toBe(false);
  });

  it('serializes object tool-result content for strict gateways', () => {
    expect(
      toOpenAICompatibleMessage({
        role: 'tool',
        content: { kind: 'generated_file', name: 'offer.docx' },
        tool_call_id: 'call-1',
      }),
    ).toEqual({
      role: 'tool',
      content: '{"kind":"generated_file","name":"offer.docx"}',
      tool_call_id: 'call-1',
    });
  });

  it('omits Authorization header when apiKey is empty', async () => {
    let capturedHeaders: HeadersInit | undefined;
    let capturedUrl: string | undefined;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = init?.headers;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'hello' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const { postChatCompletions } = await import('../services/openAICompat.js');
      await postChatCompletions({
        baseUrl: 'https://api.example.com/v1/',
        apiKey: '',
        body: { model: 'test', messages: [] },
        providerLabel: 'Custom',
      });

      expect(capturedUrl).toBe('https://api.example.com/v1/chat/completions');
      const headers = capturedHeaders as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
      expect(headers['HTTP-Referer']).toBe('https://github.com/coderaulia/vanailachat');
      expect(headers['X-Title']).toBe('VanailaChat');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('includes trimmed Authorization header when apiKey is provided', async () => {
    let capturedHeaders: HeadersInit | undefined;
    let capturedUrl: string | undefined;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = init?.headers;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'hello' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const { postChatCompletions } = await import('../services/openAICompat.js');
      await postChatCompletions({
        baseUrl: 'https://openrouter.ai/api/v1///',
        apiKey: '  sk-or-v1-testkey123  ',
        body: { model: 'anthropic/claude-3.5-sonnet', messages: [] },
        providerLabel: 'OpenRouter',
      });

      expect(capturedUrl).toBe('https://openrouter.ai/api/v1/chat/completions');
      const headers = capturedHeaders as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer sk-or-v1-testkey123');
      expect(headers['HTTP-Referer']).toBe('https://github.com/coderaulia/vanailachat');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
