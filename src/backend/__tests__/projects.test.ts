import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import type { ApiProject } from '../../frontend/types/chat';

describe('projects route', () => {
  const mockProject: ApiProject = {
    id: 'proj_1',
    name: 'Test Project',
    description: 'Test Description',
    instructions: 'Test Instructions',
    memory: 'Test Memory',
    pinned: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it('GET /api/projects returns a list of projects', async () => {
    const listProjects = vi.fn().mockReturnValue([mockProject]);
    const app = createApp({ listProjects });

    const response = await app.request('/api/projects');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ projects: [mockProject] });
    expect(listProjects).toHaveBeenCalledTimes(1);
  });

  it('POST /api/projects creates a new project', async () => {
    const createProject = vi.fn().mockReturnValue(mockProject);
    const app = createApp({ createProject });

    const response = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Project' }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ project: mockProject });
    expect(createProject).toHaveBeenCalledWith({ name: 'Test Project' });
  });

  it('PATCH /api/projects/:id updates a project', async () => {
    const updateProject = vi.fn().mockReturnValue({ ...mockProject, pinned: true });
    const app = createApp({ updateProject });

    const response = await app.request('/api/projects/proj_1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: true }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.project.pinned).toBe(true);
    expect(updateProject).toHaveBeenCalledWith('proj_1', { pinned: true });
  });

  it('DELETE /api/projects/:id deletes a project', async () => {
    const deleteProject = vi.fn().mockReturnValue(true);
    const app = createApp({ deleteProject });

    const response = await app.request('/api/projects/proj_1', {
      method: 'DELETE',
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });
    expect(deleteProject).toHaveBeenCalledWith('proj_1');
  });
});
