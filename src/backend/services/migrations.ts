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
  }
];
