import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createApp } from '../app.js';
import { providerSupportsTools } from '../routes/chat.js';
import { OllamaService } from '../services/ollama.js';
import { ApprovalService, describeToolCall, isMutatingTool, normalizeApprovalDetails } from '../services/approvals.js';

/** Upstream that asks for a tool call on the first turn, then answers. */
function toolCallingProvider(tool: string, args: Record<string, unknown>) {
  let turn = 0;
  return vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    turn += 1;
    if (turn === 2) {
      const request = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; tool_call_id?: string }>;
      };
      const toolResult = request.messages.find((message) => message.role === 'tool');
      expect(toolResult?.tool_call_id).toBe('c1');
    }
    const body =
      turn === 1
        ? [
            JSON.stringify({
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [{ id: 'c1', type: 'function', function: { name: tool, arguments: args } }],
              },
            }),
            JSON.stringify({ done: true }),
          ]
        : [
            JSON.stringify({ message: { role: 'assistant', content: 'done' } }),
            JSON.stringify({ done: true }),
          ];

    return new Response(body.join('\n') + '\n', {
      status: 200,
      headers: { 'Content-Type': 'application/x-ndjson' },
    });
  });
}



function appWith(overrides: Record<string, unknown> = {}) {
  return createApp({
    getBaseUrl: () => 'http://ollama.local',
    getInstalledModels: async () => ['llama3'],
    getModelDetails: async () => ({ capabilities: ['chat', 'tools'] }),
    listEnabledSkills: () => [],
    getSetting: () => null,
    embedOrNull: async () => null,
    searchMemoriesByKeyword: () => [],
    upsertMemory: vi.fn() as never,
    ...overrides,
  });
}

function chatRequest(app: ReturnType<typeof createApp>, projectRoot?: string) {
  return app.request('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama3',
      ...(projectRoot ? { projectRoot } : {}),
      messages: [{ role: 'user', content: 'update the config' }],
      stream: true,
    }),
  });
}

describe('approval helpers', () => {
  it('offers tools to OpenAI-compatible providers without capability metadata', () => {
    expect(providerSupportsTools('custom', [])).toBe(true);
    expect(providerSupportsTools('9router', [])).toBe(true);
    expect(providerSupportsTools('ollama', [])).toBe(false);
  });

  it('gates only the tools that change state', () => {
    expect(isMutatingTool('write_file')).toBe(true);
    expect(isMutatingTool('edit_file')).toBe(true);
    expect(isMutatingTool('run_command')).toBe(true);
    expect(isMutatingTool('read_file')).toBe(false);
    expect(isMutatingTool('search_web')).toBe(false);
  });

  it('summarises a call for the prompt', () => {
    expect(describeToolCall('write_file', { path: 'a.ts', content: 'xy' })).toBe('Write a.ts (2 bytes)');
    expect(describeToolCall('run_command', { command: 'git', args: ['diff'] })).toBe('Run git diff');
  });

  it('normalizes approval details for Claude Code and Agent tools', () => {
    const bashNorm = normalizeApprovalDetails('Bash', { command: 'npm test' });
    expect(bashNorm.category).toBe('command');
    expect(bashNorm.command).toBe('npm test');

    const writeNorm = normalizeApprovalDetails('Write', { file_path: 'src/index.ts', content: 'console.log("hello");' });
    expect(writeNorm.category).toBe('file_write');
    expect(writeNorm.path).toBe('src/index.ts');
    expect(writeNorm.content).toBe('console.log("hello");');

    const editNorm = normalizeApprovalDetails('Edit', {
      file_path: 'src/config.ts',
      old_string: 'const port = 3000;',
      new_string: 'const port = 8080;',
    });
    expect(editNorm.category).toBe('file_edit');
    expect(editNorm.path).toBe('src/config.ts');
    expect(editNorm.old_string).toBe('const port = 3000;');
    expect(editNorm.new_string).toBe('const port = 8080;');
  });
});

