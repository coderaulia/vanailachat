import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseService } from '../services/database.js';
import { createApp } from '../app.js';

describe('message full-text search', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vanaila-fts-')), 'test.sqlite');
    // Reset the singleton so initialize() targets the throwaway database.
    (DatabaseService as unknown as { db: unknown }).db = null;
    DatabaseService.initialize(dbPath);

    const project = DatabaseService.listProjects()[0];
    DatabaseService.upsertChat({ id: 'chat_1', projectId: project.id, title: 'Untitled chat' });
    DatabaseService.insertMessage({
      chatId: 'chat_1',
      role: 'user',
      content: 'what is our parental leave policy for primary caregivers?',
    });
    DatabaseService.insertMessage({
      chatId: 'chat_1',
      role: 'assistant',
      content: 'Primary caregivers receive 16 weeks of paid leave.',
    });
    DatabaseService.insertMessage({
      chatId: 'chat_1',
      role: 'user',
      content: 'unrelated note about the espresso machine',
    });
  });

  afterEach(() => {
    (DatabaseService as unknown as { db: { close: () => void } | null }).db?.close();
    (DatabaseService as unknown as { db: unknown }).db = null;
  });

  it('finds messages whose chat title does not mention the term', () => {
    const results = DatabaseService.searchMessages('parental leave');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].chatId).toBe('chat_1');
    expect(results[0].chatTitle).toBe('Untitled chat');
    expect(results.some((r) => r.snippet.toLowerCase().includes('parental'))).toBe(true);
  });

  it('requires every term to be present', () => {
    expect(DatabaseService.searchMessages('parental espresso')).toHaveLength(0);
  });

  it('survives FTS5 punctuation that would otherwise be a syntax error', () => {
    expect(() => DatabaseService.searchMessages('"unbalanced AND (')).not.toThrow();
    expect(DatabaseService.searchMessages('caregivers"')).not.toHaveLength(0);
  });

  it('stays in sync when a message is deleted with its chat', () => {
    DatabaseService.deleteChat('chat_1');
    expect(DatabaseService.searchMessages('parental leave')).toHaveLength(0);
  });

  it('serves results over GET /api/messages/search', async () => {
    const app = createApp();
    const response = await app.request('/api/messages/search?q=parental%20leave');
    const body = (await response.json()) as { results: Array<{ chatId: string }> };

    expect(response.status).toBe(200);
    expect(body.results[0]?.chatId).toBe('chat_1');
  });

  it('returns an empty list for a blank query rather than erroring', async () => {
    const app = createApp();
    const response = await app.request('/api/messages/search?q=%20');
    const body = (await response.json()) as { results: unknown[] };

    expect(response.status).toBe(200);
    expect(body.results).toEqual([]);
  });
});
