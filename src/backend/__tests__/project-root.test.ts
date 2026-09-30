import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';
import { DatabaseService } from '../services/database.js';

function json(body: unknown) {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

describe('project workspace binding', () => {
  beforeEach(() => {
    DatabaseService.close();
    DatabaseService.initialize(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vanaila-root-')), 'test.sqlite'));
  });

  afterEach(() => DatabaseService.close());

  it('stores the folder a project is bound to, trimmed, and returns it on reload', async () => {
    const app = createApp();
    const created = await (await app.request('/api/projects', json({ name: 'Repo', projectRoot: '  /work/repo ' }))).json() as { project: { id: string; projectRoot: string } };
    expect(created.project.projectRoot).toBe('/work/repo');

    const listed = await (await app.request('/api/projects')).json() as { projects: Array<{ id: string; projectRoot: string | null }> };
    expect(listed.projects.find((p) => p.id === created.project.id)?.projectRoot).toBe('/work/repo');
    expect(listed.projects[0].projectRoot).toBeNull();
  });

  it('keeps the binding on other edits and clears it only with null', async () => {
    const app = createApp();
    const { project } = await (await app.request('/api/projects', json({ name: 'Repo', projectRoot: '/work/repo' }))).json() as { project: { id: string } };
    const patch = (body: unknown) => app.request(`/api/projects/${project.id}`, { ...json(body), method: 'PATCH' }).then((r) => r.json() as Promise<{ project: { projectRoot: string | null; name: string } }>);

    expect((await patch({ name: 'Renamed' })).project).toMatchObject({ name: 'Renamed', projectRoot: '/work/repo' });
    expect((await patch({ projectRoot: null })).project.projectRoot).toBeNull();
  });

  it('carries the binding through export and import', async () => {
    const app = createApp();
    await app.request('/api/import', json({ projects: [{ id: 'p_imp', name: 'Imported', projectRoot: '/srv/app' }] }));
    expect(DatabaseService.getProject('p_imp')?.projectRoot).toBe('/srv/app');
    const bundle = await (await app.request('/api/export')).json() as { projects: Array<{ id: string; projectRoot: string | null }> };
    expect(bundle.projects.find((p) => p.id === 'p_imp')?.projectRoot).toBe('/srv/app');
  });
});
