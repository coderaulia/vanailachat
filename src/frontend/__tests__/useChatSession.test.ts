// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import * as api from '../lib/api';
import { useChatSession } from '../hooks/useChatSession';
import { DEFAULT_SYSTEM_PROMPT } from '../config/constants';
import type { Chat, Message } from '../types/chat';

function message(id: string, role: Message['role'], content: string): Message {
  return { id, role, content, timestamp: 1 };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const chat: Chat = {
    id: 'c1',
    projectId: 'p1',
    title: 'Saved chat',
    conversation: [message('m1', 'user', 'cached')],
    createdAt: 1,
    updatedAt: 1,
    model: 'ollama:qwen',
    role: 'coding',
    systemPrompt: 'Be terse.',
    projectRoot: '/work/repo',
    usage: 0,
  } as unknown as Chat;

  return {
    selectedModel: 'ollama:llama3',
    selectedRole: 'general' as const,
    selectedProjectId: null,
    projects: [],
    chatHistories: { c1: chat } as Record<string, Chat>,
    statusText: '',
    setStatusText: vi.fn(),
    closeSidebar: vi.fn(),
    saveMessage: vi.fn().mockResolvedValue(undefined),
    upsertChat: vi.fn().mockResolvedValue(undefined),
    patchChat: vi.fn().mockImplementation(async (id: string, updates: object) => ({ id, ...updates })),
    loadMessages: vi.fn().mockResolvedValue([message('m1', 'user', 'from db'), message('m2', 'assistant', 'reply')]),
    updateHistories: vi.fn(),
    setSelectedModel: vi.fn(),
    setSelectedRole: vi.fn(),
    setSelectedProjectId: vi.fn(),
    prompt: '',
    setPrompt: vi.fn(),
    attachedFiles: [],
    setAttachedFiles: vi.fn(),
    ...overrides,
  };
}

describe('useChatSession', () => {
  beforeEach(() => {
    vi.spyOn(api, 'apiFetchSettings').mockResolvedValue({ require_tool_approval: 'true' });
    vi.spyOn(api, 'apiUpdateSetting').mockResolvedValue();
  });

  afterEach(() => vi.restoreAllMocks());

  it('selecting a chat restores its settings, then reloads messages from storage', async () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useChatSession(deps));

    act(() => result.current.handleSelectChat('c1'));

    expect(result.current.currentChatId).toBe('c1');
    expect(result.current.conversation[0].content).toBe('cached');
    expect(result.current.systemPrompt).toBe('Be terse.');
    expect(result.current.projectRoot).toBe('/work/repo');
    expect(deps.setSelectedProjectId).toHaveBeenCalledWith('p1');
    expect(deps.setSelectedModel).toHaveBeenCalledWith('ollama:qwen');
    expect(deps.setSelectedRole).toHaveBeenCalledWith('coding');

    await waitFor(() => expect(result.current.conversation).toHaveLength(2));
    expect(result.current.conversation[0].content).toBe('from db');
  });

  it('ignores an unknown chat id', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const deps = makeDeps();
    const { result } = renderHook(() => useChatSession(deps));
    act(() => result.current.handleSelectChat('missing'));
    expect(result.current.currentChatId).toBeNull();
    expect(deps.loadMessages).not.toHaveBeenCalled();
  });

  it('reports a failed message load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = makeDeps({ loadMessages: vi.fn().mockRejectedValue(new Error('db down')) });
    const { result } = renderHook(() => useChatSession(deps));
    act(() => result.current.handleSelectChat('c1'));
    await waitFor(() => expect(deps.setStatusText).toHaveBeenCalledWith('Failed to load messages'));
  });

  it('a new chat clears the conversation, prompt and attachments', () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useChatSession(deps));
    act(() => result.current.handleSelectChat('c1'));
    act(() => result.current.handleNewChat());

    expect(result.current.currentChatId).toBeNull();
    expect(result.current.conversation).toEqual([]);
    expect(result.current.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(deps.setPrompt).toHaveBeenCalledWith('');
    expect(deps.setAttachedFiles).toHaveBeenCalledWith([]);
  });

  it('saving the system prompt patches the current chat, falling back to the default when blank', async () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useChatSession(deps));
    act(() => result.current.handleSelectChat('c1'));
    act(() => result.current.handleSystemPromptChange('   '));
    act(() => result.current.handleSaveSystemPrompt());
    await waitFor(() => expect(deps.patchChat).toHaveBeenCalledWith('c1', expect.objectContaining({ systemPrompt: DEFAULT_SYSTEM_PROMPT })));
  });

  it('does not turn auto-approve on unless the user confirms', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const deps = makeDeps();
    const { result } = renderHook(() => useChatSession(deps));
    await waitFor(() => expect(api.apiFetchSettings).toHaveBeenCalled());

    await act(async () => { await result.current.toggleAutoApprove(); });
    expect(confirm).toHaveBeenCalled();
    expect(result.current.isAutoApprove).toBe(false);
    expect(api.apiUpdateSetting).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('loads and toggles auto-approve through the settings API', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const deps = makeDeps();
    const { result } = renderHook(() => useChatSession(deps));
    await waitFor(() => expect(api.apiFetchSettings).toHaveBeenCalled());
    expect(result.current.isAutoApprove).toBe(false);

    await act(async () => { await result.current.toggleAutoApprove(); });
    expect(result.current.isAutoApprove).toBe(true);
    expect(api.apiUpdateSetting).toHaveBeenCalledWith('require_tool_approval', 'false');
  });
});
