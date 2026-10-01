/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSendMessage, type SendMessageDeps } from '../hooks/useSendMessage';
import type { Message } from '../types/chat';

function makeDeps(overrides: Partial<SendMessageDeps> = {}): SendMessageDeps {
  return {
    selectedModel: 'custom:mock-a',
    selectedRole: 'general' as SendMessageDeps['selectedRole'],
    selectedProjectId: 'proj_1',
    projects: [],
    chatHistories: {},
    prompt: 'hello',
    setPrompt: vi.fn(),
    attachedFiles: [],
    setAttachedFiles: vi.fn(),
    conversation: [] as Message[],
    setConversation: vi.fn(),
    systemPrompt: '',
    projectRoot: '',
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

describe('sending while a reply is streaming', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is refused, so the running reply is not aborted or mixed into another message', async () => {
    let releaseStream!: () => void;
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      // Never delivers a chunk until released, like a slow model.
      body: { getReader: () => ({ read: () => new Promise<{ done: boolean; value?: Uint8Array }>((resolve) => { releaseStream = () => resolve({ done: true }); }) }) },
      json: async () => ({}),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const deps = makeDeps();
    const { result } = renderHook(() => useSendMessage(deps));

    let first!: Promise<void>;
    act(() => { first = result.current.handleSend(); });
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/chat'))).toBe(true));
    const chatCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/chat')).length;
    expect(chatCalls()).toBe(1);

    await act(async () => { await result.current.handleSend(); });
    expect(chatCalls()).toBe(1);
    expect(deps.setStatusText).toHaveBeenCalledWith(expect.stringContaining('Still replying'));
    expect(deps.abortRef.current?.signal.aborted).toBe(false);

    await act(async () => { releaseStream(); await first; });

    // Once the reply is over the next message goes through.
    await act(async () => { const next = result.current.handleSend(); await vi.waitFor(() => expect(chatCalls()).toBe(2)); releaseStream(); await next; });
  });
});
