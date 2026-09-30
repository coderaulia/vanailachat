import { getDb } from './connection.js';
import { memoryContentId } from '../memoryId.js';
import type { MemoryEntryRecord, MemoryEntryRow } from './types.js';

export function getAllMemoryEntries(limit?: number): MemoryEntryRecord[] {
  const db = getDb();
  const query = limit
    ? `SELECT id, type, content, embedding, metadata, source_id, created_at FROM memories ORDER BY created_at DESC LIMIT ${limit}`
    : 'SELECT id, type, content, embedding, metadata, source_id, created_at FROM memories ORDER BY created_at DESC';
  const rows = db.prepare(query).all() as MemoryEntryRow[];
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    content: row.content,
    embedding: Buffer.isBuffer(row.embedding)
      ? row.embedding.toString('base64')
      : row.embedding as unknown as string, // legacy TEXT fallback
    metadata: row.metadata,
    sourceId: row.source_id,
    createdAt: row.created_at,
  }));
}

export function upsertMemory(input: {
  id?: string;
  type?: string;
  content: string;
  // null when no embedding backend is reachable — the row is still stored so
  // keyword search can find it, and so nothing is lost if embeddings arrive
  // later. The column is NOT NULL, hence the empty buffer.
  embedding: Float32Array | null;
  metadata?: string | null;
  sourceId?: string | null;
}): MemoryEntryRecord {
  const db = getDb();
  const type = input.type ?? 'conversation';
  // Content-derived id, so storing the same memory twice updates one row
  // instead of appending a duplicate.
  const id = input.id ?? memoryContentId(type, input.content);
  const createdAt = Date.now();
  const embeddingBlob = input.embedding
    ? Buffer.from(input.embedding.buffer, input.embedding.byteOffset, input.embedding.byteLength)
    : Buffer.alloc(0);
  const embeddingBase64 = embeddingBlob.toString('base64');

  db.prepare(
    `INSERT INTO memories (id, type, content, embedding, metadata, source_id, created_at)
     VALUES (@id, @type, @content, @embedding, @metadata, @source_id, @created_at)
     ON CONFLICT(id) DO UPDATE SET
       type = excluded.type,
       content = excluded.content,
       embedding = excluded.embedding,
       metadata = excluded.metadata,
       source_id = excluded.source_id`
  ).run({
    id,
    type,
    content: input.content,
    embedding: embeddingBlob,
    metadata: input.metadata ?? null,
    source_id: input.sourceId ?? null,
    created_at: createdAt,
  });

  // Cap memory table size — delete oldest rows beyond the cap.
  // Default 5000; override with MEMORY_TABLE_CAP env var (>= 100, <= 100000).
  const cap = (() => {
    const raw = process.env.MEMORY_TABLE_CAP;
    if (!raw) return 5000;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return 5000;
    return Math.max(100, Math.min(100_000, parsed));
  })();

  db.prepare(
    `DELETE FROM memories WHERE id IN (
       SELECT id FROM memories ORDER BY created_at DESC LIMIT -1 OFFSET ?
     )`,
  ).run(cap);

  return { id, type, content: input.content, embedding: embeddingBase64, metadata: input.metadata ?? null, sourceId: input.sourceId ?? null, createdAt };
}

export function deleteMemory(id: string): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM memories WHERE id = ?').run(id).changes > 0;
}

// ─── Settings ───
