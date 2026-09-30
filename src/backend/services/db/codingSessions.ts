import { getDb } from './connection.js';
import type { CodingSessionRecord, UpsertCodingSessionInput } from './types.js';

export function getCodingSession(chatId: string): CodingSessionRecord | null {
  const row = getDb().prepare(
    `SELECT chat_id, harness, harness_session_id, workspace_path, status, created_at, updated_at
     FROM coding_sessions WHERE chat_id = ?`,
  ).get(chatId) as {
    chat_id: string; harness: string; harness_session_id: string | null; workspace_path: string;
    status: string; created_at: number; updated_at: number;
  } | undefined;
  return row ? {
    chatId: row.chat_id,
    harness: row.harness,
    harnessSessionId: row.harness_session_id,
    workspacePath: row.workspace_path,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } : null;
}

export function upsertCodingSession(input: UpsertCodingSessionInput): CodingSessionRecord {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO coding_sessions (chat_id, harness, harness_session_id, workspace_path, status, created_at, updated_at)
     VALUES (@chatId, @harness, @harnessSessionId, @workspacePath, @status, @now, @now)
     ON CONFLICT(chat_id) DO UPDATE SET
       harness = excluded.harness,
       harness_session_id = COALESCE(excluded.harness_session_id, coding_sessions.harness_session_id),
       workspace_path = excluded.workspace_path,
       status = excluded.status,
       updated_at = excluded.updated_at`,
  ).run({ ...input, harnessSessionId: input.harnessSessionId ?? null, now });
  const session = getCodingSession(input.chatId);
  if (!session) throw new Error('Failed to save coding session');
  return session;
}

// ─── Vector Memory ───
