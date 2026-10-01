// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: { payload: unknown }) => void;

/** Loads lib/api as the desktop app sees it, with the Tauri bridge replaced by fakes. */
async function loadDesktopApi() {
  vi.resetModules();
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};

  const handlers: Handler[] = [];
  const unlisten = vi.fn();
  const invoke = vi.fn();
  vi.doMock('@tauri-apps/api/core', () => ({ invoke }));
  vi.doMock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async (_name: string, handler: Handler) => {
      handlers.push(handler);
      return unlisten;
    }),
  }));

  const api = await import('../lib/api');
  const emit = (payload: unknown) => handlers.forEach((handler) => handler({ payload }));
  return { api, invoke, emit, unlisten, handlers };
}

describe('desktop chat streaming', () => {
  beforeEach(() => {
    vi.doUnmock('@tauri-apps/api/core');
    vi.doUnmock('@tauri-apps/api/event');
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.resetModules();
  });

  it('keeps listening until the reply is complete, then stops', async () => {
    const { api, invoke, emit, unlisten } = await loadDesktopApi();
    const received: unknown[] = [];
    let finish!: () => void;
    invoke.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));

    const done = api.streamChatCompletion({ chatId: 'c1', model: 'llama3', messages: [{ role: 'user', content: 'hi' }] }, (chunk) => received.push(chunk));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());

    // The old command returned as soon as it spawned the stream, so these were lost.
    emit({ chat_id: 'c1', message: { role: 'assistant', content: 'Hel' } });
    emit({ chat_id: 'c1', message: { role: 'assistant', content: 'lo' } });
    expect(unlisten).not.toHaveBeenCalled();

    finish();
    await done;
    expect(received).toHaveLength(2);
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it('ignores events from other chats', async () => {
    const { api, invoke, emit } = await loadDesktopApi();
    const received: Array<{ chat_id?: string }> = [];
    let finish!: () => void;
    invoke.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));

    const done = api.streamChatCompletion({ chatId: 'mine', messages: [{ role: 'user', content: 'x' }] }, (chunk) => received.push(chunk));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
    emit({ chat_id: 'other', message: { role: 'assistant', content: 'not for me' } });
    emit({ chat_id: 'mine', message: { role: 'assistant', content: 'for me' } });
    emit({ message: { role: 'assistant', content: 'untagged' } });
    finish();
    await done;

    expect(received.map((c) => c.chat_id)).toEqual(['mine', undefined]);
  });

  it('sends images separately from text and renames the prompt fields', async () => {
    const { api, invoke } = await loadDesktopApi();
    invoke.mockResolvedValue(undefined);
    await api.streamChatCompletion({
      chatId: 'c1',
      systemPrompt: 'sys',
      maxTokens: 50,
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: 'what is this?' } as never, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } } as never],
      }],
    }, () => {});

    const [command, args] = invoke.mock.calls[0];
    expect(command).toBe('start_chat');
    expect(args.request.messages[0]).toEqual({ role: 'user', content: 'what is this?', images: ['data:image/png;base64,AAAA'] });
    expect(args.request.system_prompt).toBe('sys');
    expect(args.request.max_tokens).toBe(50);
    expect(args.request.chatId).toBe('c1');
  });

  it('turns a rejected command into an Error with its message', async () => {
    const { api, invoke } = await loadDesktopApi();
    invoke.mockRejectedValue('Provider error: Incorrect API key');
    await expect(api.streamChatCompletion({ chatId: 'c1', messages: [{ role: 'user', content: 'x' }] }, () => {})).rejects.toThrow('Incorrect API key');
  });

  it('cancels only its own chat and does not report an abort as a failure', async () => {
    const { api, invoke } = await loadDesktopApi();
    const controller = new AbortController();
    // The backend ends the stream with an error only once it is told to cancel.
    let rejectStream!: (reason: string) => void;
    invoke.mockImplementation((command: string) => {
      if (command === 'start_chat') {
        return new Promise((_, reject) => { rejectStream = reject; });
      }
      rejectStream('Stream cancelled');
      return Promise.resolve();
    });

    const done = api.streamChatCompletion({ chatId: 'c9', messages: [{ role: 'user', content: 'x' }] }, () => {}, controller.signal);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('start_chat', expect.anything()));
    controller.abort();
    await expect(done).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith('cancel_chat', { chatId: 'c9' });
  });
});

