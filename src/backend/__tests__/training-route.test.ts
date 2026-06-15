import { describe, expect, it, vi, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../app';

const pair = {
  chatId: 'chat_1',
  userContent: 'why sky blue',
  assistantContent: 'Rayleigh scattering — short wavelengths scatter more.',
  rating: 1,
  edited: false,
  createdAt: 1_700_000_000_000,
};

const exportRoot = path.resolve(process.cwd(), 'data', 'training');
const stamps: string[] = [];

afterEach(async () => {
  await Promise.all(
    stamps.splice(0).map(async (f) => {
      await fs.rm(path.join(exportRoot, f), { force: true });
    }),
  );
});

describe('training route', () => {
  it('GET /api/training/stats returns counts', async () => {
    const listTrainingPairs = vi.fn().mockReturnValue([pair, { ...pair, edited: true, createdAt: pair.createdAt + 1000 }]);
    const app = createApp({ listTrainingPairs });

    const response = await app.request('/api/training/stats');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { pairs: number; edited: number; oldest: number; newest: number };
    expect(body.pairs).toBe(2);
    expect(body.edited).toBe(1);
    expect(body.oldest).toBe(pair.createdAt);
    expect(body.newest).toBe(pair.createdAt + 1000);
  });

  it('GET /api/training/stats with no pairs returns zeros', async () => {
    const listTrainingPairs = vi.fn().mockReturnValue([]);
    const app = createApp({ listTrainingPairs });

    const response = await app.request('/api/training/stats');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { pairs: number; oldest: number | null };
    expect(body.pairs).toBe(0);
    expect(body.oldest).toBeNull();
  });

  it('POST /api/training/export writes sharegpt JSONL', async () => {
    const listTrainingPairs = vi.fn().mockReturnValue([pair]);
    const app = createApp({ listTrainingPairs });

    const response = await app.request('/api/training/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'sharegpt' }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { path: string; pairs: number; format: string; filename: string };
    expect(body.pairs).toBe(1);
    expect(body.format).toBe('sharegpt');
    stamps.push(body.filename);

    const written = await fs.readFile(body.path, 'utf8');
    const line = JSON.parse(written.trim());
    expect(line).toEqual({
      messages: [
        { role: 'user', content: 'why sky blue' },
        { role: 'assistant', content: pair.assistantContent },
      ],
    });
  });

  it('POST /api/training/export writes alpaca JSONL when requested', async () => {
    const listTrainingPairs = vi.fn().mockReturnValue([pair]);
    const app = createApp({ listTrainingPairs });

    const response = await app.request('/api/training/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'alpaca' }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { path: string; filename: string };
    stamps.push(body.filename);

    const written = await fs.readFile(body.path, 'utf8');
    const line = JSON.parse(written.trim());
    expect(line).toEqual({
      instruction: 'why sky blue',
      input: '',
      output: pair.assistantContent,
    });
  });

  it('POST /api/training/export 400 when no pairs available', async () => {
    const listTrainingPairs = vi.fn().mockReturnValue([]);
    const app = createApp({ listTrainingPairs });

    const response = await app.request('/api/training/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
  });
});
