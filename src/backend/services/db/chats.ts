import { getDb } from './connection.js';
import { ensureDefaultProject } from './projects.js';
import { generateId, normalizeTimestamp } from './shared.js';
import type { ChatRecord, ChatRow, UpsertChatInput } from './types.js';

export function mapChat(row: ChatRow): ChatRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    model: row.model,
    projectRoot: row.project_root,
    systemPrompt: row.system_prompt,
    pinned: row.pinned === 1,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    usage: row.usage ?? 0,
  };
}

export function listChats(projectId?: string, limit?: number): ChatRecord[] {
  const db = getDb();

  if (limit !== undefined) {
    const inner = projectId
      ? `SELECT * FROM chats WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?`
      : `SELECT * FROM chats ORDER BY updated_at DESC LIMIT ?`;

    const rows = db
      .prepare(
        `
    SELECT
      c.id,
      c.project_id,
      c.title,
      c.model,
      c.project_root,
      c.system_prompt,
      c.pinned,
      c.role,
      c.created_at,
      c.updated_at,
      COALESCE(SUM(COALESCE(m.prompt_tokens, 0) + COALESCE(m.completion_tokens, 0)), 0) AS usage
    FROM (${inner}) c
    LEFT JOIN messages m ON m.chat_id = c.id
    GROUP BY c.id
    ORDER BY c.updated_at DESC
    `,
      )
      .all(...(projectId ? [projectId, limit] : [limit])) as ChatRow[];

    return rows.map((row) => mapChat(row));
  }

  const baseQuery = `
    SELECT
      c.id,
      c.project_id,
      c.title,
      c.model,
      c.project_root,
      c.system_prompt,
      c.pinned,
      c.role,
      c.created_at,
      c.updated_at,
      COALESCE(SUM(COALESCE(m.prompt_tokens, 0) + COALESCE(m.completion_tokens, 0)), 0) AS usage
    FROM chats c
    LEFT JOIN messages m ON m.chat_id = c.id
    `;

  const query = projectId
    ? `${baseQuery} WHERE c.project_id = ? GROUP BY c.id ORDER BY c.updated_at DESC`
    : `${baseQuery} GROUP BY c.id ORDER BY c.updated_at DESC`;

  const rows = projectId
    ? (db.prepare(query).all(projectId) as ChatRow[])
    : (db.prepare(query).all() as ChatRow[]);

  return rows.map((row) => mapChat(row));
}

export function getChat(id: string): ChatRecord | null {
  const db = getDb();

  const row = db
    .prepare(
      `
      SELECT
        c.id,
        c.project_id,
        c.title,
        c.model,
        c.project_root,
        c.system_prompt,
        c.pinned,
        c.role,
        c.created_at,
        c.updated_at,
        COALESCE(SUM(COALESCE(m.prompt_tokens, 0) + COALESCE(m.completion_tokens, 0)), 0) AS usage
      FROM chats c
      LEFT JOIN messages m ON m.chat_id = c.id
      WHERE c.id = ?
      GROUP BY c.id
    `
    )
    .get(id) as ChatRow | undefined;

  return row ? mapChat(row) : null;
}

export function upsertChat(input: UpsertChatInput): ChatRecord {
  const db = getDb();
  const defaultProject = ensureDefaultProject();

  const id = input.id && input.id.trim() ? input.id : generateId('chat');
  const existing = getChat(id);

  const chat = {
    id,
    project_id: input.projectId || existing?.projectId || defaultProject.id,
    title: input.title?.trim() || existing?.title || 'Untitled chat',
    model: input.model ?? existing?.model ?? null,
    project_root: input.projectRoot ?? existing?.projectRoot ?? null,
    system_prompt: input.systemPrompt ?? existing?.systemPrompt ?? null,
    pinned: input.pinned ?? existing?.pinned ?? false,
    role: input.role ?? existing?.role ?? null,
    created_at: normalizeTimestamp(input.createdAt ?? existing?.createdAt),
    updated_at: normalizeTimestamp(input.updatedAt ?? existing?.updatedAt),
  };

  db.prepare(
    `
    INSERT INTO chats (id, project_id, title, model, project_root, system_prompt, pinned, role, created_at, updated_at)
    VALUES (@id, @project_id, @title, @model, @project_root, @system_prompt, @pinned, @role, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      project_id = excluded.project_id,
      title = excluded.title,
      model = excluded.model,
      project_root = excluded.project_root,
      system_prompt = excluded.system_prompt,
      pinned = excluded.pinned,
      role = excluded.role,
      updated_at = excluded.updated_at
  `
  ).run({
    ...chat,
    pinned: chat.pinned ? 1 : 0,
  });

  const saved = getChat(chat.id);
  if (!saved) {
    throw new Error('Failed to save chat');
  }

  return saved;
}

export function deleteChat(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM chats WHERE id = ?').run(id);
  return result.changes > 0;
}
