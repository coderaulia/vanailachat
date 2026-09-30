import { getDb } from './connection.js';
import { generateId, normalizeTimestamp } from './shared.js';
import type { InsertMessageInput, MessageRecord, MessageRow } from './types.js';

export function mapMessage(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    chatId: row.chat_id,
    role: row.role,
    content: row.content,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    createdAt: row.created_at,
  };
}

export function getMessage(id: string): MessageRecord | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT id, chat_id, role, content, prompt_tokens, completion_tokens, created_at FROM messages WHERE id = ?',
  ).get(id) as MessageRow | undefined;
  return row ? mapMessage(row) : null;
}

// ─── Message feedback ───

/**
 * Messages for a chat, oldest first. `limit` keeps the newest N — an
 * unbounded read loaded an entire conversation's text on every chat open.
 */
export function listMessages(chatId: string, limit?: number): MessageRecord[] {
  const db = getDb();

  if (limit === undefined) {
    const rows = db
      .prepare(
        `
      SELECT id, chat_id, role, content, prompt_tokens, completion_tokens, created_at
      FROM messages
      WHERE chat_id = ?
      ORDER BY created_at ASC
    `
      )
      .all(chatId) as MessageRow[];

    return rows.map((row) => mapMessage(row));
  }

  // Take the newest `limit` rows, then flip back to chronological order.
  const rows = db
    .prepare(
      `
      SELECT id, chat_id, role, content, prompt_tokens, completion_tokens, created_at
      FROM messages
      WHERE chat_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `
    )
    .all(chatId, limit) as MessageRow[];

  return rows.reverse().map((row) => mapMessage(row));
}

export function insertMessage(input: InsertMessageInput): MessageRecord {
  const db = getDb();

  const message = {
    id: input.id && input.id.trim() ? input.id : generateId('msg'),
    chat_id: input.chatId,
    role: input.role,
    content: input.content,
    prompt_tokens:
      typeof input.promptTokens === 'number' && Number.isFinite(input.promptTokens)
        ? input.promptTokens
        : null,
    completion_tokens:
      typeof input.completionTokens === 'number' && Number.isFinite(input.completionTokens)
        ? input.completionTokens
        : null,
    created_at: normalizeTimestamp(input.createdAt),
  };

  db.prepare(
    `
    INSERT INTO messages (id, chat_id, role, content, prompt_tokens, completion_tokens, created_at)
    VALUES (@id, @chat_id, @role, @content, @prompt_tokens, @completion_tokens, @created_at)
    ON CONFLICT(id) DO UPDATE SET
      role = excluded.role,
      content = excluded.content,
      prompt_tokens = excluded.prompt_tokens,
      completion_tokens = excluded.completion_tokens,
      created_at = excluded.created_at
  `
  ).run(message);

  return mapMessage(message);
}

/**
 * Chats newest-first, each with its summed token usage.
 *
 * When `limit` is set the chats are selected and truncated *before* the
 * message join, so the token SUM only touches the rows being returned
 * rather than every message in the database.
 */
/**
 * Full-text search over message bodies, grouped into one hit per chat.
 *
 * FTS5 MATCH syntax would otherwise leak to the user — a stray quote or a
 * bare `AND` raises "fts5: syntax error". The query is tokenised and each
 * term quoted so arbitrary typing behaves like a plain keyword search.
 */
export function searchMessages(
  query: string,
  limit = 30,
  projectId?: string,
): Array<{
  chatId: string;
  chatTitle: string;
  projectId: string;
  messageId: string;
  role: string;
  snippet: string;
  createdAt: number;
}> {
  const db = getDb();

  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 1)
    .map((term) => `"${term}"`);

  if (terms.length === 0) return [];

  const matchExpression = terms.join(' AND ');

  const sql = `
    SELECT
      m.id      AS message_id,
      m.chat_id AS chat_id,
      m.role    AS role,
      m.created_at AS created_at,
      c.title   AS chat_title,
      c.project_id AS project_id,
      snippet(messages_fts, 0, '', '', '…', 12) AS snippet,
      bm25(messages_fts) AS rank
    FROM messages_fts
    JOIN messages m ON m.rowid = messages_fts.rowid
    JOIN chats c ON c.id = m.chat_id
    WHERE messages_fts MATCH ?
      ${projectId ? 'AND c.project_id = ?' : ''}
    ORDER BY rank
    LIMIT ?
  `;

  const params: unknown[] = projectId
    ? [matchExpression, projectId, limit]
    : [matchExpression, limit];

  try {
    const rows = db.prepare(sql).all(...params) as Array<{
      message_id: string;
      chat_id: string;
      role: string;
      created_at: number;
      chat_title: string;
      project_id: string;
      snippet: string;
    }>;

    return rows.map((row) => ({
      chatId: row.chat_id,
      chatTitle: row.chat_title,
      projectId: row.project_id,
      messageId: row.message_id,
      role: row.role,
      snippet: row.snippet,
      createdAt: row.created_at,
    }));
  } catch (error) {
    console.error('[DB] Message search failed:', error);
    return [];
  }
}
