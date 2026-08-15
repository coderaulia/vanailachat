import type { Database } from 'better-sqlite3';
import { memoryContentId } from './memoryId.js';

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
  },
  {
    version: 10,
    name: 'message_feedback_implicit',
    up: (db) => {
      // Track auto-positive ratings (heuristic) separately from explicit user thumbs.
      // implicit=1: rated by the auto-positive heuristic (long reply, no edit, next turn).
      // implicit=0: explicit thumbs-up/down from the user (default, existing rows).
      db.exec(`
        ALTER TABLE message_feedback ADD COLUMN implicit INTEGER NOT NULL DEFAULT 0;
      `);
      // Index for training export: implicit pairs can be excluded or weighted differently.
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_message_feedback_implicit ON message_feedback(implicit, rating);
      `);
    }
  },
  {
    version: 11,
    name: 'recency_sort_indexes',
    up: (db) => {
      // Vector search reads the most recent memories on every chat turn, but
      // idx_memories_type_created leads with `type` and cannot serve an
      // unfiltered sort — the plan was "SCAN memories | USE TEMP B-TREE FOR
      // ORDER BY" over a table that grows without bound.
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);
      `);
      // Same temp-B-tree sort on the project list, on a much smaller table.
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_projects_created ON projects(created_at ASC);
      `);
    }
  },
  {
    version: 12,
    name: 'messages_fts',
    up: (db) => {
      // Full-text index over message bodies. Sidebar search matched chat
      // titles only, so anything discussed inside a conversation was
      // unfindable once the title stopped describing it.
      //
      // contentless-delete FTS5 external-content table stays in sync with
      // `messages` through the triggers below rather than duplicating text.
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
          content,
          content='messages',
          content_rowid='rowid',
          tokenize='unicode61'
        );
      `);

      db.exec(`
        INSERT INTO messages_fts(rowid, content)
        SELECT rowid, content FROM messages;
      `);

      db.exec(`
        CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
          INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
        END;
        CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
        END;
        CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
          INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
        END;
      `);
    }
  },
  {
    version: 13,
    name: 'dedupe_memories',
    up: (db) => {
      // Memories were keyed by a random id, so the chat route storing the last
      // user message on every turn piled up copies of the same text — one real
      // database held 19 rows of a single question. Rows are re-keyed to a
      // content hash here so old rows collide with future writes instead of
      // producing one more duplicate, keeping the earliest copy of each.
      const rows = db
        .prepare('SELECT id, type, content, embedding, metadata, source_id, created_at FROM memories ORDER BY created_at ASC')
        .all() as Array<{
          id: string;
          type: string;
          content: string;
          embedding: Buffer;
          metadata: string | null;
          source_id: string | null;
          created_at: number;
        }>;

      if (rows.length === 0) return;

      const insert = db.prepare(
        `INSERT OR IGNORE INTO memories (id, type, content, embedding, metadata, source_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );

      db.exec('DELETE FROM memories');

      let kept = 0;
      for (const row of rows) {
        const result = insert.run(
          memoryContentId(row.type, row.content),
          row.type,
          row.content,
          row.embedding,
          row.metadata,
          row.source_id,
          row.created_at,
        );
        if (result.changes > 0) kept += 1;
      }

      console.log(`[DB] Deduplicated memories: ${rows.length} -> ${kept}`);
    }
  },
  {
    version: 14,
    name: 'coding_harness_sessions',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS coding_sessions (
          chat_id TEXT PRIMARY KEY,
          harness TEXT NOT NULL,
          harness_session_id TEXT,
          workspace_path TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ready',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
        );
      `);
    }
  }
];
