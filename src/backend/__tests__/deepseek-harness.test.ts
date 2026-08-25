import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { DeepseekHarness } from '../services/deepseekHarness.js';
import { DatabaseService } from '../services/database.js';
import { ToolService } from '../services/tools.js';
import { ApprovalService } from '../services/approvals.js';
import type { CodingEvent } from '../services/codingHarness.js';

function createSSEStream(dataChunks: Array<Record<string, unknown> | string>) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of dataChunks) {
        if (typeof chunk === 'string') {
          controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
        } else {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        }
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

describe('DeepSeek Harness (deepseek-ai/deepseek-harness)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    ApprovalService.clear();
  });

  afterEach(() => {
    ApprovalService.clear();
  });

  it('reports available status with DeepSeek Harness label', async () => {
    const harness = new DeepseekHarness();
    const status = await harness.status();

    expect(status.id).toBe('deepseek-harness');
    expect(status.available).toBe(true);
    expect(status.label).toContain('DeepSeek Harness');
  });

  it('automatically uses OpenRouter provider when openrouter_api_key is set', async () => {
    const harness = new DeepseekHarness();
    vi.spyOn(DatabaseService, 'getSetting').mockImplementation((key: string) => {
      if (key === 'openrouter_api_key') return 'sk-or-v1-openrouter-key';
      return null;
    });

    const status = await harness.status();
    expect(status.label).toContain('OpenRouter');

    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: Record<string, unknown> = {};

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
        capturedBody = JSON.parse(String(init?.body ?? '{}'));
        return new Response(createSSEStream([{ choices: [{ delta: { content: 'Working via OpenRouter!' } }] }]), { status: 200 });
      }),
    );

    const controller = new AbortController();
    const events: CodingEvent[] = [];

    for await (const event of harness.run({
      prompt: 'Refactor helper',
      cwd: process.cwd(),
      mode: 'implement',
      signal: controller.signal,
    })) {
      events.push(event);
    }

    expect(capturedUrl).toContain('openrouter.ai');
    expect(capturedHeaders['Authorization']).toBe('Bearer sk-or-v1-openrouter-key');
    expect(capturedBody['model']).toContain('deepseek');
    expect(events.some((e) => e.type === 'text' && e.text.includes('Working via OpenRouter'))).toBe(true);
  });

  it('runs autonomous agent loop and streams text and usage events', async () => {
    const harness = new DeepseekHarness();
    vi.spyOn(DatabaseService, 'getSetting').mockImplementation((key: string) => {
      if (key === 'deepseek_api_key') return 'sk-test-deepseek-key';
      return null;
    });

    const sseChunks = [
      {
        choices: [
          {
            delta: { content: 'I am analyzing the repository with DeepSeek Harness.' },
          },
        ],
      },
      {
        usage: {
          prompt_tokens: 15,
          completion_tokens: 10,
          total_tokens: 25,
        },
      },
    ];

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(createSSEStream(sseChunks), { status: 200 })),
    );

    const controller = new AbortController();
    const events: CodingEvent[] = [];

    for await (const event of harness.run({
      prompt: 'Check codebase structure',
      cwd: process.cwd(),
      mode: 'implement',
      signal: controller.signal,
    })) {
      events.push(event);
    }

    expect(events.some((e) => e.type === 'session')).toBe(true);
    expect(events.some((e) => e.type === 'text' && e.text.includes('DeepSeek Harness'))).toBe(true);
    expect(events.some((e) => e.type === 'usage')).toBe(true);
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });

  it('executes read-only tools automatically without requiring approval', async () => {
    const harness = new DeepseekHarness();
    vi.spyOn(DatabaseService, 'getSetting').mockImplementation((key: string) => {
      if (key === 'deepseek_api_key') return 'sk-test-key';
      return null;
    });

    vi.spyOn(ToolService, 'executeTool').mockResolvedValue('file content: hello world');

    const firstTurnSSE = [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_read_1',
                  type: 'function',
                  function: {
                    name: 'read_file',
                    arguments: '{"path":"README.md"}',
                  },
                },
              ],
            },
          },
        ],
      },
    ];

    const secondTurnSSE = [
      {
        choices: [
          {
            delta: { content: 'The README contains hello world.' },
          },
        ],
      },
    ];

    let fetchCall = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        fetchCall++;
        if (fetchCall === 1) {
          return new Response(createSSEStream(firstTurnSSE), { status: 200 });
        }
        return new Response(createSSEStream(secondTurnSSE), { status: 200 });
      }),
    );

    const controller = new AbortController();
    const events: CodingEvent[] = [];

    for await (const event of harness.run({
      prompt: 'Read the README',
      cwd: process.cwd(),
      mode: 'implement',
      signal: controller.signal,
    })) {
      events.push(event);
    }

    expect(events.some((e) => e.type === 'tool' && e.name === 'read_file' && e.status === 'done')).toBe(true);
    expect(events.some((e) => e.type === 'text' && e.text.includes('README contains hello world'))).toBe(true);
    expect(ToolService.executeTool).toHaveBeenCalledWith('read_file', { path: 'README.md' }, process.cwd());
  });

  it('requests tool approval for mutating tools when confirmation is required', async () => {
    const harness = new DeepseekHarness();
    vi.spyOn(DatabaseService, 'getSetting').mockImplementation((key: string) => {
      if (key === 'deepseek_api_key') return 'sk-test-key';
      if (key === 'require_tool_approval') return 'true';
      return null;
    });

    vi.spyOn(ToolService, 'executeTool').mockResolvedValue('File written successfully');

    const firstTurnSSE = [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_write_1',
                  type: 'function',
                  function: {
                    name: 'write_file',
                    arguments: '{"path":"test.txt","content":"hello"}',
                  },
                },
              ],
            },
          },
        ],
      },
    ];

    const secondTurnSSE = [
      {
        choices: [
          {
            delta: { content: 'File has been created.' },
          },
        ],
      },
    ];

    let fetchCall = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        fetchCall++;
        if (fetchCall === 1) {
          return new Response(createSSEStream(firstTurnSSE), { status: 200 });
        }
        return new Response(createSSEStream(secondTurnSSE), { status: 200 });
      }),
    );

    const controller = new AbortController();
    const events: CodingEvent[] = [];
    let approvalRequested = false;

    for await (const event of harness.run({
      prompt: 'Create test.txt',
      cwd: process.cwd(),
      mode: 'implement',
      signal: controller.signal,
      onApproval: (appr) => {
        approvalRequested = true;
        expect(appr.tool).toBe('write_file');
        // Simulate user clicking "Approve" asynchronously
        setTimeout(() => ApprovalService.resolve(appr.id, true), 0);
      },
    })) {
      events.push(event);
    }

    expect(approvalRequested).toBe(true);
    expect(events.some((e) => e.type === 'tool' && e.name === 'write_file' && e.status === 'start')).toBe(true);
    expect(events.some((e) => e.type === 'tool' && e.name === 'write_file' && e.status === 'done')).toBe(true);
    expect(ToolService.executeTool).toHaveBeenCalledWith(
      'write_file',
      { path: 'test.txt', content: 'hello' },
      process.cwd(),
    );
  });
});
