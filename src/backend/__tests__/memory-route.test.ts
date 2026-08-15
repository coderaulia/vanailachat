import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';

describe('memory route', () => {
  const entry = {
    id: 'mem_1',
    type: 'manual',
    content: 'cats love tuna',
    embedding: 'base64-bytes',
    metadata: null,
    sourceId: null,
    createdAt: Date.now(),
  };

  it('GET /api/memory returns all entries', async () => {
    const getAllMemoryEntries = vi.fn().mockReturnValue([entry]);
    const app = createApp({ getAllMemoryEntries });

    const response = await app.request('/api/memory');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { memories: unknown[]; count: number };
    expect(body.count).toBe(1);
    expect(body.memories).toEqual([entry]);
  });

  it('GET /api/memory/search rejects empty query', async () => {
    const searchMemoriesByText = vi.fn();
    const app = createApp({ searchMemoriesByText });

    const response = await app.request('/api/memory/search');
    expect(response.status).toBe(400);
    expect(searchMemoriesByText).not.toHaveBeenCalled();
  });

  it('GET /api/memory/search returns results', async () => {
    const results = [{ id: 'mem_1', content: 'cats love tuna', score: 0.9, metadata: null }];
    const searchMemoriesByText = vi.fn().mockResolvedValue(results);
    const app = createApp({ searchMemoriesByText });

    const response = await app.request('/api/memory/search?q=cats&k=3');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { results: typeof results };
    expect(body.results).toEqual(results);
    expect(searchMemoriesByText).toHaveBeenCalledWith('cats', 3);
  });

  it('POST /api/memory stores a new memory', async () => {
    const embedding = new Float32Array([0.1, 0.2, 0.3]);
    const embedOrNull = vi.fn().mockResolvedValue(embedding);
    const upsertMemory = vi.fn().mockReturnValue({ ...entry, content: 'note text' });
    const app = createApp({ embedOrNull, upsertMemory });

    const response = await app.request('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'note text', type: 'manual' }),
    });

    expect(response.status).toBe(201);
    expect(embedOrNull).toHaveBeenCalledWith('note text');
    expect(upsertMemory).toHaveBeenCalledOnce();
    expect(upsertMemory.mock.calls[0][0].embedding).toBe(embedding);
  });

  it('POST /api/memory still stores when no embedding backend is reachable', async () => {
    const embedOrNull = vi.fn().mockResolvedValue(null);
    const upsertMemory = vi.fn().mockReturnValue({ ...entry, content: 'note text' });
    const app = createApp({ embedOrNull, upsertMemory });

    const response = await app.request('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'note text', type: 'manual' }),
    });

    expect(response.status).toBe(201);
    expect(upsertMemory.mock.calls[0][0].embedding).toBeNull();
  });

  it('POST /api/memory rejects empty content', async () => {
    const upsertMemory = vi.fn();
    const app = createApp({ upsertMemory });

    const response = await app.request('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '   ' }),
    });

    expect(response.status).toBe(400);
    expect(upsertMemory).not.toHaveBeenCalled();
  });

  it('DELETE /api/memory/:id deletes', async () => {
    const deleteMemory = vi.fn().mockReturnValue(true);
    const app = createApp({ deleteMemory });

    const response = await app.request('/api/memory/mem_1', { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect(deleteMemory).toHaveBeenCalledWith('mem_1');
  });
});
