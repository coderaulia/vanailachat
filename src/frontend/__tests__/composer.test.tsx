// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import * as ChatContext from '../context/ChatContext';
import { Composer } from '../components/Composer';

type ChatValue = ReturnType<typeof ChatContext.useChat>;

function mockChat(overrides: Partial<Record<string, unknown>> = {}) {
  const value = {
    attachedFiles: [],
    filteredAvailableModels: ['ollama:llama3'],
    contextPercentage: 10,
    contextWindow: { current: 100, total: 1000 },
    fileInputRef: createRef<HTMLInputElement>(),
    isCurrentChatSending: false,
    isSearchEnabled: false,
    modelMetadata: {},
    setPersona: vi.fn(),
    prompt: '',
    projectRoot: '',
    providers: [],
    selectedRole: 'general',
    selectedModel: 'ollama:llama3',
    shouldShowRoleSuggestion: false,
    statusText: '',
    suggestedModelName: '',
    suggestedRoleLabel: '',
    systemPrompt: '',
    handleAttach: vi.fn(),
    handleAttachFiles: vi.fn(),
    handleNewChat: vi.fn(),
    removeAttachment: vi.fn(),
    handleAcceptRoleSuggestion: vi.fn(),
    handleDismissRoleSuggestion: vi.fn(),
    handleSaveProjectRoot: vi.fn(),
    handlePickProjectRoot: vi.fn(),
    handleSelectRole: vi.fn(),
    setSelectedModel: vi.fn(),
    handleSend: vi.fn(),
    setPrompt: vi.fn(),
    handleProjectRootChange: vi.fn(),
    handleSystemPromptChange: vi.fn(),
    handleSaveSystemPrompt: vi.fn(),
    setIsSearchEnabled: vi.fn(),
    handleRefreshModels: vi.fn(),
    handleAbort: vi.fn(),
    setViewMode: vi.fn(),
    ...overrides,
  };
  vi.spyOn(ChatContext, 'useChat').mockReturnValue(value as unknown as ChatValue);
  return value;
}

const textarea = () => screen.getByPlaceholderText(/Ask for code/) as HTMLTextAreaElement;

describe('Composer', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('sends on Enter and switches to the chat view', () => {
    const chat = mockChat({ prompt: 'hello' });
    render(<Composer thinkingSeconds={0} />);
    fireEvent.keyDown(textarea(), { key: 'Enter' });
    expect(chat.handleSend).toHaveBeenCalledOnce();
    expect(chat.setViewMode).toHaveBeenCalledWith('chat');
  });

  it('keeps Shift+Enter for a newline', () => {
    const chat = mockChat({ prompt: 'hello' });
    render(<Composer thinkingSeconds={0} />);
    fireEvent.keyDown(textarea(), { key: 'Enter', shiftKey: true });
    expect(chat.handleSend).not.toHaveBeenCalled();
  });

  it('reports typing through setPrompt', () => {
    const chat = mockChat();
    render(<Composer thinkingSeconds={0} />);
    fireEvent.change(textarea(), { target: { value: 'draft' } });
    expect(chat.setPrompt).toHaveBeenCalledWith('draft');
  });

  it('shows Stop instead of Send while a reply is streaming', () => {
    const chat = mockChat({ isCurrentChatSending: true });
    render(<Composer thinkingSeconds={3} />);
    expect(screen.queryByRole('button', { name: /Send/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Stop/ }));
    expect(chat.handleAbort).toHaveBeenCalledOnce();
  });

  it('switches role and applies that role’s persona', () => {
    const chat = mockChat();
    render(<Composer thinkingSeconds={0} />);
    fireEvent.click(screen.getByRole('button', { name: /Coding/ }));
    expect(chat.handleSelectRole).toHaveBeenCalledWith('coding');
    expect(chat.setPersona).toHaveBeenCalled();
    expect(chat.handleSystemPromptChange).toHaveBeenCalled();
    vi.runAllTimers();
    expect(chat.handleSaveSystemPrompt).toHaveBeenCalled();
  });

  it('removes an attachment', () => {
    const chat = mockChat({ attachedFiles: [{ name: 'notes.txt', type: 'text/plain', content: 'x' }] });
    render(<Composer thinkingSeconds={0} />);
    expect(screen.getByText('notes.txt')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '×' }));
    expect(chat.removeAttachment).toHaveBeenCalledWith(0);
  });

  it('attaches pasted images', () => {
    const chat = mockChat();
    render(<Composer thinkingSeconds={0} />);
    const image = new File(['png'], 'image.png', { type: 'image/png' });
    fireEvent.paste(textarea(), {
      clipboardData: { items: [{ type: 'image/png', getAsFile: () => image }], files: [] },
    });
    expect(chat.handleAttachFiles).toHaveBeenCalledOnce();
    const [files] = chat.handleAttachFiles.mock.calls[0] as [File[]];
    expect(files[0].name).toMatch(/^screenshot-\d{6}\.png$/);
  });
});
