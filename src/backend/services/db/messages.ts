import { getDb } from './connection.js';
import { generateId, normalizeTimestamp } from './shared.js';
import type { InsertMessageInput, MessageRecord, MessageRow, MessageVersionRecord } from './types.js';

export function mapMessage(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    chatId: row.chat_id,
    role: row.role,
    content: row.content,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    createdAt: row.created_at,
    versionOf: row.version_of ?? null,
    versionCount: row.version_count ?? 1,
  };
}

/** Columns for a message row, including the size of its regenerate group. */
const MESSAGE_COLUMNS = `
  m.id, m.chat_id, m.role, m.content, m.prompt_tokens, m.completion_tokens, m.created_at, m.version_of,
  (SELECT COUNT(*) FROM messages v
    WHERE v.id = COALESCE(m.version_of, m.id) OR v.version_of = COALESCE(m.version_of, m.id)) AS version_count
`;

export function getMessage(id: string): MessageRecord | null {
  const db = getDb();
  const row = db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages m WHERE m.id = ?`).get(id) as MessageRow | undefined;
  return row ? mapMessage(row) : null;
}

/**
 * Live messages for a chat, oldest first; superseded ones (replaced by a
 * regenerate or edit) are left out. `limit` keeps the newest N — an
 * unbounded read loaded an entire conversation's text on every chat open.
 */
export function listMessages(chatId: string, limit?: number): MessageRecord[] {
  const db = getDb();

  if (limit === undefined) {
    const rows = db
      .prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages m WHERE m.chat_id = ? AND m.superseded_at IS NULL ORDER BY m.created_at ASC`)
      .all(chatId) as MessageRow[];
    return rows.map((row) => mapMessage(row));
  }

  // Take the newest `limit` rows, then flip back to chronological order.
  const rows = db
    .prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages m WHERE m.chat_id = ? AND m.superseded_at IS NULL ORDER BY m.created_at DESC LIMIT ?`)
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
    version_of: input.versionOf?.trim() || null,
  };

  db.prepare(
    `
    INSERT INTO messages (id, chat_id, role, content, prompt_tokens, completion_tokens, created_at, version_of)
    VALUES (@id, @chat_id, @role, @content, @prompt_tokens, @completion_tokens, @created_at, @version_of)
    ON CONFLICT(id) DO UPDATE SET
      role = excluded.role,
      content = excluded.content,
      prompt_tokens = excluded.prompt_tokens,
      completion_tokens = excluded.completion_tokens,
      created_at = excluded.created_at,
      version_of = COALESCE(excluded.version_of, messages.version_of),
      -- An explicit save means the message is live again.
      superseded_at = NULL
  `
  ).run(message);

  return getMessage(message.id) ?? mapMessage(message);
}

/**
 * Hides `fromMessageId` and every later live message in its chat, as a
 * regenerate or edit replaces them. Rows are kept so earlier answers stay
 * browsable. Returns the number of messages hidden.
 */
export function supersedeMessagesFrom(chatId: string, fromMessageId: string): number {
  const db = getDb();
  const from = db.prepare('SELECT rowid, created_at FROM messages WHERE id = ? AND chat_id = ?').get(fromMessageId, chatId) as
    | { rowid: number; created_at: number }
    | undefined;
  if (!from) return 0;
  const result = db.prepare(
    `UPDATE messages SET superseded_at = ?
     WHERE chat_id = ? AND superseded_at IS NULL
       AND (created_at > ? OR (created_at = ? AND rowid >= ?))`,
  ).run(Date.now(), chatId, from.created_at, from.created_at, from.rowid);
  return result.changes;
}

/** Every answer in a message's regenerate group, oldest first. */
export function listMessageVersions(messageId: string): MessageVersionRecord[] {
  const db = getDb();
  const target = db.prepare('SELECT COALESCE(version_of, id) AS root FROM messages WHERE id = ?').get(messageId) as
    | { root: string }
    | undefined;
  if (!target) return [];
  const rows = db.prepare(
    `SELECT id, content, created_at, superseded_at FROM messages
     WHERE id = ? OR version_of = ?
     ORDER BY created_at ASC, rowid ASC`,
  ).all(target.root, target.root) as Array<{ id: string; content: string; created_at: number; superseded_at: number | null }>;
  return rows.map((row) => ({ id: row.id, content: row.content, createdAt: row.created_at, current: row.superseded_at === null }));
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
      AND m.superseded_at IS NULL
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
