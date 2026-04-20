import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

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

export interface InsertMessageInput {
  id?: string;
  chatId: string;
  role: string;
  content: string;
  promptTokens?: number | null;
  completionTokens?: number | null;
  createdAt?: number;
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

  private static runMigrations(): void {
    const db = this.getDb();

    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        instructions TEXT,
        memory TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        model TEXT,
        project_root TEXT,
        system_prompt TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        role TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_chats_project_updated ON chats(project_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages(chat_id, created_at ASC);
    `);

    const chatColumns = db
      .prepare("SELECT name FROM pragma_table_info('chats')")
      .all() as Array<{ name: string }>;
    const hasProjectRootColumn = chatColumns.some((column) => column.name === 'project_root');
    if (!hasProjectRootColumn) {
      db.exec('ALTER TABLE chats ADD COLUMN project_root TEXT');
    }

    const projectColumns = db
      .prepare("SELECT name FROM pragma_table_info('projects')")
      .all() as Array<{ name: string }>;
    
    if (!projectColumns.some(c => c.name === 'description')) {
      db.exec('ALTER TABLE projects ADD COLUMN description TEXT');
    }
    if (!projectColumns.some(c => c.name === 'instructions')) {
      db.exec('ALTER TABLE projects ADD COLUMN instructions TEXT');
    }
    if (!projectColumns.some(c => c.name === 'memory')) {
      db.exec('ALTER TABLE projects ADD COLUMN memory TEXT');
    }
    if (!projectColumns.some(c => c.name === 'pinned')) {
      db.exec('ALTER TABLE projects ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
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

  static listChats(projectId?: string): ChatRecord[] {
    const db = this.getDb();

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

  static listMessages(chatId: string): MessageRecord[] {
    const db = this.getDb();
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
}
