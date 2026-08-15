import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrations } from './migrations.js';
import { memoryContentId } from './memoryId.js';

const DEFAULT_PROJECT_NAME = 'Default';

function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeTimestamp(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Date.now();
}

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  memory: string | null;
  pinned: number;
  created_at: number;
}

interface ChatRow {
  id: string;
  project_id: string;
  title: string;
  model: string | null;
  project_root: string | null;
  system_prompt: string | null;
  pinned: number;
  role: string | null;
  created_at: number;
  updated_at: number;
  usage: number;
}

interface MessageRow {
  id: string;
  chat_id: string;
  role: string;
  content: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  created_at: number;
}

export interface ProjectRecord {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  memory: string | null;
  pinned: boolean;
  createdAt: number;
}

export interface CreateProjectInput {
  id?: string;
  name: string;
  description?: string | null;
  instructions?: string | null;
  memory?: string | null;
  pinned?: boolean;
  createdAt?: number;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  instructions?: string | null;
  memory?: string | null;
  pinned?: boolean;
}

export interface ChatRecord {
  id: string;
  projectId: string;
  title: string;
  model: string | null;
  projectRoot: string | null;
  systemPrompt: string | null;
  pinned: boolean;
  role: string | null;
  createdAt: number;
  updatedAt: number;
  usage: number;
}

export interface UpsertChatInput {
  id?: string;
  projectId?: string;
  title?: string;
  model?: string | null;
  projectRoot?: string | null;
  systemPrompt?: string | null;
  pinned?: boolean;
  role?: string | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface MessageRecord {
  id: string;
  chatId: string;
  role: string;
  content: string;
  promptTokens: number | null;
  completionTokens: number | null;
  createdAt: number;
}

export interface MessageFeedbackRecord {
  messageId: string;
  rating: number;
  editedContent: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertFeedbackInput {
  messageId: string;
  rating: number;
  editedContent?: string | null;
}

export interface InsertMessageInput {
  id?: string;
  chatId: string;
  role: string;
  content: string;
  promptTokens?: number | null;
  completionTokens?: number | null;
  createdAt?: number;
}

export interface CodingSessionRecord {
  chatId: string;
  harness: string;
  harnessSessionId: string | null;
  workspacePath: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertCodingSessionInput {
  chatId: string;
  harness: string;
  harnessSessionId?: string | null;
  workspacePath: string;
  status: string;
}

interface MemoryEntryRow {
  id: string;
  type: string;
  content: string;
  embedding: Buffer;
  metadata: string | null;
  source_id: string | null;
  created_at: number;
}

export interface MemoryEntryRecord {
  id: string;
  type: string;
  content: string;
  embedding: string;
  metadata: string | null;
  sourceId: string | null;
  createdAt: number;
}

export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  content: string;
  sourceUrl: string | null;
  enabled: boolean;
  installedAt: number;
}

export interface UpsertSkillInput {
  id?: string;
  name: string;
  description: string;
  content: string;
  sourceUrl?: string | null;
  enabled?: boolean;
}

interface SkillRow {
  id: string;
  name: string;
  description: string;
  content: string;
  source_url: string | null;
  enabled: number;
  installed_at: number;
}

function mapSkill(row: SkillRow): SkillRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    content: row.content,
    sourceUrl: row.source_url,
    enabled: row.enabled === 1,
    installedAt: row.installed_at,
  };
}

export class DatabaseService {
  private static db: Database.Database | null = null;

  static initialize(databasePath?: string): void {
    if (this.db) {
      return;
    }

    const finalPath =
      databasePath || process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'vanaila.sqlite');

    fs.mkdirSync(path.dirname(finalPath), { recursive: true });

    const db = new Database(finalPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    this.db = db;
    this.runMigrations();
  }

  private static getDb(): Database.Database {
    if (!this.db) {
      this.initialize();
    }

    if (!this.db) {
      throw new Error('Failed to initialize SQLite database');
    }

    return this.db;
  }

  /**
   * Runs synchronous writes inside one transaction. Bulk inserts issued
   * outside a transaction pay an fsync each, which made imports scale
   * terribly. Falls back to a direct call when no database is available so
   * routes driven by injected mocks still work.
   */
  static runInTransaction<T>(fn: () => T): T {
    let db: Database.Database;
    try {
      db = this.getDb();
    } catch {
      return fn();
    }
    return db.transaction(fn)();
  }

