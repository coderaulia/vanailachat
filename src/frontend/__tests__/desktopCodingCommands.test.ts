/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { SendMessageDeps } from '../hooks/useSendMessage';
import type { Message } from '../types/chat';

const runNativeCoding = vi.fn(async () => {});
const apiUndoCodingTurn = vi.fn(async () => 'Restored 1 file(s): a.txt');

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  isTauri: true,
  runNativeCoding: (...args: unknown[]) => (runNativeCoding as (...a: unknown[]) => Promise<void>)(...args),
  apiUndoCodingTurn: (...args: unknown[]) => (apiUndoCodingTurn as (...a: unknown[]) => Promise<string>)(...args),
  apiCreateCodingSession: vi.fn(async () => ({})),
  apiFetchSettings: vi.fn(async () => ({})),
  apiChatOnce: vi.fn(async () => null),
}));

const { useSendMessage } = await import('../hooks/useSendMessage');

function makeDeps(prompt: string): SendMessageDeps {
  return {
    selectedModel: 'qwen3:8b',
    selectedRole: 'coding' as SendMessageDeps['selectedRole'],
    selectedProjectId: 'p1',
    projects: [],
    chatHistories: {},
    prompt,
    setPrompt: vi.fn(),
    attachedFiles: [],
    setAttachedFiles: vi.fn(),
    conversation: [] as Message[],
    setConversation: vi.fn(),
    systemPrompt: '',
    projectRoot: '/work/app',
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
  } as SendMessageDeps;
}

describe('desktop coding chat commands', () => {
  beforeEach(() => {
    runNativeCoding.mockClear();
    apiUndoCodingTurn.mockClear();
  });

  it('/undo restores the last turn instead of sending a message', async () => {
    const deps = makeDeps('/undo');
    const { result } = renderHook(() => useSendMessage(deps));
    await act(async () => { await result.current.handleSend(); });

    expect(apiUndoCodingTurn).toHaveBeenCalledWith('chat_1');
    expect(runNativeCoding).not.toHaveBeenCalled();
    expect(deps.setStatusText).toHaveBeenCalledWith('Restored 1 file(s): a.txt');
    expect(deps.setPrompt).toHaveBeenCalledWith('');
  });

  it('/plan runs a plan-mode turn with the command stripped from the prompt', async () => {
    const deps = makeDeps('/plan add a --verbose flag');
    const { result } = renderHook(() => useSendMessage(deps));
    await act(async () => { await result.current.handleSend(); });

    expect(runNativeCoding).toHaveBeenCalledOnce();
    const [request] = runNativeCoding.mock.calls[0] as unknown as [{ mode: string; prompt: string }];
    expect(request.mode).toBe('plan');
    expect(request.prompt).toBe('add a --verbose flag');
  });

  it('a normal message implements', async () => {
    const deps = makeDeps('add a --verbose flag');
    const { result } = renderHook(() => useSendMessage(deps));
    await act(async () => { await result.current.handleSend(); });
    const [request] = runNativeCoding.mock.calls[0] as unknown as [{ mode: string; prompt: string }];
    expect(request.mode).toBe('implement');
    expect(request.prompt).toBe('add a --verbose flag');
  });
});
