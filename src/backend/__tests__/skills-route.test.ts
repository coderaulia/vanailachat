import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';

const skillRecord = {
  id: 'skill_1',
  name: 'frontend-design',
  description: 'frontend skill',
  content: '# Frontend Design\n\nbody',
  sourceUrl: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md',
  enabled: true,
  installedAt: Date.now(),
};

describe('skills route', () => {
  it('GET /api/skills returns installed', async () => {
    const listSkills = vi.fn().mockReturnValue([skillRecord]);
    const app = createApp({ listSkills });

    const response = await app.request('/api/skills');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { skills: typeof skillRecord[] };
    expect(body.skills).toEqual([skillRecord]);
  });

  it('GET /api/skills/catalog merges install state', async () => {
    const listSkills = vi.fn().mockReturnValue([skillRecord]);
    const app = createApp({ listSkills });

    const response = await app.request('/api/skills/catalog');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      catalog: Array<{ name: string; installed: boolean; enabled: boolean }>;
    };
    const frontend = body.catalog.find((s) => s.name === 'frontend-design');
    expect(frontend?.installed).toBe(true);
    expect(frontend?.enabled).toBe(true);
  });

  it('POST /api/skills/install fetches and stores', async () => {
    const upsertSkill = vi.fn().mockReturnValue(skillRecord);
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('---\nname: frontend-design\ndescription: a skill\n---\nbody', {
        status: 200,
      }),
    );
    const app = createApp({ upsertSkill, fetchFn });

    const response = await app.request('/api/skills/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'frontend-design' }),
    });

    expect(response.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(upsertSkill).toHaveBeenCalledOnce();
    expect(upsertSkill.mock.calls[0][0].name).toBe('frontend-design');
  });

  it('POST /api/skills/install rejects unknown skill', async () => {
    const upsertSkill = vi.fn();
    const app = createApp({ upsertSkill });

    const response = await app.request('/api/skills/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'not-real' }),
    });

    expect(response.status).toBe(404);
    expect(upsertSkill).not.toHaveBeenCalled();
  });

  it('PATCH /api/skills/:id toggles enabled', async () => {
    const setSkillEnabled = vi.fn().mockReturnValue(true);
    const app = createApp({ setSkillEnabled });

    const response = await app.request('/api/skills/skill_1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });

    expect(response.status).toBe(200);
    expect(setSkillEnabled).toHaveBeenCalledWith('skill_1', false);
  });

  it('DELETE /api/skills/:id uninstalls', async () => {
    const deleteSkill = vi.fn().mockReturnValue(true);
    const app = createApp({ deleteSkill });

    const response = await app.request('/api/skills/skill_1', { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect(deleteSkill).toHaveBeenCalledWith('skill_1');
  });

  it('POST /api/skills/custom requires name in frontmatter', async () => {
    const upsertSkill = vi.fn();
    const app = createApp({ upsertSkill });

    const response = await app.request('/api/skills/custom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'no frontmatter here' }),
    });

    expect(response.status).toBe(400);
    expect(upsertSkill).not.toHaveBeenCalled();
  });
});