  private static runMigrations(): void {
    const db = this.getDb();

    // Check if we have an existing database without schema_migrations
    const hasProjectsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'").get();
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `);

    const hasMigrations = db.prepare("SELECT COUNT(*) as count FROM schema_migrations").get() as { count: number };
    
    // If we have projects table but no migrations recorded, it's a legacy DB
    // Assume it has all migrations up to version 4 applied
    if (hasProjectsTable && hasMigrations.count === 0) {
      console.log('[DB] Detected legacy database. Initializing migration state to version 4.');
      const stmt = db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');
      const now = Date.now();
      const insertMany = db.transaction((migs: typeof migrations) => {
        for (const mig of migs) {
          stmt.run(mig.version, mig.name, now);
        }
      });
      insertMany(migrations);
    }

    const appliedMigrations = new Set(
      (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map(r => r.version)
    );

    for (const migration of migrations) {
      if (!appliedMigrations.has(migration.version)) {
        console.log(`[DB] Running migration: ${migration.version}_${migration.name}`);
        const transaction = db.transaction(() => {
          migration.up(db);
          db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
            migration.version,
            migration.name,
            Date.now()
          );
        });
        transaction();
      }
    }

    this.ensureDefaultProject();
  }

  private static mapProject(row: ProjectRow): ProjectRecord {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? null,
      instructions: row.instructions ?? null,
      memory: row.memory ?? null,
      pinned: row.pinned === 1,
      createdAt: row.created_at,
    };
  }

  private static mapChat(row: ChatRow): ChatRecord {
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

  private static mapMessage(row: MessageRow): MessageRecord {
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

  private static ensureDefaultProject(): ProjectRecord {
    const db = this.getDb();
    const existing = db
      .prepare('SELECT id, name, description, instructions, memory, created_at FROM projects ORDER BY created_at ASC LIMIT 1')
      .get() as ProjectRow | undefined;

    if (existing) {
      return this.mapProject(existing);
    }

    const project: ProjectRow = {
      id: generateId('project'),
      name: DEFAULT_PROJECT_NAME,
      description: null,
      instructions: null,
      memory: null,
      pinned: 0,
      created_at: Date.now(),
    };

    db.prepare('INSERT INTO projects (id, name, description, instructions, memory, pinned, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      project.id,
      project.name,
      project.description,
      project.instructions,
      project.memory,
      project.pinned,
      project.created_at
    );

    return this.mapProject(project);
  }

  static listProjects(): ProjectRecord[] {
    const db = this.getDb();
    const rows = db
      .prepare('SELECT id, name, description, instructions, memory, pinned, created_at FROM projects ORDER BY created_at ASC')
      .all() as ProjectRow[];

    return rows.map((row) => this.mapProject(row));
  }

  static createProject(input: CreateProjectInput): ProjectRecord {
    const db = this.getDb();
    const name = input.name.trim();
    if (!name) {
      throw new Error('Project name cannot be empty');
    }

    const project = {
      id: input.id && input.id.trim() ? input.id : generateId('project'),
      name,
      description: input.description ?? null,
      instructions: input.instructions ?? null,
      memory: input.memory ?? null,
      pinned: input.pinned ? 1 : 0,
      created_at: normalizeTimestamp(input.createdAt),
    };

    db.prepare('INSERT INTO projects (id, name, description, instructions, memory, pinned, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      project.id,
      project.name,
      project.description,
      project.instructions,
      project.memory,
      project.pinned,
      project.created_at
    );

    return this.mapProject(project);
  }

  static getProject(id: string): ProjectRecord | null {
    const db = this.getDb();
    const row = db
      .prepare('SELECT id, name, description, instructions, memory, pinned, created_at FROM projects WHERE id = ?')
      .get(id) as ProjectRow | undefined;

    return row ? this.mapProject(row) : null;
  }

  static updateProject(id: string, input: UpdateProjectInput): ProjectRecord {
    const db = this.getDb();
    const existing = this.getProject(id);
    if (!existing) {
      throw new Error('Project not found');
    }

    const name = input.name?.trim() || existing.name;
    const description = input.description !== undefined ? input.description : existing.description;
    const instructions = input.instructions !== undefined ? input.instructions : existing.instructions;
    const memory = input.memory !== undefined ? input.memory : existing.memory;

    const pinned = input.pinned !== undefined ? (input.pinned ? 1 : 0) : (existing.pinned ? 1 : 0);
 
    db.prepare(`
      UPDATE projects 
      SET name = ?, description = ?, instructions = ?, memory = ?, pinned = ?
      WHERE id = ?
    `).run(name, description, instructions, memory, pinned, id);

    const updated = this.getProject(id);
    if (!updated) {
      throw new Error('Failed to update project');
    }
    return updated;
  }

  static deleteProject(id: string): boolean {
    const db = this.getDb();
    const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return result.changes > 0;
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
  static searchMessages(
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
    const db = this.getDb();

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

  static listChats(projectId?: string, limit?: number): ChatRecord[] {
    const db = this.getDb();

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

      return rows.map((row) => this.mapChat(row));
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

    return rows.map((row) => this.mapChat(row));
  }

  static getChat(id: string): ChatRecord | null {
    const db = this.getDb();

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

    return row ? this.mapChat(row) : null;
  }

  static upsertChat(input: UpsertChatInput): ChatRecord {
    const db = this.getDb();
    const defaultProject = this.ensureDefaultProject();

    const id = input.id && input.id.trim() ? input.id : generateId('chat');
    const existing = this.getChat(id);

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
      updated_at: normalizeTimestamp(input.updatedAt),
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

    const saved = this.getChat(chat.id);
    if (!saved) {
      throw new Error('Failed to save chat');
    }

    return saved;
  }

  static deleteChat(id: string): boolean {
    const db = this.getDb();
    const result = db.prepare('DELETE FROM chats WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Return positive (rating === 1) assistant messages with their preceding
   * user turn, suitable for LoRA fine-tuning. Pulls the user message that
   * immediately precedes each rated assistant message in the same chat,
   * ordered by created_at ascending. Substitutes edited_content when the
   * user provided a corrected version.
   */
  static listTrainingPairs(): Array<{
    chatId: string;
    userContent: string;
    assistantContent: string;
    rating: number;
    edited: boolean;
    createdAt: number;
  }> {
    const db = this.getDb();
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

  static getMessage(id: string): MessageRecord | null {
    const db = this.getDb();
    const row = db.prepare(
      'SELECT id, chat_id, role, content, prompt_tokens, completion_tokens, created_at FROM messages WHERE id = ?',
    ).get(id) as MessageRow | undefined;
    return row ? this.mapMessage(row) : null;
  }

  // ─── Message feedback ───

  static upsertFeedback(input: UpsertFeedbackInput): MessageFeedbackRecord {
    const db = this.getDb();
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

  static getFeedback(messageId: string): MessageFeedbackRecord | null {
    const db = this.getDb();
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

  static listFeedbackForChat(chatId: string): MessageFeedbackRecord[] {
    const db = this.getDb();
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
  static autoPositiveForChat(
    chatId: string,
    minCompletionTokens = 200,
  ): { messageId: string; content: string; chatId: string } | null {
    const db = this.getDb();
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
  static listHighScoringChats(limit = 20, minRate = 0.6, minRated = 2): string[] {
    const db = this.getDb();
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
  static listDistillationPairs(chatIds: string[]): Array<{
    chatId: string;
    userContent: string;
    assistantContent: string;
    rating: number;
    edited: boolean;
    createdAt: number;
  }> {
    if (chatIds.length === 0) return [];
    const db = this.getDb();
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
  static recordAbPick(input: {
    userContent: string;
    assistantContent: string;
    winnerModel: string;
    loserModel?: string;
  }): { chatId: string; messageId: string } {
    const db = this.getDb();
    const now = Date.now();
    const chatId = generateId('chat');
    const userMsgId = generateId('msg');
    const assistantMsgId = generateId('msg');

    const projectId = (() => {
      const row = db.prepare(
        `SELECT id FROM projects WHERE name = 'Default' LIMIT 1`,
      ).get() as { id: string } | undefined;
      return row?.id ?? null;
    })();

    if (!projectId) throw new Error('Default project not found');

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

  /**
   * Messages for a chat, oldest first. `limit` keeps the newest N — an
   * unbounded read loaded an entire conversation's text on every chat open.
   */
  static listMessages(chatId: string, limit?: number): MessageRecord[] {
    const db = this.getDb();

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

      return rows.map((row) => this.mapMessage(row));
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

    return rows.reverse().map((row) => this.mapMessage(row));
  }

  static insertMessage(input: InsertMessageInput): MessageRecord {
    const db = this.getDb();

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

    return this.mapMessage(message);
  }

  static getCodingSession(chatId: string): CodingSessionRecord | null {
    const row = this.getDb().prepare(
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

  static upsertCodingSession(input: UpsertCodingSessionInput): CodingSessionRecord {
    const db = this.getDb();
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
    const session = this.getCodingSession(input.chatId);
    if (!session) throw new Error('Failed to save coding session');
    return session;
  }

  // ─── Vector Memory ───

  static getAllMemoryEntries(limit?: number): MemoryEntryRecord[] {
    const db = this.getDb();
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

  static upsertMemory(input: {
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
    const db = this.getDb();
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

  static deleteMemory(id: string): boolean {
    const db = this.getDb();
    return db.prepare('DELETE FROM memories WHERE id = ?').run(id).changes > 0;
  }

  // ─── Settings ───

  static getAllSettings(): Record<string, string> {
    const db = this.getDb();
    const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
    const result: Record<string, string> = {};
    for (const row of rows) result[row.key] = row.value;
    return result;
  }

  static getSetting(key: string): string | null {
    const db = this.getDb();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  static upsertSetting(key: string, value: string): void {
    const db = this.getDb();
    db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (@key, @value, @updated_at)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run({ key, value, updated_at: Date.now() });
  }

  // ─── Skills ───

  static listSkills(): SkillRecord[] {
    const db = this.getDb();
    const rows = db
      .prepare('SELECT id, name, description, content, source_url, enabled, installed_at FROM skills ORDER BY name ASC')
      .all() as SkillRow[];
    return rows.map(mapSkill);
  }

  static getSkill(id: string): SkillRecord | null {
    const db = this.getDb();
    const row = db
      .prepare('SELECT id, name, description, content, source_url, enabled, installed_at FROM skills WHERE id = ?')
      .get(id) as SkillRow | undefined;
    return row ? mapSkill(row) : null;
  }

  static getSkillByName(name: string): SkillRecord | null {
    const db = this.getDb();
    const row = db
      .prepare('SELECT id, name, description, content, source_url, enabled, installed_at FROM skills WHERE name = ?')
      .get(name) as SkillRow | undefined;
    return row ? mapSkill(row) : null;
  }

  static upsertSkill(input: UpsertSkillInput): SkillRecord {
    const db = this.getDb();
    const id = input.id ?? generateId('skill');
    db.prepare(
      `INSERT INTO skills (id, name, description, content, source_url, enabled, installed_at)
       VALUES (@id, @name, @description, @content, @source_url, @enabled, @installed_at)
       ON CONFLICT(name) DO UPDATE SET
         description = excluded.description,
         content = excluded.content,
         source_url = excluded.source_url,
         enabled = excluded.enabled`
    ).run({
      id,
      name: input.name,
      description: input.description,
      content: input.content,
      source_url: input.sourceUrl ?? null,
      enabled: input.enabled !== false ? 1 : 0,
      installed_at: Date.now(),
    });
    const saved = this.getSkillByName(input.name);
    if (!saved) throw new Error('Failed to save skill');
    return saved;
  }

  static setSkillEnabled(id: string, enabled: boolean): boolean {
    const db = this.getDb();
    const result = db.prepare('UPDATE skills SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
    return result.changes > 0;
  }

  static deleteSkill(id: string): boolean {
    const db = this.getDb();
    return db.prepare('DELETE FROM skills WHERE id = ?').run(id).changes > 0;
  }

  static listEnabledSkills(): SkillRecord[] {
    const db = this.getDb();
    const rows = db
      .prepare('SELECT id, name, description, content, source_url, enabled, installed_at FROM skills WHERE enabled = 1 ORDER BY name ASC')
      .all() as SkillRow[];
    return rows.map(mapSkill);
  }
}
