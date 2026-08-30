/* @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSendMessage, type SendMessageDeps } from '../hooks/useSendMessage';
import type { Message } from '../types/chat';

function message(id: string, role: 'user' | 'assistant', content: string): Message {
  return { id, role, content, timestamp: Date.now() };
}

const conversation: Message[] = [
  message('u1', 'user', 'what is our parental leave policy?'),
  message('a1', 'assistant', 'Sixteen weeks.'),
  message('u2', 'user', 'and for secondary caregivers?'),
  message('a2', 'assistant', 'Wrong answer here.'),
];

function makeDeps(overrides: Partial<SendMessageDeps> = {}): SendMessageDeps {
  return {
    selectedModel: 'llama3',
    selectedRole: 'general' as SendMessageDeps['selectedRole'],
    selectedProjectId: 'proj_1',
    projects: [],
    chatHistories: {},
    prompt: '',
    setPrompt: vi.fn(),
    attachedFiles: [],
    setAttachedFiles: vi.fn(),
    conversation,
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
    updateHistories: vi.fn(),
    saveMessage: vi.fn().mockResolvedValue(undefined),
    upsertChat: vi.fn().mockResolvedValue(undefined),
    patchChat: vi.fn().mockResolvedValue({}),
    ...overrides,
  } as SendMessageDeps;
}

/** Capture what was POSTed to /api/chat without running a real request. */
function stubChatFetch() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    body: {
      getReader: () => ({
        read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
      }),
    },
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sentMessages(fetchMock: ReturnType<typeof stubChatFetch>) {
  const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/chat'));
  const body = JSON.parse(String((call?.[1] as RequestInit).body)) as {
    messages: Array<{ role: string; content: unknown }>;
  };
  return body.messages;
}

describe('handleRegenerate', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('re-sends the question that produced the answer, without duplicating it', async () => {
    const fetchMock = stubChatFetch();
    const setConversation = vi.fn();
    const { result } = renderHook(() => useSendMessage(makeDeps({ setConversation })));

    await result.current.handleRegenerate('a2');

    const messages = sentMessages(fetchMock);
    const texts = messages.map((m) =>
      Array.isArray(m.content)
        ? (m.content as Array<{ text?: string }>).map((p) => p.text).join('')
        : String(m.content),
    );

    // The retried question is the last thing sent...
    expect(texts[texts.length - 1]).toContain('and for secondary caregivers?');
    // ...and the discarded answer is not part of the history.
    expect(texts.join('\n')).not.toContain('Wrong answer here.');

    // The optimistic conversation drops the replaced pair before re-appending.
    const optimistic = setConversation.mock.calls[0][0] as Message[];
    expect(optimistic.map((m) => m.id)).toEqual(expect.arrayContaining(['u1', 'a1']));
    expect(optimistic.map((m) => m.id)).not.toContain('a2');
  });

  it('ignores an id that is not in the conversation', async () => {
    const fetchMock = stubChatFetch();
    const { result } = renderHook(() => useSendMessage(makeDeps()));

    await result.current.handleRegenerate('nope');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores a leading assistant message with no question before it', async () => {
    const fetchMock = stubChatFetch();
    const { result } = renderHook(() =>
      useSendMessage(makeDeps({ conversation: [message('a0', 'assistant', 'hello')] })),
    );

    await result.current.handleRegenerate('a0');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('handleEditAndResend', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('sends the edited text and drops everything after the original', async () => {
    const fetchMock = stubChatFetch();
    const setConversation = vi.fn();
    const { result } = renderHook(() => useSendMessage(makeDeps({ setConversation })));

    await result.current.handleEditAndResend('u2', 'and what about adoption leave?');

    const texts = sentMessages(fetchMock).map((m) =>
      Array.isArray(m.content)
        ? (m.content as Array<{ text?: string }>).map((p) => p.text).join('')
        : String(m.content),
    );

    expect(texts[texts.length - 1]).toContain('and what about adoption leave?');
    expect(texts.join('\n')).not.toContain('and for secondary caregivers?');

    const optimistic = setConversation.mock.calls[0][0] as Message[];
    expect(optimistic.map((m) => m.id)).toEqual(expect.arrayContaining(['u1', 'a1']));
    expect(optimistic.map((m) => m.id)).not.toContain('u2');
  });

  it('refuses empty edits', async () => {
    const fetchMock = stubChatFetch();
    const { result } = renderHook(() => useSendMessage(makeDeps()));

    await result.current.handleEditAndResend('u2', '   ');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resends unchanged text after an interrupted response', async () => {
    const fetchMock = stubChatFetch();
    const { result } = renderHook(() => useSendMessage(makeDeps()));

    await result.current.handleEditAndResend('u2', 'and for secondary caregivers?');

    expect(fetchMock).toHaveBeenCalled();
  });
});
