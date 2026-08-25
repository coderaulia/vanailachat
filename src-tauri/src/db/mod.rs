pub mod migrations;
pub mod models;

use crate::error::AppResult;
use models::*;
use rusqlite::{params, Connection};
use std::path::Path;

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn new<P: AsRef<Path>>(path: P) -> AppResult<Self> {
        let mut conn = Connection::open(path)?;
        
        // WAL mode & foreign keys for high performance and integrity
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;

        // Run migrations
        let migs = migrations::get_migrations();
        migs.to_latest(&mut conn)?;

        Ok(Self { conn })
    }

    pub fn in_memory() -> AppResult<Self> {
        let mut conn = Connection::open_in_memory()?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let migs = migrations::get_migrations();
        migs.to_latest(&mut conn)?;
        Ok(Self { conn })
    }

    // ── Projects CRUD ───────────────────────────────────────────────────

    pub fn list_projects(&self) -> AppResult<Vec<ProjectRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, description, instructions, memory, pinned, created_at, updated_at 
             FROM projects ORDER BY pinned DESC, updated_at DESC"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ProjectRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                instructions: row.get(3)?,
                memory: row.get(4)?,
                pinned: row.get::<_, i32>(5)? != 0,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?;

        let mut results = Vec::new();
        for r in rows {
            results.push(r?);
        }
        Ok(results)
    }

    pub fn create_project(&self, id: &str, name: &str, description: Option<&str>, instructions: Option<&str>) -> AppResult<ProjectRecord> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "INSERT INTO projects (id, name, description, instructions, created_at, updated_at) 
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, name, description, instructions, now, now],
        )?;
        Ok(ProjectRecord {
            id: id.to_string(),
            name: name.to_string(),
            description: description.map(|s| s.to_string()),
            instructions: instructions.map(|s| s.to_string()),
            memory: None,
            pinned: false,
            created_at: now,
            updated_at: now,
        })
    }

    pub fn delete_project(&self, id: &str) -> AppResult<bool> {
        let affected = self.conn.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
        Ok(affected > 0)
    }

    // ── Chats CRUD ──────────────────────────────────────────────────────

    pub fn list_chats(&self, project_id: Option<&str>, limit: Option<usize>) -> AppResult<Vec<ChatRecord>> {
        let lim = limit.unwrap_or(200) as i64;
        let mut results = Vec::new();

        if let Some(pid) = project_id {
            let mut stmt = self.conn.prepare(
                "SELECT id, title, project_id, project_root, system_prompt, pinned, model, role, created_at, updated_at 
                 FROM chats WHERE project_id = ?1 ORDER BY pinned DESC, updated_at DESC LIMIT ?2"
            )?;
            let rows = stmt.query_map(params![pid, lim], Self::map_chat_row)?;
            for r in rows {
                results.push(r?);
            }
        } else {
            let mut stmt = self.conn.prepare(
                "SELECT id, title, project_id, project_root, system_prompt, pinned, model, role, created_at, updated_at 
                 FROM chats ORDER BY pinned DESC, updated_at DESC LIMIT ?1"
            )?;
            let rows = stmt.query_map(params![lim], Self::map_chat_row)?;
            for r in rows {
                results.push(r?);
            }
        }
        Ok(results)
    }

    fn map_chat_row(row: &rusqlite::Row) -> rusqlite::Result<ChatRecord> {
        Ok(ChatRecord {
            id: row.get(0)?,
            title: row.get(1)?,
            project_id: row.get(2)?,
            project_root: row.get(3)?,
            system_prompt: row.get(4)?,
            pinned: row.get::<_, i32>(5)? != 0,
            model: row.get(6)?,
            role: row.get(7)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
        })
    }

    pub fn upsert_chat(
        &self,
        id: &str,
        title: &str,
        project_id: Option<&str>,
        project_root: Option<&str>,
        system_prompt: Option<&str>,
        model: Option<&str>,
        role: Option<&str>,
    ) -> AppResult<ChatRecord> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "INSERT INTO chats (id, title, project_id, project_root, system_prompt, model, role, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
             ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                project_id = COALESCE(excluded.project_id, chats.project_id),
                project_root = COALESCE(excluded.project_root, chats.project_root),
                system_prompt = COALESCE(excluded.system_prompt, chats.system_prompt),
                model = COALESCE(excluded.model, chats.model),
                role = COALESCE(excluded.role, chats.role),
                updated_at = excluded.updated_at",
            params![id, title, project_id, project_root, system_prompt, model, role, now],
        )?;

        Ok(ChatRecord {
            id: id.to_string(),
            title: title.to_string(),
            project_id: project_id.map(|s| s.to_string()),
            project_root: project_root.map(|s| s.to_string()),
            system_prompt: system_prompt.map(|s| s.to_string()),
            pinned: false,
            model: model.map(|s| s.to_string()),
            role: role.map(|s| s.to_string()),
            created_at: now,
            updated_at: now,
        })
    }

    pub fn delete_chat(&self, id: &str) -> AppResult<bool> {
        let affected = self.conn.execute("DELETE FROM chats WHERE id = ?1", params![id])?;
        Ok(affected > 0)
    }

    // ── Messages CRUD & FTS5 Search ─────────────────────────────────────

    pub fn list_messages(&self, chat_id: &str, limit: Option<usize>) -> AppResult<Vec<MessageRecord>> {
        let lim = limit.unwrap_or(500) as i64;
        let mut stmt = self.conn.prepare(
            "SELECT id, chat_id, role, content, created_at FROM messages 
             WHERE chat_id = ?1 ORDER BY created_at ASC LIMIT ?2"
        )?;
        let rows = stmt.query_map(params![chat_id, lim], |row| {
            Ok(MessageRecord {
                id: row.get(0)?,
                chat_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?;

        let mut results = Vec::new();
        for r in rows {
            results.push(r?);
        }
        Ok(results)
    }

    pub fn save_message(&self, id: &str, chat_id: &str, role: &str, content: &str) -> AppResult<MessageRecord> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, chat_id, role, content, now],
        )?;

        // Update parent chat updated_at
        self.conn.execute(
            "UPDATE chats SET updated_at = ?1 WHERE id = ?2",
            params![now, chat_id],
        )?;

        Ok(MessageRecord {
            id: id.to_string(),
            chat_id: chat_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            created_at: now,
        })
    }

    pub fn search_messages(&self, query: &str, limit: Option<usize>) -> AppResult<Vec<MessageRecord>> {
        let lim = limit.unwrap_or(50) as i64;
        let mut stmt = self.conn.prepare(
            "SELECT m.id, m.chat_id, m.role, m.content, m.created_at 
             FROM messages m
             JOIN messages_fts fts ON m.rowid = fts.rowid
             WHERE messages_fts MATCH ?1
             ORDER BY rank LIMIT ?2"
        )?;
        let rows = stmt.query_map(params![query, lim], |row| {
            Ok(MessageRecord {
                id: row.get(0)?,
                chat_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?;

        let mut results = Vec::new();
        for r in rows {
            results.push(r?);
        }
        Ok(results)
    }

    // ── Settings CRUD ───────────────────────────────────────────────────

    pub fn get_all_settings(&self) -> AppResult<std::collections::HashMap<String, String>> {
        let mut stmt = self.conn.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        let mut map = std::collections::HashMap::new();
        for r in rows {
            let (k, v) = r?;
            map.insert(k, v);
        }
        Ok(map)
    }

    pub fn get_setting(&self, key: &str) -> AppResult<Option<String>> {
        let mut stmt = self.conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query_map(params![key], |row| row.get(0))?;
        if let Some(r) = rows.next() {
            Ok(Some(r?))
        } else {
            Ok(None)
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> AppResult<()> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, value, now],
        )?;
        Ok(())
    }

    // ── Skills & Feedback ───────────────────────────────────────────────

    pub fn list_skills(&self) -> AppResult<Vec<SkillRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, description, content, source_url, enabled, installed_at FROM skills ORDER BY name ASC"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(SkillRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                content: row.get(3)?,
                source_url: row.get(4)?,
                enabled: row.get::<_, i32>(5)? != 0,
                installed_at: row.get(6)?,
            })
        })?;

        let mut results = Vec::new();
        for r in rows {
            results.push(r?);
        }
        Ok(results)
    }

    pub fn upsert_skill(
        &self,
        id: &str,
        name: &str,
        description: Option<&str>,
        content: &str,
        source_url: Option<&str>,
    ) -> AppResult<SkillRecord> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "INSERT INTO skills (id, name, description, content, source_url, enabled, installed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)
             ON CONFLICT(name) DO UPDATE SET
                description = excluded.description,
                content = excluded.content,
                source_url = excluded.source_url",
            params![id, name, description, content, source_url, now],
        )?;

        Ok(SkillRecord {
            id: id.to_string(),
            name: name.to_string(),
            description: description.map(|s| s.to_string()),
            content: content.to_string(),
            source_url: source_url.map(|s| s.to_string()),
            enabled: true,
            installed_at: now,
        })
    }

    pub fn set_feedback(&self, message_id: &str, rating: i32, edited_content: Option<&str>, implicit: bool) -> AppResult<()> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "INSERT INTO message_feedback (message_id, rating, edited_content, implicit, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)
             ON CONFLICT(message_id) DO UPDATE SET
                rating = excluded.rating,
                edited_content = excluded.edited_content,
                implicit = excluded.implicit,
                updated_at = excluded.updated_at",
            params![message_id, rating, edited_content, implicit as i32, now],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_migrations_and_crud() {
        let db = Database::in_memory().expect("in-memory db initialization failed");

        // 1. Projects
        let proj = db.create_project("p1", "Test Project", Some("Desc"), None).expect("create project failed");
        assert_eq!(proj.name, "Test Project");

        let projs = db.list_projects().expect("list projects failed");
        assert_eq!(projs.len(), 1);

        // 2. Chats
        let chat = db.upsert_chat("c1", "Test Chat", Some("p1"), None, None, Some("ollama:llama3"), Some("general")).expect("upsert chat failed");
        assert_eq!(chat.title, "Test Chat");

        let chats = db.list_chats(None, None).expect("list chats failed");
        assert_eq!(chats.len(), 1);

        // 3. Messages & FTS5
        db.save_message("m1", "c1", "user", "Hello Vanaila Desktop!").expect("save message failed");
        db.save_message("m2", "c1", "assistant", "Hello! How can I help you today?").expect("save assistant failed");

        let msgs = db.list_messages("c1", None).expect("list messages failed");
        assert_eq!(msgs.len(), 2);

        let search_res = db.search_messages("Desktop", None).expect("FTS5 search failed");
        assert_eq!(search_res.len(), 1);
        assert_eq!(search_res[0].id, "m1");

        // 4. Settings
        db.set_setting("theme", "dark").expect("set setting failed");
        let theme = db.get_setting("theme").expect("get setting failed");
        assert_eq!(theme.as_deref(), Some("dark"));
    }
}

