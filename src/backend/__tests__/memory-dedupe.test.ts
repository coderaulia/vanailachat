import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DatabaseService } from '../services/database.js';
import { memoryContentId } from '../services/memoryId.js';

function freshDb(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vanaila-mem-')), 'test.sqlite');
}

function resetSingleton() {
  (DatabaseService as unknown as { db: { close: () => void } | null }).db?.close();
  (DatabaseService as unknown as { db: unknown }).db = null;
}

describe('memory de-duplication', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = freshDb();
    resetSingleton();
    DatabaseService.initialize(dbPath);
  });

  afterEach(() => {
    resetSingleton();
  });

  it('stores one row no matter how often the same text is saved', () => {
    for (let i = 0; i < 5; i++) {
      DatabaseService.upsertMemory({
        type: 'conversation',
        content: 'how do i use the settings?',
        embedding: null,
      });
    }

    const entries = DatabaseService.getAllMemoryEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(memoryContentId('conversation', 'how do i use the settings?'));
  });

  it('keeps distinct content apart', () => {
    DatabaseService.upsertMemory({ type: 'conversation', content: 'first', embedding: null });
    DatabaseService.upsertMemory({ type: 'conversation', content: 'second', embedding: null });

    expect(DatabaseService.getAllMemoryEntries()).toHaveLength(2);
  });

  it('separates the same text stored under different types', () => {
    DatabaseService.upsertMemory({ type: 'conversation', content: 'same', embedding: null });
    DatabaseService.upsertMemory({ type: 'manual', content: 'same', embedding: null });

    expect(DatabaseService.getAllMemoryEntries()).toHaveLength(2);
  });

  it('preserves the original timestamp when a memory is re-stored', () => {
    DatabaseService.upsertMemory({ type: 'conversation', content: 'aged', embedding: null });
    const first = DatabaseService.getAllMemoryEntries()[0].createdAt;

    DatabaseService.upsertMemory({ type: 'conversation', content: 'aged', embedding: null });
    const second = DatabaseService.getAllMemoryEntries()[0].createdAt;

    // Recency decay would otherwise reset every time the question was re-asked.
    expect(second).toBe(first);
  });

  it('upgrades a later write with an embedding without duplicating', () => {
    DatabaseService.upsertMemory({ type: 'conversation', content: 'vectorless', embedding: null });
    DatabaseService.upsertMemory({
      type: 'conversation',
      content: 'vectorless',
      embedding: new Float32Array([0.1, 0.2]),
    });

    const entries = DatabaseService.getAllMemoryEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].embedding.length).toBeGreaterThan(0);
  });

  it('an explicit id still wins over the content hash', () => {
    DatabaseService.upsertMemory({ id: 'mem_custom', type: 'manual', content: 'x', embedding: null });
    expect(DatabaseService.getAllMemoryEntries()[0].id).toBe('mem_custom');
  });
});

describe('migration 13', () => {
  it('collapses duplicates already in the database, keeping the earliest', () => {
    const dbPath = freshDb();
    resetSingleton();

    // Build a pre-migration database: schema through v12, duplicate rows with
    // random ids, exactly the shape the bug produced.
    DatabaseService.initialize(dbPath);
    resetSingleton();

    const raw = new Database(dbPath);
    raw.prepare('DELETE FROM schema_migrations WHERE version = 13').run();
    const insert = raw.prepare(
      'INSERT INTO memories (id, type, content, embedding, metadata, source_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    for (let i = 0; i < 19; i++) {
      insert.run(`mem_random_${i}`, 'conversation', 'how do i use the settings?', Buffer.alloc(0), null, null, 1000 + i);
    }
    insert.run('mem_random_other', 'conversation', 'something else', Buffer.alloc(0), null, null, 2000);
    raw.close();

    // Re-opening runs the pending migration.
    DatabaseService.initialize(dbPath);
    const entries = DatabaseService.getAllMemoryEntries();

    expect(entries).toHaveLength(2);
    const settings = entries.find((e) => e.content.startsWith('how do i'))!;
    expect(settings.createdAt).toBe(1000);
    expect(settings.id).toBe(memoryContentId('conversation', 'how do i use the settings?'));

    // A later write of the same text must not add a 3rd row.
    DatabaseService.upsertMemory({
      type: 'conversation',
      content: 'how do i use the settings?',
      embedding: null,
    });
    expect(DatabaseService.getAllMemoryEntries()).toHaveLength(2);

    resetSingleton();
  });
});
