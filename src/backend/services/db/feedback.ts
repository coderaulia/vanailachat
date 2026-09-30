import { getDb } from './connection.js';
import { ensureDefaultProject } from './projects.js';
import { generateId } from './shared.js';
import type { MessageFeedbackRecord, UpsertFeedbackInput } from './types.js';

/**
 * Return positive (rating === 1) assistant messages with their preceding
 * user turn, suitable for LoRA fine-tuning. Pulls the user message that
 * immediately precedes each rated assistant message in the same chat,
 * ordered by created_at ascending. Substitutes edited_content when the
 * user provided a corrected version.
 */
export function listTrainingPairs(): Array<{
  chatId: string;
  userContent: string;
  assistantContent: string;
  rating: number;
  edited: boolean;
  createdAt: number;
}> {
  const db = getDb();
  const rows = db.prepare(
    `SELECT
       m.id          AS assistant_id,
       m.chat_id     AS chat_id,
       m.content     AS assistant_content,
       m.created_at  AS created_at,
       f.rating      AS rating,
       f.edited_content AS edited_content,
       (SELECT u.content
          FROM messages u
          WHERE u.chat_id = m.chat_id
            AND u.role    = 'user'
            AND u.created_at < m.created_at
          ORDER BY u.created_at DESC
          LIMIT 1) AS user_content
     FROM messages m
     JOIN message_feedback f ON f.message_id = m.id
     WHERE m.role = 'assistant'
       AND f.rating = 1
     ORDER BY m.created_at ASC`,
  ).all() as Array<{
    assistant_id: string;
    chat_id: string;
    assistant_content: string;
    created_at: number;
    rating: number;
    edited_content: string | null;
    user_content: string | null;
  }>;

  return rows
    .filter((row) => row.user_content && row.user_content.trim())
    .map((row) => ({
      chatId: row.chat_id,
      userContent: row.user_content as string,
      assistantContent:
        row.edited_content && row.edited_content.trim()
          ? row.edited_content
          : row.assistant_content,
      rating: row.rating,
      edited: Boolean(row.edited_content && row.edited_content.trim()),
      createdAt: row.created_at,
    }));
}

/** Return positive examples with stable message ids and chat context for review/export selection. */
export function listTrainingExamples(): Array<{
  id: string; chatId: string; chatTitle: string; userContent: string; assistantContent: string;
  rating: number; edited: boolean; createdAt: number;
}> {
  const db = getDb();
  const rows = db.prepare(
    `SELECT m.id AS assistant_id, m.chat_id, COALESCE(c.title, 'Untitled chat') AS chat_title,
            m.content AS assistant_content, m.created_at, f.rating, f.edited_content,
            (SELECT u.content FROM messages u WHERE u.chat_id = m.chat_id AND u.role = 'user'
             AND u.created_at < m.created_at ORDER BY u.created_at DESC LIMIT 1) AS user_content
     FROM messages m
     JOIN message_feedback f ON f.message_id = m.id
     LEFT JOIN chats c ON c.id = m.chat_id
     WHERE m.role = 'assistant' AND f.rating = 1
     ORDER BY m.created_at ASC`,
  ).all() as Array<{
    assistant_id: string; chat_id: string; chat_title: string; assistant_content: string;
    created_at: number; rating: number; edited_content: string | null; user_content: string | null;
  }>;
  return rows.filter((row) => row.user_content?.trim()).map((row) => ({
    id: row.assistant_id, chatId: row.chat_id, chatTitle: row.chat_title,
    userContent: row.user_content as string,
    assistantContent: row.edited_content?.trim() ? row.edited_content : row.assistant_content,
    rating: row.rating, edited: Boolean(row.edited_content?.trim()), createdAt: row.created_at,
  }));
}

export function upsertFeedback(input: UpsertFeedbackInput): MessageFeedbackRecord {
  const db = getDb();
  const now = Date.now();
  const rating = Math.max(-1, Math.min(1, Math.trunc(input.rating)));
  const editedContent = input.editedContent ?? null;

  db.prepare(
    `INSERT INTO message_feedback (message_id, rating, edited_content, created_at, updated_at)
     VALUES (@message_id, @rating, @edited_content, @created_at, @updated_at)
     ON CONFLICT(message_id) DO UPDATE SET
       rating = excluded.rating,
       edited_content = excluded.edited_content,
       updated_at = excluded.updated_at`,
  ).run({
    message_id: input.messageId,
    rating,
    edited_content: editedContent,
    created_at: now,
    updated_at: now,
  });

  const row = db.prepare(
    'SELECT message_id, rating, edited_content, created_at, updated_at FROM message_feedback WHERE message_id = ?',
  ).get(input.messageId) as
    | { message_id: string; rating: number; edited_content: string | null; created_at: number; updated_at: number }
    | undefined;

  if (!row) throw new Error('Failed to save feedback');
  return {
    messageId: row.message_id,
    rating: row.rating,
    editedContent: row.edited_content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getFeedback(messageId: string): MessageFeedbackRecord | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT message_id, rating, edited_content, created_at, updated_at FROM message_feedback WHERE message_id = ?',
  ).get(messageId) as
    | { message_id: string; rating: number; edited_content: string | null; created_at: number; updated_at: number }
    | undefined;
  return row
    ? {
        messageId: row.message_id,
        rating: row.rating,
        editedContent: row.edited_content,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    : null;
}

export function listFeedbackForChat(chatId: string): MessageFeedbackRecord[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT f.message_id, f.rating, f.edited_content, f.created_at, f.updated_at
     FROM message_feedback f
     JOIN messages m ON m.id = f.message_id
     WHERE m.chat_id = ?
     ORDER BY f.updated_at DESC`,
  ).all(chatId) as Array<{ message_id: string; rating: number; edited_content: string | null; created_at: number; updated_at: number }>;
  return rows.map((row) => ({
    messageId: row.message_id,
    rating: row.rating,
    editedContent: row.edited_content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Auto-positive heuristic: if the last assistant message in a chat has
 * no feedback and meets the minimum completion-token threshold, record an
 * implicit +1. Returns the message ID + content for the caller to embed,
 * or null if nothing was auto-rated.
 */
export function autoPositiveForChat(
  chatId: string,
  minCompletionTokens = 200,
): { messageId: string; content: string; chatId: string } | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT m.id, m.content, m.chat_id
     FROM messages m
     LEFT JOIN message_feedback f ON f.message_id = m.id
     WHERE m.chat_id = ?
       AND m.role = 'assistant'
       AND f.message_id IS NULL
       AND m.completion_tokens >= ?
     ORDER BY m.created_at DESC
     LIMIT 1`,
  ).get(chatId, minCompletionTokens) as
    | { id: string; content: string; chat_id: string }
    | undefined;

  if (!row) return null;

  const now = Date.now();
  db.prepare(
    `INSERT INTO message_feedback (message_id, rating, edited_content, implicit, created_at, updated_at)
     VALUES (?, 1, NULL, 1, ?, ?)
     ON CONFLICT(message_id) DO NOTHING`,
  ).run(row.id, now, now);

  // Verify insert happened (skip if it already had feedback via another path)
  const saved = db.prepare('SELECT implicit FROM message_feedback WHERE message_id = ? AND implicit = 1').get(row.id);
  if (!saved) return null;

  return { messageId: row.id, content: row.content, chatId: row.chat_id };
}