describe('ApprovalService', () => {
  afterEach(() => ApprovalService.clear());

  it('resolves when answered', async () => {
    const promise = ApprovalService.request('a1');
    expect(ApprovalService.resolve('a1', true)).toBe(true);
    await expect(promise).resolves.toBe(true);
  });

  it('denies rather than approves on timeout', async () => {
    vi.useFakeTimers();
    try {
      const promise = ApprovalService.request('a2', 1000);
      vi.advanceTimersByTime(1001);
      await expect(promise).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports an unknown id rather than throwing', () => {
    expect(ApprovalService.resolve('never-existed', true)).toBe(false);
  });
});

describe('approval gate in the agent loop', () => {
  beforeEach(() => {
    vi.spyOn(OllamaService, 'getInstalledModels').mockResolvedValue(['llama3']);
  });
  afterEach(() => ApprovalService.clear());

  it('does not run a write until the user allows it', async () => {
    const executeTool = vi.fn().mockResolvedValue('written');
    const app = appWith({
      fetchFn: toolCallingProvider('write_file', { path: 'a.ts', content: 'hello' }),
      executeTool: executeTool as never,
    });

    const response = await chatRequest(app);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    let approvalId: string | null = null;

    // Read until the approval request appears — the loop is parked here.
    while (!approvalId) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const match = buffered.match(/"approval_request":\{"id":"([^"]+)"/);
      if (match) approvalId = match[1];
    }

    expect(approvalId).toBeTruthy();
    expect(buffered).toContain('Write a.ts (5 bytes)');
    // Nothing has touched the disk yet.
    expect(executeTool).not.toHaveBeenCalled();

    const approve = await app.request('/api/chat/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: approvalId, approved: true }),
    });
    expect(await approve.json()).toEqual({ settled: true });

    // Drain so the loop finishes.
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    expect(executeTool).toHaveBeenCalledWith('write_file', { path: 'a.ts', content: 'hello' }, null);
  });

  it('skips the call and tells the model when declined', async () => {
    const executeTool = vi.fn().mockResolvedValue('written');
    const app = appWith({
      fetchFn: toolCallingProvider('write_file', { path: 'a.ts', content: 'hello' }),
      executeTool: executeTool as never,
    });

    const response = await chatRequest(app);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    let approvalId: string | null = null;

    while (!approvalId) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const match = buffered.match(/"approval_request":\{"id":"([^"]+)"/);
      if (match) approvalId = match[1];
    }

    await app.request('/api/chat/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: approvalId, approved: false }),
    });

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
    }

    expect(executeTool).not.toHaveBeenCalled();
    expect(buffered).toContain('"approved":false');
  });

  it('runs read-only tools without prompting', async () => {
    const executeTool = vi.fn().mockResolvedValue('file contents');
    const app = appWith({
      fetchFn: toolCallingProvider('read_file', { path: 'a.ts' }),
      executeTool: executeTool as never,
    });

    const response = await chatRequest(app);
    const text = await response.text();

    expect(text).not.toContain('approval_request');
    expect(executeTool).toHaveBeenCalledWith('read_file', { path: 'a.ts' }, null);
  });

  it('streams a generated document link even if the model does not repeat it', async () => {
    const descriptor = {
      kind: 'generated_file',
      name: 'offer-letter.docx',
      url: '/api/attachments/generated/token--offer-letter.docx',
      bytes: 1234,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    const executeTool = vi.fn().mockResolvedValue(JSON.stringify(descriptor));
    const app = appWith({
      fetchFn: toolCallingProvider('create_document', {
        filename: 'offer-letter.docx',
        content: 'Welcome',
      }),
      executeTool: executeTool as never,
    });

    const responseText = await (await chatRequest(app)).text();

    expect(responseText).toContain('"generated_file"');
    expect(responseText).toContain(descriptor.url);
    expect(executeTool).toHaveBeenCalledWith(
      'create_document',
      { filename: 'offer-letter.docx', content: 'Welcome' },
      null,
    );
  });

  it('uses the requested project root on the first message of a new chat', async () => {
    const executeTool = vi.fn().mockResolvedValue('file contents');
    const app = appWith({
      fetchFn: toolCallingProvider('read_file', { path: 'a.ts' }),
      executeTool: executeTool as never,
    });

    await (await chatRequest(app, 'C:\\work\\example')).text();

    expect(executeTool).toHaveBeenCalledWith('read_file', { path: 'a.ts' }, 'C:\\work\\example');
  });



  it('honours require_tool_approval=false', async () => {
    const executeTool = vi.fn().mockResolvedValue('written');
    const app = appWith({
      fetchFn: toolCallingProvider('write_file', { path: 'a.ts', content: 'hello' }),
      executeTool: executeTool as never,
      getSetting: (key: string) => (key === 'require_tool_approval' ? 'false' : null),
    });

    const response = await chatRequest(app);
    const text = await response.text();

    expect(text).not.toContain('approval_request');
    expect(executeTool).toHaveBeenCalled();
  });

  it('rejects a malformed approval payload', async () => {
    const app = appWith({ fetchFn: vi.fn<typeof fetch>() });
    const response = await app.request('/api/chat/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 123 }),
    });

    expect(response.status).toBe(400);
  });
});
