/* @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSendMessage, type SendMessageDeps } from '../hooks/useSendMessage';
import type { Message } from '../types/chat';

function ndjsonBody(lines: string[]) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    getReader: () => ({
      read: async () => {
        if (index >= lines.length) return { done: true, value: undefined };
        return { done: false, value: encoder.encode(lines[index++] + '\n') };
      },
    }),
  };
}

function makeDeps(overrides: Partial<SendMessageDeps> = {}): SendMessageDeps {
  return {
    selectedModel: 'custom:deepseek-v4-flash',
    selectedRole: 'coding' as SendMessageDeps['selectedRole'],
    selectedProjectId: 'proj_1',
    projects: [],
    chatHistories: {},
    prompt: 'add a health check endpoint',
    setPrompt: vi.fn(),
    attachedFiles: [],
    setAttachedFiles: vi.fn(),
    conversation: [] as Message[],
    setConversation: vi.fn(),
    systemPrompt: '',
    projectRoot: 'C:\\work\\example',
    isSearchEnabled: false,
    currentChatId: 'chat_1',
    setCurrentChatId: vi.fn(),
    currentChatIdRef: { current: 'chat_1' },
    abortRef: { current: null },
    activeRequestIdRef: { current: null },
    setSendingChatIds: vi.fn(),
    setContextWindow: vi.fn(),
    setStatusText: vi.fn(),
    setPendingApproval: vi.fn(),
    updateHistories: vi.fn(),
    saveMessage: vi.fn().mockResolvedValue(undefined),
    upsertChat: vi.fn().mockResolvedValue(undefined),
    patchChat: vi.fn().mockResolvedValue({}),
    ...overrides,
  } as SendMessageDeps;
}

/** Routes /api/coding/* and /api/chat to separate stubs. */
function stubFetch(codingLines: string[]) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    calls.push(String(url));
    if (String(url).includes('/api/coding/sessions')) {
      return { ok: true, json: async () => ({ session: {} }) };
    }
    if (String(url).includes('/api/coding/run')) {
      return { ok: true, body: ndjsonBody(codingLines) };
    }
    return { ok: true, body: ndjsonBody(['{"done":true}']), json: async () => ({}), text: async () => '' };
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

describe('coding role routes through the coding harness', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('opens a workspace session and runs against it, not /api/chat', async () => {
    const { fetchMock, calls } = stubFetch(['{"coding_event":{"type":"text","text":"Done."}}']);
    const { result } = renderHook(() => useSendMessage(makeDeps()));

    await result.current.handleSend();

    expect(calls.some(u => u.includes('/api/coding/sessions'))).toBe(true);
    expect(calls.some(u => u.includes('/api/coding/run'))).toBe(true);
    expect(calls.some(u => u.includes('/api/chat') && !u.includes('coding'))).toBe(false);

    const runCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/coding/run'))!;
    const body = JSON.parse(String((runCall[1] as RequestInit).body));
    expect(body).toMatchObject({ chatId: 'chat_1', prompt: 'add a health check endpoint' });
  });

  it('streams harness text into the assistant message in the chat', async () => {
    stubFetch([
      '{"coding_event":{"type":"text","text":"Reading the router. "}}',
      '{"coding_event":{"type":"tool","name":"Read"}}',
      '{"coding_event":{"type":"text","text":"Added the endpoint."}}',
    ]);
    const setConversation = vi.fn();
    const saveMessage = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useSendMessage(makeDeps({ setConversation, saveMessage })));

    await result.current.handleSend();

    // The persisted reply is the harness prose, assembled in order.
    const saved = saveMessage.mock.calls.map(([, message]) => message as Message);
    const assistant = saved.find(m => m.role === 'assistant');
    expect(assistant?.content).toBe('Reading the router. Added the endpoint.');
  });

  it('surfaces a harness error in the transcript instead of failing silently', async () => {
    stubFetch(['{"error":"Pi Harness is not configured"}']);
    const saveMessage = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useSendMessage(makeDeps({ saveMessage })));

    await result.current.handleSend();

    const assistant = saveMessage.mock.calls
      .map(([, message]) => message as Message)
      .find(m => m.role === 'assistant');
    expect(assistant?.content).toContain('Pi Harness is not configured');
  });

  it('falls back to normal chat when no workspace folder is chosen', async () => {
    const { calls } = stubFetch([]);
    const { result } = renderHook(() => useSendMessage(makeDeps({ projectRoot: '   ' })));

    await result.current.handleSend();

    expect(calls.some(u => u.includes('/api/coding/run'))).toBe(false);
    expect(calls.some(u => u.includes('/api/chat'))).toBe(true);
  });

  it('leaves other roles on the normal chat path', async () => {
    const { calls } = stubFetch([]);
    const { result } = renderHook(() =>
      useSendMessage(makeDeps({ selectedRole: 'general' as SendMessageDeps['selectedRole'] })),
    );

    await result.current.handleSend();

    expect(calls.some(u => u.includes('/api/coding/run'))).toBe(false);
    expect(calls.some(u => u.includes('/api/chat'))).toBe(true);
  });

  it('tracks live tool activities and saves them on the assistant message', async () => {
    stubFetch([
      '{"coding_event":{"type":"text","text":"Modifying files..."}}',
      '{"coding_event":{"type":"tool","id":"t1","name":"Edit","category":"file_edit","file":"src/server.ts","status":"done"}}',
      '{"coding_event":{"type":"tool","id":"t2","name":"Bash","category":"command","command":"npm test","status":"done"}}',
      '{"coding_event":{"type":"text","text":" All tests passed."}}',
    ]);
    const saveMessage = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useSendMessage(makeDeps({ saveMessage })));

    await result.current.handleSend();

    const saved = saveMessage.mock.calls.map(([, message]) => message as Message);
    const assistant = saved.find(m => m.role === 'assistant');
    expect(assistant?.toolActivities).toBeDefined();
    expect(assistant?.toolActivities?.length).toBe(2);
    expect(assistant?.toolActivities?.[0].file).toBe('src/server.ts');
    expect(assistant?.toolActivities?.[1].command).toBe('npm test');
  });

  it('passes deepseek-harness when configured in settings', async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const urlStr = String(url);
      const parsedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: urlStr, body: parsedBody });
      if (urlStr.includes('/api/settings/coding_harness')) {
        return { ok: true, json: async () => ({ value: 'deepseek-harness' }) };
      }
      if (urlStr.includes('/api/coding/sessions')) {
        return { ok: true, json: async () => ({ session: {} }) };
      }
      if (urlStr.includes('/api/coding/run')) {
        return { ok: true, body: ndjsonBody(['{"coding_event":{"type":"text","text":"DeepSeek done."}}']) };
      }
      return { ok: true, body: ndjsonBody(['{"done":true}']), json: async () => ({}) };
    }));

    const { result } = renderHook(() => useSendMessage(makeDeps()));
    await result.current.handleSend();

    const sessionCall = calls.find(c => c.url.includes('/api/coding/sessions'));
    expect(sessionCall).toBeDefined();
    expect(sessionCall?.body).toMatchObject({ harness: 'deepseek-harness' });
  });
});
