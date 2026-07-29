import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';

describe('GET /api/fs/browse', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanaila-fs-'));
    fs.mkdirSync(path.join(root, 'src'));
    fs.mkdirSync(path.join(root, 'docs'));
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.mkdirSync(path.join(root, '.git'));
    fs.writeFileSync(path.join(root, 'readme.md'), '# hi');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function browse(target?: string) {
    const app = createApp();
    const query = target ? `?path=${encodeURIComponent(target)}` : '';
    const response = await app.request(`/api/fs/browse${query}`);
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  it('lists sub-directories, sorted, and never files', async () => {
    const { status, body } = await browse(root);
    const names = (body.directories as Array<{ name: string }>).map((d) => d.name);

    expect(status).toBe(200);
    expect(names).toEqual(['docs', 'src']);
    expect(names).not.toContain('readme.md');
  });

  it('hides dot-directories and node_modules, which are never the workspace', async () => {
    const { body } = await browse(root);
    const names = (body.directories as Array<{ name: string }>).map((d) => d.name);

    expect(names).not.toContain('.git');
    expect(names).not.toContain('node_modules');
  });

  it('returns absolute paths so a selection can be used directly', async () => {
    const { body } = await browse(root);
    const entries = body.directories as Array<{ path: string }>;

    for (const entry of entries) {
      expect(path.isAbsolute(entry.path)).toBe(true);
    }
  });

  it('exposes the parent so the UI can walk up', async () => {
    const { body } = await browse(path.join(root, 'src'));
    expect(body.parent).toBe(root);
  });

  it('reports no parent at a filesystem root', async () => {
    const { body } = await browse(path.parse(root).root);
    expect(body.parent).toBeNull();
  });

  it('defaults to the home directory when no path is given', async () => {
    const { body } = await browse();
    expect(body.path).toBe(os.homedir());
  });

  it('answers a missing directory with 400, not a crash', async () => {
    const { status, body } = await browse(path.join(root, 'does-not-exist'));

    expect(status).toBe(400);
    expect(body.error).toBeTruthy();
  });
});
