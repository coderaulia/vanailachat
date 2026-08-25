use rusqlite_migration::{Migrations, M};

pub fn get_migrations() -> Migrations<'static> {
    Migrations::new(vec![
        // V1: initial_schema
        M::up("
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS chats (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
        "),
        // V2: add_chat_project_root_and_system_prompt
        M::up("
            ALTER TABLE chats ADD COLUMN project_root TEXT;
            ALTER TABLE chats ADD COLUMN system_prompt TEXT;
            ALTER TABLE chats ADD COLUMN pinned INTEGER DEFAULT 0;
            ALTER TABLE chats ADD COLUMN model TEXT;
            ALTER TABLE chats ADD COLUMN role TEXT DEFAULT 'general';
        "),
        // V3: add_project_fields
        M::up("
            ALTER TABLE projects ADD COLUMN description TEXT;
            ALTER TABLE projects ADD COLUMN instructions TEXT;
            ALTER TABLE projects ADD COLUMN memory TEXT;
            ALTER TABLE projects ADD COLUMN pinned INTEGER DEFAULT 0;
        "),
        // V4: add_indexes
        M::up("
            CREATE INDEX IF NOT EXISTS idx_chats_project_updated ON chats(project_id, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages(chat_id, created_at ASC);
        "),
        // V5: add_memories_table
        M::up("
            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                embedding TEXT NOT NULL,
                type TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
        "),
        // V6: add_settings_table
        M::up("
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
        "),
        // V7: add_skills_table
        M::up("
            CREATE TABLE IF NOT EXISTS skills (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                description TEXT,
                content TEXT NOT NULL,
                source_url TEXT,
                enabled INTEGER DEFAULT 1,
                installed_at INTEGER NOT NULL
            );
        "),
        // V8: memories_blob_embedding
        M::up("
            ALTER TABLE memories ADD COLUMN embedding_blob BLOB;
        "),
        // V9: message_feedback
        M::up("
            CREATE TABLE IF NOT EXISTS message_feedback (
                message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
                rating INTEGER NOT NULL,
                edited_content TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
        "),
        // V10: message_feedback_implicit
        M::up("
            ALTER TABLE message_feedback ADD COLUMN implicit INTEGER DEFAULT 0;
        "),
        // V11: recency_sort_indexes
        M::up("
            CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_projects_created ON projects(created_at DESC);
        "),
        // V12: messages_fts
        M::up("
            CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
                content,
                content='messages',
                content_rowid='rowid'
            );
            CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
                INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
            END;
            CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
                INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
            END;
            CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
                INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
                INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
            END;
        "),
        // V13: dedupe_memories
        M::up("
            CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
        "),
        // V14: coding_harness_sessions
        M::up("
            CREATE TABLE IF NOT EXISTS coding_sessions (
                chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
                harness TEXT NOT NULL,
                harness_session_id TEXT,
                workspace_path TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
        "),
        // V15: migrate_openrouter_settings_isolation
        M::up("
            INSERT OR IGNORE INTO settings (key, value, updated_at)
            SELECT 'openrouter_api_key', value, updated_at FROM settings WHERE key = 'openai_api_key' AND value LIKE 'sk-or-%';
        "),
    ])
}