/**
 * Return chat IDs that have a high positive-feedback ratio (>= minRate)
 * and enough rated messages to be trustworthy (>= minRated).
 * Used for prompt distillation: conversations the user loved most.
 */
export function listHighScoringChats(limit = 20, minRate = 0.6, minRated = 2): string[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT m.chat_id,
            SUM(CASE WHEN f.rating = 1 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) AS positive_rate,
            COUNT(*) AS total_rated
     FROM message_feedback f
     JOIN messages m ON m.id = f.message_id
     WHERE f.rating != 0
     GROUP BY m.chat_id
     HAVING total_rated >= ? AND positive_rate >= ?
     ORDER BY positive_rate DESC, total_rated DESC
     LIMIT ?`,
  ).all(minRated, minRate, limit) as Array<{ chat_id: string }>;
  return rows.map((r) => r.chat_id);
}

/**
 * Training pairs from a specific set of chats, for distillation export.
 * Only returns explicit (non-implicit) +1 pairs to keep quality high.
 */
export function listDistillationPairs(chatIds: string[]): Array<{
  chatId: string;
  userContent: string;
  assistantContent: string;
  rating: number;
  edited: boolean;
  createdAt: number;
}> {
  if (chatIds.length === 0) return [];
  const db = getDb();
  const placeholders = chatIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT
       m.chat_id     AS chat_id,
       m.content     AS assistant_content,
       m.created_at  AS created_at,
       f.rating      AS rating,
       f.edited_content AS edited_content,
       (SELECT u.content
          FROM messages u
          WHERE u.chat_id = m.chat_id
            AND u.role    = 'user'
            AND u.created_at < m.created_at
          ORDER BY u.created_at DESC
          LIMIT 1) AS user_content
     FROM messages m
     JOIN message_feedback f ON f.message_id = m.id
     WHERE m.role = 'assistant'
       AND f.rating = 1
       AND f.implicit = 0
       AND m.chat_id IN (${placeholders})
     ORDER BY m.created_at ASC`,
  ).all(...chatIds) as Array<{
    chat_id: string;
    assistant_content: string;
    created_at: number;
    rating: number;
    edited_content: string | null;
    user_content: string | null;
  }>;

  return rows
    .filter((row) => row.user_content && row.user_content.trim())
    .map((row) => ({
      chatId: row.chat_id,
      userContent: row.user_content as string,
      assistantContent:
        row.edited_content && row.edited_content.trim()
          ? row.edited_content
          : row.assistant_content,
      rating: row.rating,
      edited: Boolean(row.edited_content && row.edited_content.trim()),
      createdAt: row.created_at,
    }));
}

/**
 * Save a synthetic training pair (from A/B evaluation) as a real chat +
 * messages + feedback record so it flows into the standard training export.
 */
export function recordAbPick(input: {
  userContent: string;
  assistantContent: string;
  winnerModel: string;
  loserModel?: string;
}): { chatId: string; messageId: string } {
  const db = getDb();
  const now = Date.now();
  const chatId = generateId('chat');
  const userMsgId = generateId('msg');
  const assistantMsgId = generateId('msg');

  const defaultProject = ensureDefaultProject();
  const projectId = defaultProject.id;

  db.transaction(() => {
    db.prepare(
      `INSERT INTO chats (id, project_id, title, model, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      chatId,
      projectId,
      `A/B Eval — ${new Date(now).toISOString().slice(0, 10)}`,
      input.winnerModel,
      now,
      now,
    );

    db.prepare(
      `INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)`,
    ).run(userMsgId, chatId, input.userContent, now);

    db.prepare(
      `INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)`,
    ).run(assistantMsgId, chatId, input.assistantContent, now + 1);

    db.prepare(
      `INSERT INTO message_feedback (message_id, rating, edited_content, implicit, created_at, updated_at)
       VALUES (?, 1, NULL, 0, ?, ?)`,
    ).run(assistantMsgId, now, now);
  })();

  return { chatId, messageId: assistantMsgId };
}