describe('desktop commands behind the shared API', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.resetModules();
  });

  it('runs a one-shot completion without profile or memory', async () => {
    const { api, invoke } = await loadDesktopApi();
    invoke.mockResolvedValue('Garden Planning Tips');
    expect(await api.apiChatOnce('llama3', 'Title please')).toBe('Garden Planning Tips');
    expect(invoke).toHaveBeenCalledWith('chat_once', { request: { model: 'llama3', messages: [{ role: 'user', content: 'Title please' }], skip_memory: true } });

    invoke.mockRejectedValue('offline');
    expect(await api.apiChatOnce('llama3', 'x')).toBeNull();
  });

  it('manages skills through their commands and surfaces install errors', async () => {
    const { api, invoke } = await loadDesktopApi();
    invoke.mockResolvedValue(undefined);
    await api.apiInstallSkill('frontend-design');
    await api.apiSetSkillEnabled('skill_1', false);
    await api.apiDeleteSkill('skill_1');
    await api.apiInstallCustomSkill('---\nname: x\n---\nbody');
    expect(invoke.mock.calls.map(([name]) => name)).toEqual(['install_catalog_skill', 'set_skill_enabled', 'delete_skill', 'install_custom_skill']);
    expect(invoke).toHaveBeenCalledWith('set_skill_enabled', { id: 'skill_1', enabled: false });

    invoke.mockRejectedValue('Invalid request: SKILL.md must have a `name`');
    await expect(api.apiInstallCustomSkill('nope')).rejects.toThrow('must have a `name`');
  });

  it('manages memories through their commands', async () => {
    const { api, invoke } = await loadDesktopApi();
    invoke.mockResolvedValue([]);
    await api.apiFetchMemories();
    invoke.mockResolvedValue({ id: 'm1', type: 'manual', content: 'x', embedding: '', metadata: null, sourceId: null, createdAt: 1 });
    await api.apiAddMemory('I like tabs');
    await api.apiDeleteMemory('m1');
    await api.apiClearMemories();
    expect(invoke.mock.calls.map(([name]) => name)).toEqual(['get_memories', 'add_memory', 'delete_memory', 'clear_memories']);
    expect(invoke).toHaveBeenCalledWith('add_memory', { payload: { content: 'I like tabs', type: 'manual' } });
  });

  it('streams research stages for its own run and cancels it by id', async () => {
    const { api, invoke, emit } = await loadDesktopApi();
    const stages: string[] = [];
    const controller = new AbortController();
    let finish!: () => void;
    invoke.mockImplementation((command: string) => (command === 'start_research' ? new Promise<void>((resolve) => { finish = resolve; }) : Promise.resolve()));

    const done = api.streamResearch({ query: 'sky', model: 'llama3', maxSources: 3, depth: 'quick', researchId: 'r1' }, (e) => stages.push(String(e.stage)), controller.signal);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('start_research', expect.anything()));
    expect(invoke).toHaveBeenCalledWith('start_research', { request: { query: 'sky', model: 'llama3', max_sources: 3, depth: 'quick', research_id: 'r1' } });

    emit({ chat_id: 'r1', stage: 'searching' });
    emit({ chat_id: 'someone-else', stage: 'chunk' });
    emit({ chat_id: 'r1', stage: 'done' });
    controller.abort();
    expect(invoke).toHaveBeenCalledWith('cancel_chat', { chatId: 'r1' });
    finish();
    await done;
    expect(stages).toEqual(['searching', 'done']);
  });

  it('runs and records an A/B comparison through its commands', async () => {
    const { api, invoke } = await loadDesktopApi();
    invoke.mockResolvedValue({ a: { model: 'x', content: 'A', latencyMs: 1 }, b: { model: 'y', content: 'B', latencyMs: 2 } });
    const request = { prompt: 'p', modelA: 'x', modelB: 'y' };
    expect((await api.apiRunAb(request)).b.content).toBe('B');
    expect(invoke).toHaveBeenCalledWith('run_ab', { request });

    invoke.mockResolvedValue({ chatId: 'c', messageId: 'm' });
    const pick = { userContent: 'p', winnerContent: 'A', winnerModel: 'x' };
    expect(await api.apiPickAb(pick)).toEqual({ chatId: 'c', messageId: 'm' });
    expect(invoke).toHaveBeenCalledWith('pick_ab', { pick });

    invoke.mockRejectedValue('Invalid request: prompt: required string');
    await expect(api.apiRunAb(request)).rejects.toThrow('prompt: required string');
  });

  it('sends attachments as raw bytes with the name in a header, and browses folders', async () => {
    const { api, invoke } = await loadDesktopApi();
    invoke.mockResolvedValue({ name: 'Q3 plan.docx', text: 'hello' });
    const file = new File([new Uint8Array([1, 2, 3])], 'Q3 plan.docx', { type: '' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1, 2, 3]).buffer });
    expect((await api.apiExtractAttachment(file)).text).toBe('hello');
    const [command, bytes, options] = invoke.mock.calls[0];
    expect(command).toBe('extract_attachment');
    expect(Array.from(bytes as Uint8Array)).toEqual([1, 2, 3]);
    expect(options.headers['x-file-name']).toBe('Q3%20plan.docx');

    invoke.mockResolvedValue({ path: '/home/me', parent: '/home', directories: [], drives: ['/'], home: '/home/me' });
    await api.apiBrowseDirectory();
    await api.apiBrowseDirectory('/tmp');
    expect(invoke).toHaveBeenCalledWith('browse_directory', { path: null });
    expect(invoke).toHaveBeenCalledWith('browse_directory', { path: '/tmp' });
  });

  it('runs a coding turn as a chat stream with history, and surfaces its failure', async () => {
    const { api, invoke, emit } = await loadDesktopApi();
    const received: Array<Record<string, unknown>> = [];
    let finish!: () => void;
    invoke.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));

    const done = api.runNativeCoding(
      { chatId: 'code1', prompt: 'add a flag', model: 'qwen3', history: [{ role: 'user', content: 'hi' }] },
      (chunk) => received.push(chunk as Record<string, unknown>),
    );
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(invoke).toHaveBeenCalledWith('run_coding', { request: { chat_id: 'code1', prompt: 'add a flag', model: 'qwen3', history: [{ role: 'user', content: 'hi' }] } });

    emit({ chat_id: 'code1', approval_request: { id: 'a1', tool: 'write_file', summary: 'Write x' } });
    emit({ chat_id: 'other', message: { role: 'assistant', content: 'not mine' } });
    emit({ chat_id: 'code1', tool_event: true, tool: 'write_file', status: 'done' });
    finish();
    await done;
    expect(received.map((c) => Object.keys(c).filter((k) => k !== 'chat_id')[0])).toEqual(['approval_request', 'tool_event']);

    invoke.mockRejectedValue('Invalid request: Create a coding workspace first');
    await expect(api.runNativeCoding({ chatId: 'code1', prompt: 'x', model: 'm' }, () => {})).rejects.toThrow('Create a coding workspace first');
  });
});
