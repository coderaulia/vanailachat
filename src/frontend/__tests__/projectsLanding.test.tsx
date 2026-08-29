// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ProjectsLanding } from '../components/ProjectsLanding';
import * as ChatContext from '../context/ChatContext';
import type { ApiProject, Chat } from '../types/chat';

describe('ProjectsLanding component', () => {
  const mockProjects: ApiProject[] = [
    {
      id: 'proj-1',
      name: 'Alpha Project',
      description: 'Alpha workspace description',
      instructions: 'Custom instructions for alpha',
      memory: 'Alpha memory facts',
      pinned: true,
      createdAt: 1713500000000,
    },
    {
      id: 'proj-2',
      name: 'Beta Workspace',
      description: 'Beta workspace description',
      instructions: null,
      memory: null,
      pinned: false,
      createdAt: 1713600000000,
    },
  ];

  const mockChats: [string, Chat][] = [
    [
      'chat-1',
      {
        id: 'chat-1',
        projectId: 'proj-1',
        title: 'Alpha Chat 1',
        conversation: [],
        createdAt: 1713500000000,
        updatedAt: 1713550000000,
        pinned: false,
        role: 'general',
        model: 'llama3',
        projectRoot: null,
        systemPrompt: null,
        usage: 1200,
      },
    ],
  ];

  const setViewMode = vi.fn();
  const handleSelectProject = vi.fn();
  const handleCreateProject = vi.fn().mockResolvedValue({ id: 'proj-3', name: 'Gamma Workspace' });
  const handleUpdateProject = vi.fn();
  const handleDeleteProject = vi.fn();
  const handleNewChat = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(ChatContext, 'useChat').mockReturnValue({
      projects: mockProjects,
      sortedHistories: mockChats,
      selectedProjectId: 'proj-1',
      setViewMode,
      handleSelectProject,
      handleCreateProject,
      handleUpdateProject,
      handleDeleteProject,
      handleNewChat,
    } as unknown as ReturnType<typeof ChatContext.useChat>);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders all workspace cards and statistics', () => {
    render(<ProjectsLanding />);

    expect(screen.getByText('Workspaces & Projects')).toBeDefined();
    expect(screen.getByText('Alpha Project')).toBeDefined();
    expect(screen.getByText('Beta Workspace')).toBeDefined();

    // Check stats badges
    expect(screen.getByText('Memory')).toBeDefined();
    expect(screen.getByText('Instructions')).toBeDefined();
  });

  it('filters workspaces by search query', () => {
    render(<ProjectsLanding />);

    const searchInput = screen.getByPlaceholderText(/Search workspaces/i);
    fireEvent.change(searchInput, { target: { value: 'Beta' } });

    expect(screen.queryByText('Alpha Project')).toBeNull();
    expect(screen.getByText('Beta Workspace')).toBeDefined();
  });

  it('navigates to project detail when clicking a workspace card', () => {
    render(<ProjectsLanding />);

    const betaCard = screen.getByText('Beta Workspace');
    fireEvent.click(betaCard);

    expect(handleSelectProject).toHaveBeenCalledWith('proj-2');
    expect(setViewMode).toHaveBeenCalledWith('project');
  });

  it('navigates back to chat when clicking Back to Chat', () => {
    render(<ProjectsLanding />);

    const backButton = screen.getByText('Back to Chat');
    fireEvent.click(backButton);

    expect(setViewMode).toHaveBeenCalledWith('chat');
  });

  it('opens modal and creates a new project', async () => {
    render(<ProjectsLanding />);

    const newTopBtn = document.querySelector('.btn-create-top') as HTMLButtonElement;
    expect(newTopBtn).toBeDefined();
    fireEvent.click(newTopBtn);

    expect(screen.getByRole('heading', { name: /Create New Workspace/i })).toBeDefined();

    const nameInput = screen.getByPlaceholderText(/e.g. Mobile App Redesign/i);
    fireEvent.change(nameInput, { target: { value: 'Gamma Workspace' } });

    const submitButton = document.querySelector('.btn-modal-submit') as HTMLButtonElement;
    expect(submitButton).toBeDefined();
    fireEvent.click(submitButton);

    expect(handleCreateProject).toHaveBeenCalledWith('Gamma Workspace', '');
  });
});
