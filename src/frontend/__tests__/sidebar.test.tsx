// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as ChatContext from '../context/ChatContext';
import * as api from '../lib/api';
import { Sidebar } from '../components/Sidebar';
import type { Chat } from '../types/chat';

type ChatValue = ReturnType<typeof ChatContext.useChat>;

function chat(id: string, title: string, projectId = ''): [string, Chat] {
  return [id, {
    id, projectId, title, conversation: [], createdAt: 1, updatedAt: 1_700_000_000_000,
    pinned: false, role: 'general', model: null, projectRoot: null, systemPrompt: null, usage: 0,
  } as unknown as Chat];
}

function mockChat(overrides: Partial<Record<string, unknown>> = {}) {
  const value = {
    isSidebarOpen: true,
    closeSidebar: vi.fn(),
    currentChatId: 'c1',
    sortedHistories: [chat('c1', 'Leave policy'), chat('c2', 'Rust borrow checker'), chat('c3', 'Other project', 'p2')],
    projects: [{ id: 'p2', name: 'Second' }],
    selectedProjectId: null,
    handleNewChat: vi.fn(),
    handleSelectProject: vi.fn(),
    handleCreateProject: vi.fn(),
    handleExportData: vi.fn(),
    handleImportData: vi.fn(),
    handleSelectChat: vi.fn(),
    handleDeleteChat: vi.fn(),
    handleRenameChat: vi.fn(),
    handleTogglePin: vi.fn(),
    handleToggleArchive: vi.fn(),
    setViewMode: vi.fn(),
    isDarkMode: false,
    toggleTheme: vi.fn(),
    ...overrides,
  };
  vi.spyOn(ChatContext, 'useChat').mockReturnValue(value as unknown as ChatValue);
  return value;
}

const search = () => screen.getByPlaceholderText(/Search chats and messages/);

describe('Sidebar', () => {
  beforeEach(() => {
    vi.spyOn(api, 'apiSearchMessages').mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('lists only chats in the selected project', () => {
    mockChat();
    render(<Sidebar />);
    expect(screen.getByText('Leave policy')).toBeDefined();
    expect(screen.getByText('Rust borrow checker')).toBeDefined();
    expect(screen.queryByText('Other project')).toBeNull();
  });

  it('selects a chat and switches to the chat view', () => {
    const value = mockChat();
    render(<Sidebar />);
    fireEvent.click(screen.getByText('Rust borrow checker'));
    expect(value.handleSelectChat).toHaveBeenCalledWith('c2');
    expect(value.setViewMode).toHaveBeenCalledWith('chat');
  });

  it('closes itself after selecting a chat on narrow screens', () => {
    const value = mockChat();
    const width = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 });
    render(<Sidebar />);
    fireEvent.click(screen.getByText('Rust borrow checker'));
    expect(value.closeSidebar).toHaveBeenCalled();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  });

  it('filters by title immediately', () => {
    mockChat();
    render(<Sidebar />);
    fireEvent.change(search(), { target: { value: 'rust' } });
    expect(screen.queryByText('Leave policy')).toBeNull();
    expect(screen.getByText('Rust borrow checker')).toBeDefined();
  });

  it('adds chats whose messages match, with a snippet', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(api.apiSearchMessages).mockResolvedValue([
      { chatId: 'c1', chatTitle: 'Leave policy', messageId: 'm1', role: 'user', snippet: '…sixteen weeks of parental leave…', createdAt: 1 },
    ]);
    mockChat();
    render(<Sidebar />);
    fireEvent.change(search(), { target: { value: 'parental' } });
    await act(async () => { vi.advanceTimersByTime(250); });
    await waitFor(() => expect(screen.getByText('…sixteen weeks of parental leave…')).toBeDefined());
    expect(api.apiSearchMessages).toHaveBeenCalledWith('parental', undefined, expect.any(AbortSignal));
  });

  it('renames a chat with Enter and cancels with Escape', () => {
    const value = mockChat();
    render(<Sidebar />);
    fireEvent.click(screen.getAllByLabelText('Rename chat')[0]);
    const input = screen.getByDisplayValue('Leave policy');
    fireEvent.change(input, { target: { value: 'Parental leave' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(value.handleRenameChat).toHaveBeenCalledWith('c1', 'Parental leave');

    fireEvent.click(screen.getAllByLabelText('Rename chat')[1]);
    fireEvent.keyDown(screen.getByDisplayValue('Rust borrow checker'), { key: 'Escape' });
    expect(value.handleRenameChat).toHaveBeenCalledTimes(1);
  });

  it('pins and deletes without selecting the chat', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const value = mockChat();
    render(<Sidebar />);
    fireEvent.click(screen.getAllByLabelText('Pin chat')[0]);
    fireEvent.click(screen.getAllByLabelText('Delete chat')[1]);
    expect(value.handleTogglePin).toHaveBeenCalledWith('c1');
    expect(value.handleDeleteChat).toHaveBeenCalledWith('c2');
    expect(value.handleSelectChat).not.toHaveBeenCalled();
  });

  it('keeps the chat when the delete confirmation is declined', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const value = mockChat();
    render(<Sidebar />);
    fireEvent.click(screen.getAllByLabelText('Delete chat')[0]);
    expect(confirm).toHaveBeenCalledOnce();
    expect(value.handleDeleteChat).not.toHaveBeenCalled();
  });

  it('creates a project from the inline input', () => {
    const value = mockChat();
    render(<Sidebar />);
    fireEvent.click(screen.getByLabelText('Create project'));
    const input = screen.getByPlaceholderText('New project name');
    fireEvent.change(input, { target: { value: 'Research' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(value.handleCreateProject).toHaveBeenCalledWith('Research');
  });

  it('hides archived chats until the archive view is opened', () => {
    const [id, archivedChat] = chat('c9', 'Finished project');
    const value = mockChat({
      sortedHistories: [chat('c1', 'Leave policy'), [id, { ...archivedChat, archived: true }]],
    });
    render(<Sidebar />);
    expect(screen.queryByText('Finished project')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Archived (1)' }));
    expect(screen.getByText('Finished project')).toBeDefined();
    expect(screen.queryByText('Leave policy')).toBeNull();

    fireEvent.click(screen.getByLabelText('Restore chat'));
    expect(value.handleToggleArchive).toHaveBeenCalledWith('c9');
  });

  it('archives a chat from its row', () => {
    const value = mockChat();
    render(<Sidebar />);
    expect(screen.queryByRole('button', { name: /Archived/ })).toBeNull();
    fireEvent.click(screen.getAllByLabelText('Archive chat')[0]);
    expect(value.handleToggleArchive).toHaveBeenCalledWith('c1');
    expect(value.handleSelectChat).not.toHaveBeenCalled();
  });
});
