import type { Database } from 'better-sqlite3';

export interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chats (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          model TEXT,
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
      `);
    }
  },
  {
    version: 2,
    name: 'add_chat_project_root_and_system_prompt',
    up: (db) => {
      db.exec(`
        ALTER TABLE chats ADD COLUMN project_root TEXT;
      `);
      db.exec(`
        ALTER TABLE chats ADD COLUMN system_prompt TEXT;
      `);
      db.exec(`
        ALTER TABLE chats ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
      `);
    }
  },
  {
    version: 3,
    name: 'add_project_fields',
    up: (db) => {
      db.exec(`
        ALTER TABLE projects ADD COLUMN description TEXT;
      `);
      db.exec(`
        ALTER TABLE projects ADD COLUMN instructions TEXT;
      `);
      db.exec(`
        ALTER TABLE projects ADD COLUMN memory TEXT;
      `);
      db.exec(`
        ALTER TABLE projects ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
      `);
    }
  },
  {
    version: 4,
    name: 'add_indexes',
    up: (db) => {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_chats_project_updated ON chats(project_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages(chat_id, created_at ASC);
      `);
    }
  },
  {
    version: 5,
    name: 'add_memories_table',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL DEFAULT 'conversation',
          content TEXT NOT NULL,
          embedding TEXT NOT NULL,
          metadata TEXT,
          source_id TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_memories_type_created ON memories(type, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source_id);
      `);
    }
  },
  {
    version: 6,
    name: 'add_settings_table',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
    }
  },
  {
    version: 7,
    name: 'add_skills_table',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS skills (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL,
          content TEXT NOT NULL,
          source_url TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          installed_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_skills_enabled ON skills(enabled);
      `);
    }
  },
  {
    version: 8,
    name: 'memories_blob_embedding',
    up: (db) => {
      // Recreate memories table with BLOB embedding (3-4x smaller, faster parse)
      db.exec(`
        CREATE TABLE IF NOT EXISTS memories_new (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL DEFAULT 'conversation',
          content TEXT NOT NULL,
          embedding BLOB NOT NULL,
          metadata TEXT,
          source_id TEXT,
          created_at INTEGER NOT NULL
        );
      `);

      // Migrate existing rows: JSON text → Float32Array → Buffer
      const rows = db.prepare(
        'SELECT id, type, content, embedding, metadata, source_id, created_at FROM memories'
      ).all() as Array<{
        id: string; type: string; content: string; embedding: string;
        metadata: string | null; source_id: string | null; created_at: number;
      }>;

      const insert = db.prepare(
        'INSERT OR IGNORE INTO memories_new (id, type, content, embedding, metadata, source_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      const insertAll = db.transaction(() => {
        for (const row of rows) {
          try {
            const arr = new Float32Array(JSON.parse(row.embedding));
            insert.run(row.id, row.type, row.content, Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength), row.metadata, row.source_id, row.created_at);
          } catch {
            // skip malformed embeddings
          }
        }
      });
      insertAll();

      db.exec(`
        DROP TABLE memories;
        ALTER TABLE memories_new RENAME TO memories;
        CREATE INDEX IF NOT EXISTS idx_memories_type_created ON memories(type, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source_id);
      `);
    }
  },
  {
    version: 9,
    name: 'message_feedback',
    up: (db) => {
      // Per-message thumbs-up/down + optional user-corrected text.
      // Drives the self-learning RAG layer: +1 messages get embedded into
      // memory, and the future fine-tune pipeline samples from rating != 0.
      db.exec(`
        CREATE TABLE IF NOT EXISTS message_feedback (
          message_id TEXT PRIMARY KEY,
          rating INTEGER NOT NULL DEFAULT 0,
          edited_content TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_message_feedback_rating ON message_feedback(rating, updated_at DESC);
      `);
    }
  }
];
