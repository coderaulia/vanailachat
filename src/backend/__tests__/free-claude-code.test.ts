import { describe, expect, it } from 'vitest';
import { FreeClaudeCodeService } from '../services/freeClaudeCodeService.js';
import { ProviderRegistry } from '../services/providerRegistry.js';
import { createApp } from '../app.js';

describe('Free Claude Code (FCC) Integration Service', () => {
  it('translates Anthropic system prompt and multi-turn messages to OpenAI format', () => {
    const messages = FreeClaudeCodeService.translateAnthropicMessages(
      'You are a senior coding assistant.',
      [
        { role: 'user', content: 'What is 2+2?' },
        { role: 'assistant', content: 'It is 4.' },
        { role: 'user', content: 'Thanks!' },
      ],
    );

    expect(messages).toEqual([
      { role: 'system', content: 'You are a senior coding assistant.' },
      { role: 'user', content: 'What is 2+2?' },
      { role: 'assistant', content: 'It is 4.' },
      { role: 'user', content: 'Thanks!' },
    ]);
  });

  it('translates Anthropic tool_use and tool_result blocks to OpenAI format', () => {
    const messages = FreeClaudeCodeService.translateAnthropicMessages(
      undefined,
      [
        { role: 'user', content: 'Read file package.json' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me read that for you.' },
            {
              type: 'tool_use',
              id: 'toolu_123',
              name: 'read_file',
              input: { path: 'package.json' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_123',
              content: '{"name": "vanaila-chat"}',
            },
          ],
        },
      ],
    );

    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ role: 'user', content: 'Read file package.json' });
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: 'Let me read that for you.',
      tool_calls: [
        {
          id: 'toolu_123',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: { path: 'package.json' },
          },
        },
      ],
    });
    expect(messages[2]).toEqual({
      role: 'tool',
      content: '{"name": "vanaila-chat"}',
      tool_call_id: 'toolu_123',
    });
  });

  it('translates Anthropic tool definitions to OpenAI format', () => {
    const tools = FreeClaudeCodeService.translateAnthropicTools([
      {
        name: 'grep_search',
        description: 'Search pattern in directory',
        input_schema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    ]);

    expect(tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'grep_search',
          description: 'Search pattern in directory',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      },
    ]);
  });

  it('converts provider stream into Anthropic SSE events', async () => {
    const mockProviderStream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              choices: [{ delta: { content: 'Hello from FCC!' } }],
            }) + '\n',
          ),
        );
        controller.close();
      },
    });

    const providerResponse = new Response(mockProviderStream);
    const anthropicResponse = FreeClaudeCodeService.createAnthropicStream(
      providerResponse,
      'test-model',
    );

    expect(anthropicResponse.headers.get('Content-Type')).toBe('text/event-stream');
    expect(anthropicResponse.headers.get('x-fcc-source')).toBe(
      'https://github.com/alishahryar1/free-claude-code',
    );

    const sseText = await anthropicResponse.text();
    expect(sseText).toContain('event: message_start');
    expect(sseText).toContain('event: content_block_start');
    expect(sseText).toContain('event: content_block_delta');
    expect(sseText).toContain('Hello from FCC!');
    expect(sseText).toContain('event: message_stop');
  });

  it('serves status and models via /api/fcc routes', async () => {
    const registry = new ProviderRegistry();
    registry.register({
      id: 'openrouter',
      label: 'OpenRouter',
      listModels: async () => ['anthropic/claude-3.5-sonnet'],
      getModelDetails: async () => null,
      isModelAvailable: async () => true,
      chatStream: async () => new Response(),
      chat: async () => ({}),
    });

    const app = createApp({
      providerRegistry: registry,
      getInstalledModelMetadata: async () => [],
    });

    const statusRes = await app.request('/api/fcc/status');
    expect(statusRes.status).toBe(200);
    const statusBody = (await statusRes.json()) as { engine: string; source: string };
    expect(statusBody.engine).toContain('Free Claude Code');
    expect(statusBody.source).toBe('https://github.com/alishahryar1/free-claude-code');

    const modelsRes = await app.request('/api/fcc/v1/models');
    expect(modelsRes.status).toBe(200);
    const modelsBody = (await modelsRes.json()) as { data: Array<{ id: string }> };
    expect(modelsBody.data.some((m) => m.id === 'openrouter:anthropic/claude-3.5-sonnet')).toBe(true);
  });
});
