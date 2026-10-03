pub mod memory;
pub mod migrations;
pub mod models;
pub mod skills;

use crate::error::AppResult;
use models::*;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Path, PathBuf};

const MAX_MIGRATION_BACKUPS: usize = 5;

/// Message columns plus the size of the message's regenerate group.
const MESSAGE_COLUMNS: &str = "m.id, m.chat_id, m.role, m.content, m.created_at, m.version_of,
    (SELECT COUNT(*) FROM messages v
      WHERE v.id = COALESCE(m.version_of, m.id) OR v.version_of = COALESCE(m.version_of, m.id))";

/// Snapshots an existing database before pending migrations run, keeping the
/// newest few. A failed backup is logged rather than blocking startup.
pub fn backup_before_migrations(conn: &Connection, db_path: &Path, target_version: usize) -> Option<PathBuf> {
    let dir = db_path.parent()?.join("backups");
    let stem = db_path.file_stem()?.to_string_lossy().to_string();
    let stamp = chrono::Utc::now().format("%Y-%m-%dT%H-%M-%S-%3fZ");
    let backup = dir.join(format!("{stem}-pre-v{target_version}-{stamp}.sqlite"));

    let result = std::fs::create_dir_all(&dir)
        .map_err(|e| e.to_string())
        .and_then(|_| {
            conn.execute("VACUUM INTO ?1", [backup.to_string_lossy()])
                .map_err(|e| e.to_string())
        });
    if let Err(e) = result {
        eprintln!("[warn] Pre-migration backup failed; continuing without one: {e}");
        return None;
    }

    if let Ok(entries) = std::fs::read_dir(&dir) {
        let mut snapshots: Vec<(std::time::SystemTime, PathBuf)> = entries
            .flatten()
            .filter(|entry| {
                let name = entry.file_name().to_string_lossy().to_string();
                name.contains("-pre-v") && name.ends_with(".sqlite")
            })
            .filter_map(|entry| Some((entry.metadata().ok()?.modified().ok()?, entry.path())))
            .collect();
        snapshots.sort_by(|a, b| b.0.cmp(&a.0));
        for (_, old) in snapshots.into_iter().skip(MAX_MIGRATION_BACKUPS) {
            let _ = std::fs::remove_file(old);
        }
    }
    Some(backup)
}

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn new<P: AsRef<Path>>(path: P) -> AppResult<Self> {
        let mut conn = Connection::open(path.as_ref())?;
        
        // WAL mode & foreign keys for high performance and integrity
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;

        // Run migrations, snapshotting existing data first when any are pending
        let migs = migrations::get_migrations();
        let current: usize = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
        let latest = migrations::latest_version();
        if current > 0 && current < latest {
            backup_before_migrations(&conn, path.as_ref(), latest);
        }
        migs.to_latest(&mut conn)?;

        let db = Self { conn };
        db.ensure_default_project()?;
        Ok(db)
    }

    pub fn in_memory() -> AppResult<Self> {
        let mut conn = Connection::open_in_memory()?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let migs = migrations::get_migrations();
        migs.to_latest(&mut conn)?;
        let db = Self { conn };
        db.ensure_default_project()?;
        Ok(db)
    }

    // ── Projects CRUD ───────────────────────────────────────────────────

    const PROJECT_COLUMNS: &'static str =
        "id, name, description, instructions, memory, pinned, created_at, updated_at, project_root";

    fn map_project_row(row: &rusqlite::Row) -> rusqlite::Result<ProjectRecord> {
        Ok(ProjectRecord {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            instructions: row.get(3)?,
            memory: row.get(4)?,
            pinned: row.get::<_, i32>(5)? != 0,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
            project_root: row.get(8)?,
        })
    }

    /// Oldest first, like the web backend, so the first project is the default one.
    pub fn list_projects(&self) -> AppResult<Vec<ProjectRecord>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {} FROM projects ORDER BY created_at ASC, rowid ASC",
            Self::PROJECT_COLUMNS
        ))?;
        let rows = stmt.query_map([], Self::map_project_row)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// Returns the oldest project, creating "Default" on a fresh database. Chats
    /// reference a project by foreign key, so one must always exist.
    pub fn ensure_default_project(&self) -> AppResult<ProjectRecord> {
        if let Some(first) = self.list_projects()?.into_iter().next() {
            return Ok(first);
        }
        self.create_project(&format!("project_{}", uuid::Uuid::new_v4()), "Default", None, None, None)
    }

    pub fn create_project(
        &self,
        id: &str,
        name: &str,
        description: Option<&str>,
        instructions: Option<&str>,
        project_root: Option<&str>,
    ) -> AppResult<ProjectRecord> {
        let now = chrono::Utc::now().timestamp_millis();
        let project_root = project_root.map(str::trim).filter(|root| !root.is_empty());
        self.conn.execute(
            "INSERT INTO projects (id, name, description, instructions, project_root, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params![id, name, description, instructions, project_root, now],
        )?;
        self.get_project(id)?
            .ok_or_else(|| crate::error::AppError::NotFound(format!("Project '{id}' not found")))
    }

    pub fn get_project(&self, id: &str) -> AppResult<Option<ProjectRecord>> {
        let mut stmt = self
            .conn
            .prepare(&format!("SELECT {} FROM projects WHERE id = ?1", Self::PROJECT_COLUMNS))?;
        let mut rows = stmt.query_map(params![id], Self::map_project_row)?;
        Ok(rows.next().transpose()?)
    }

    /// `project_root`: `None` leaves the binding alone, `Some(None)` unbinds it.
    pub fn update_project(
        &self,
        id: &str,
        name: Option<&str>,
        description: Option<&str>,
        instructions: Option<&str>,
        memory: Option<&str>,
        pinned: Option<bool>,
        project_root: Option<Option<&str>>,
    ) -> AppResult<Option<ProjectRecord>> {
        let existing = match self.get_project(id)? {
            Some(p) => p,
            None => return Ok(None),
        };

        let new_name = name.filter(|n| !n.trim().is_empty()).unwrap_or(&existing.name);
        let new_description = description.or(existing.description.as_deref());
        let new_instructions = instructions.or(existing.instructions.as_deref());
        let new_memory = memory.or(existing.memory.as_deref());
        let new_pinned = pinned.unwrap_or(existing.pinned);
        let new_root = match project_root {
            Some(root) => root.map(str::trim).filter(|r| !r.is_empty()),
            None => existing.project_root.as_deref(),
        };
        let now = chrono::Utc::now().timestamp_millis();

        self.conn.execute(
            "UPDATE projects SET name = ?1, description = ?2, instructions = ?3, memory = ?4, pinned = ?5,
                                 project_root = ?6, updated_at = ?7 WHERE id = ?8",
            params![new_name, new_description, new_instructions, new_memory, if new_pinned { 1 } else { 0 }, new_root, now, id],
        )?;

        self.get_project(id)
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
                "SELECT id, title, project_id, project_root, system_prompt, pinned, model, role, created_at, updated_at, archived
                 FROM chats WHERE project_id = ?1 ORDER BY pinned DESC, updated_at DESC LIMIT ?2"
            )?;
            let rows = stmt.query_map(params![pid, lim], Self::map_chat_row)?;
            for r in rows {
                results.push(r?);
            }
        } else {
            let mut stmt = self.conn.prepare(
                "SELECT id, title, project_id, project_root, system_prompt, pinned, model, role, created_at, updated_at, archived
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
            archived: row.get::<_, i32>(10)? != 0,
        })
    }

    pub fn get_chat(&self, id: &str) -> AppResult<Option<ChatRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, project_id, project_root, system_prompt, pinned, model, role, created_at, updated_at, archived
             FROM chats WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], Self::map_chat_row)?;
        Ok(rows.next().transpose()?)
    }

    /// Applies only the fields present in `patch`, like the web `PATCH /api/chats/:id`.
    pub fn patch_chat(&self, id: &str, patch: &ChatPatch) -> AppResult<Option<ChatRecord>> {
        let Some(existing) = self.get_chat(id)? else {
            return Ok(None);
        };
        let pick = |new: &Option<Option<String>>, old: &Option<String>| match new {
            Some(value) => value.clone(),
            None => old.clone(),
        };
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "UPDATE chats SET title = ?2, project_id = ?3, project_root = ?4, system_prompt = ?5, model = ?6,
                              role = ?7, pinned = ?8, archived = ?9, updated_at = ?10
             WHERE id = ?1",
            params![
                id,
                patch.title.clone().unwrap_or(existing.title),
                pick(&patch.project_id, &existing.project_id),
                pick(&patch.project_root, &existing.project_root),
                pick(&patch.system_prompt, &existing.system_prompt),
                pick(&patch.model, &existing.model),
                pick(&patch.role, &existing.role),
                patch.pinned.unwrap_or(existing.pinned) as i32,
                patch.archived.unwrap_or(existing.archived) as i32,
                patch.updated_at.unwrap_or(now),
            ],
        )?;
        self.get_chat(id)
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
        // The UI sends "default" (or nothing) before any project exists; a
        // dangling id would fail the foreign key and lose the chat.
        let resolved_project = match project_id {
            Some(pid) if self.get_project(pid)?.is_some() => Some(pid.to_string()),
            _ => Some(self.ensure_default_project()?.id),
        };
        let project_id = resolved_project.as_deref();
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

        self.get_chat(id)?
            .ok_or_else(|| crate::error::AppError::NotFound(format!("Chat '{id}' not found")))
    }

    pub fn delete_chat(&self, id: &str) -> AppResult<bool> {
        let affected = self.conn.execute("DELETE FROM chats WHERE id = ?1", params![id])?;
        Ok(affected > 0)
    }

    // ── Messages CRUD & FTS5 Search ─────────────────────────────────────

    /// Live messages for a chat, oldest first; superseded ones (replaced by a
    /// regenerate or edit) are left out. `limit` keeps the newest N.
    pub fn list_messages(&self, chat_id: &str, limit: Option<usize>) -> AppResult<Vec<MessageRecord>> {
        let lim = limit.unwrap_or(500) as i64;
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {MESSAGE_COLUMNS} FROM messages m
             WHERE m.chat_id = ?1 AND m.superseded_at IS NULL
             ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?2"
        ))?;
        let mut results = stmt
            .query_map(params![chat_id, lim], Self::map_message_row)?
            .collect::<Result<Vec<_>, _>>()?;
        results.reverse();
        Ok(results)
    }

    pub fn get_message(&self, id: &str) -> AppResult<Option<MessageRecord>> {
        let mut stmt = self.conn.prepare(&format!("SELECT {MESSAGE_COLUMNS} FROM messages m WHERE m.id = ?1"))?;
        let mut rows = stmt.query_map(params![id], Self::map_message_row)?;
        Ok(rows.next().transpose()?)
    }

    fn map_message_row(row: &rusqlite::Row) -> rusqlite::Result<MessageRecord> {
        Ok(MessageRecord {
            id: row.get(0)?,
            chat_id: row.get(1)?,
            role: row.get(2)?,
            content: row.get(3)?,
            created_at: row.get(4)?,
            version_of: row.get(5)?,
            version_count: row.get(6)?,
        })
    }

    pub fn save_message(
        &self,
        id: &str,
        chat_id: &str,
        role: &str,
        content: &str,
        created_at: Option<i64>,
        version_of: Option<&str>,
    ) -> AppResult<MessageRecord> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "INSERT INTO messages (id, chat_id, role, content, created_at, version_of) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
                role = excluded.role,
                content = excluded.content,
                version_of = COALESCE(excluded.version_of, messages.version_of),
                superseded_at = NULL",
            params![id, chat_id, role, content, created_at.unwrap_or(now), version_of],
        )?;

        // Update parent chat updated_at
        self.conn.execute(
            "UPDATE chats SET updated_at = ?1 WHERE id = ?2",
            params![now, chat_id],
        )?;

        self.get_message(id)?
            .ok_or_else(|| crate::error::AppError::NotFound(format!("Message '{id}' not found")))
    }

    /// Hides `from_message_id` and every later live message in its chat, as a
    /// regenerate or edit replaces them. Rows are kept so earlier answers stay browsable.
    pub fn supersede_messages_from(&self, chat_id: &str, from_message_id: &str) -> AppResult<usize> {
        let from = self
            .conn
            .query_row(
                "SELECT rowid, created_at FROM messages WHERE id = ?1 AND chat_id = ?2",
                params![from_message_id, chat_id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()?;
        let Some((rowid, created_at)) = from else {
            return Ok(0);
        };
        let changed = self.conn.execute(
            "UPDATE messages SET superseded_at = ?1
             WHERE chat_id = ?2 AND superseded_at IS NULL
               AND (created_at > ?3 OR (created_at = ?3 AND rowid >= ?4))",
            params![chrono::Utc::now().timestamp_millis(), chat_id, created_at, rowid],
        )?;
        Ok(changed)
    }

    /// Every answer in a message's regenerate group, oldest first.
    pub fn list_message_versions(&self, message_id: &str) -> AppResult<Vec<MessageVersion>> {
        let root: Option<String> = self
            .conn
            .query_row(
                "SELECT COALESCE(version_of, id) FROM messages WHERE id = ?1",
                params![message_id],
                |row| row.get(0),
            )
            .optional()?;
        let Some(root) = root else {
            return Ok(Vec::new());
        };
        let mut stmt = self.conn.prepare(
            "SELECT id, content, created_at, superseded_at IS NULL FROM messages
             WHERE id = ?1 OR version_of = ?1 ORDER BY created_at ASC, rowid ASC",
        )?;
        let rows = stmt.query_map(params![root], |row| {
            Ok(MessageVersion {
                id: row.get(0)?,
                content: row.get(1)?,
                created_at: row.get(2)?,
                current: row.get(3)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// Full-text search over message bodies, matching the web backend's
    /// `searchMessages`: each word is quoted so arbitrary typing (quotes,
    /// `AND`, parentheses) cannot raise an FTS5 syntax error.
    pub fn search_messages(
        &self,
        query: &str,
        limit: Option<usize>,
        project_id: Option<&str>,
    ) -> AppResult<Vec<MessageSearchHit>> {
        let lowered = query.to_lowercase();
        let terms: Vec<String> = lowered
            .split(|c: char| !c.is_alphanumeric())
            .filter(|term| term.chars().count() > 1)
            .map(|term| format!("\"{term}\""))
            .collect();
        if terms.is_empty() {
            return Ok(Vec::new());
        }
        let match_expression = terms.join(" AND ");
        let lim = limit.unwrap_or(30) as i64;

        let mut stmt = self.conn.prepare(
            "SELECT m.id, m.chat_id, m.role, m.created_at, c.title, c.project_id,
                    snippet(messages_fts, 0, '', '', '…', 12)
             FROM messages_fts
             JOIN messages m ON m.rowid = messages_fts.rowid
             JOIN chats c ON c.id = m.chat_id
             WHERE messages_fts MATCH ?1 AND m.superseded_at IS NULL AND (?2 IS NULL OR c.project_id = ?2)
             ORDER BY bm25(messages_fts)
             LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![match_expression, project_id, lim], |row| {
            Ok(MessageSearchHit {
                message_id: row.get(0)?,
                chat_id: row.get(1)?,
                role: row.get(2)?,
                created_at: row.get(3)?,
                chat_title: row.get(4)?,
                project_id: row.get(5)?,
                snippet: row.get(6)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

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

    pub fn get_feedback(&self, message_id: &str) -> AppResult<Option<FeedbackRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT message_id, rating, edited_content, COALESCE(implicit, 0), created_at, updated_at
             FROM message_feedback WHERE message_id = ?1",
        )?;
        let mut rows = stmt.query_map(params![message_id], |row| {
            Ok(FeedbackRecord {
                message_id: row.get(0)?,
                rating: row.get(1)?,
                edited_content: row.get(2)?,
                implicit: row.get::<_, i32>(3)? != 0,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?;
        Ok(rows.next().transpose()?)
    }

    pub fn list_training_examples(&self) -> AppResult<Vec<TrainingExample>> {
        let mut stmt = self.conn.prepare(
            "SELECT f.message_id, m.chat_id, c.title, previous.content,
                    COALESCE(f.edited_content, m.content), f.rating,
                    f.edited_content IS NOT NULL, f.created_at
             FROM message_feedback f
             JOIN messages m ON m.id = f.message_id
             JOIN chats c ON c.id = m.chat_id
             JOIN messages previous ON previous.chat_id = m.chat_id
               AND previous.role = 'user'
               AND previous.created_at < m.created_at
             WHERE f.rating > 0
               AND previous.created_at = (
                 SELECT MAX(candidate.created_at) FROM messages candidate
                 WHERE candidate.chat_id = m.chat_id
                   AND candidate.role = 'user'
                   AND candidate.created_at < m.created_at
               )
             ORDER BY f.created_at ASC"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(TrainingExample {
                id: row.get(0)?,
                chat_id: row.get(1)?,
                chat_title: row.get(2)?,
                user_content: row.get(3)?,
                assistant_content: row.get(4)?,
                rating: row.get(5)?,
                edited: row.get::<_, i32>(6)? != 0,
                created_at: row.get(7)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn get_coding_session(&self, chat_id: &str) -> AppResult<Option<CodingSessionRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT chat_id, harness, harness_session_id, workspace_path, status, created_at, updated_at
             FROM coding_sessions WHERE chat_id = ?1"
        )?;
        let mut rows = stmt.query_map(params![chat_id], |row| Ok(CodingSessionRecord {
            chat_id: row.get(0)?, harness: row.get(1)?, harness_session_id: row.get(2)?,
            workspace_path: row.get(3)?, status: row.get(4)?, created_at: row.get(5)?, updated_at: row.get(6)?,
        }))?;
        rows.next().transpose().map_err(Into::into)
    }

    pub fn upsert_coding_session(&self, session: &CodingSessionRecord) -> AppResult<CodingSessionRecord> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "INSERT INTO coding_sessions (chat_id, harness, harness_session_id, workspace_path, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
             ON CONFLICT(chat_id) DO UPDATE SET harness = excluded.harness,
               harness_session_id = COALESCE(excluded.harness_session_id, coding_sessions.harness_session_id),
               workspace_path = excluded.workspace_path, status = excluded.status, updated_at = excluded.updated_at",
            params![session.chat_id, session.harness, session.harness_session_id, session.workspace_path, session.status, now],
        )?;
        self.get_coding_session(&session.chat_id)?.ok_or_else(|| crate::error::AppError::NotFound("Coding session was not saved".into()))
    }

    /// A turn that was running when the app closed or crashed never finished; without this its session stays "running" forever.
    pub fn reset_running_coding_sessions(&self) -> AppResult<usize> {
        Ok(self.conn.execute("UPDATE coding_sessions SET status = 'ready' WHERE status = 'running'", [])?)
    }

}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_migrations_and_crud() {
        let db = Database::in_memory().expect("in-memory db initialization failed");

        // 1. Projects
        let proj = db.create_project("p1", "Test Project", Some("Desc"), None, None).expect("create project failed");
        assert_eq!(proj.name, "Test Project");

        let projs = db.list_projects().expect("list projects failed");
        assert_eq!(projs.len(), 2, "the default project plus the new one");
        assert_eq!(projs[0].name, "Default");

        // 2. Chats
        let chat = db.upsert_chat("c1", "Test Chat", Some("p1"), None, None, Some("ollama:llama3"), Some("general")).expect("upsert chat failed");
        assert_eq!(chat.title, "Test Chat");

        let chats = db.list_chats(None, None).expect("list chats failed");
        assert_eq!(chats.len(), 1);

        // 3. Messages & FTS5
        db.save_message("m1", "c1", "user", "Hello Vanaila Desktop!", Some(1), None).expect("save message failed");
        db.save_message("m2", "c1", "assistant", "Hello! How can I help you today?", Some(2), None).expect("save assistant failed");

        let msgs = db.list_messages("c1", None).expect("list messages failed");
        assert_eq!(msgs.len(), 2);

        let session = CodingSessionRecord {
            chat_id: "c1".to_string(),
            harness: "pi-harness".to_string(),
            harness_session_id: None,
            workspace_path: "/tmp".to_string(),
            status: "ready".to_string(),
            created_at: 0,
            updated_at: 0,
        };
        let saved = db.upsert_coding_session(&session).expect("save coding session failed");
        assert_eq!(saved.harness, "pi-harness");
        assert_eq!(db.get_coding_session("c1").expect("load coding session failed").unwrap().workspace_path, "/tmp");

        let search_res = db.search_messages("Desktop", None, None).expect("FTS5 search failed");
        assert_eq!(search_res.len(), 1);
        assert_eq!(search_res[0].message_id, "m1");
        assert_eq!(search_res[0].chat_title, "Test Chat");
        assert!(db.search_messages("\"unbalanced AND (", None, None).is_ok());

        db.set_feedback("m2", 1, None, false).expect("set feedback failed");
        assert_eq!(db.get_feedback("m2").unwrap().unwrap().rating, 1);
        assert!(db.get_feedback("m1").unwrap().is_none());
        assert!(db.search_messages("desktop", None, Some("other-project")).unwrap().is_empty());

        // 4. Settings
        db.set_setting("theme", "dark").expect("set setting failed");
        let theme = db.get_setting("theme").expect("get setting failed");
        assert_eq!(theme.as_deref(), Some("dark"));
    }

    #[test]
    fn test_backup_before_pending_migrations() {
        let dir = std::env::temp_dir().join(format!("vanaila-mig-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("vanaila.sqlite");

        // Brand-new database: nothing to back up.
        let fresh_path = dir.join("fresh.sqlite");
        Database::new(&fresh_path).expect("fresh db failed");
        assert!(!dir.join("backups").exists());

        // A database one release behind: every migration but the last.
        let mut conn = Connection::open(&db_path).unwrap();
        migrations::get_migrations()
            .to_version(&mut conn, migrations::latest_version() - 1)
            .unwrap();
        conn.execute("INSERT INTO settings (key, value, updated_at) VALUES ('user_name', 'Alex', 0)", [])
            .unwrap();
        drop(conn);

        Database::new(&db_path).expect("reopen failed");
        let backups: Vec<_> = std::fs::read_dir(dir.join("backups")).unwrap().flatten().collect();
        assert_eq!(backups.len(), 1);
        let snapshot = Connection::open(backups[0].path()).unwrap();
        let name: String = snapshot
            .query_row("SELECT value FROM settings WHERE key = 'user_name'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(name, "Alex");

        // Pruning keeps the newest five.
        let conn = Connection::open(&db_path).unwrap();
        for version in 1..=7 {
            backup_before_migrations(&conn, &db_path, version);
        }
        assert_eq!(std::fs::read_dir(dir.join("backups")).unwrap().count(), MAX_MIGRATION_BACKUPS);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_regenerate_history_and_archive() {
        let db = Database::in_memory().unwrap();
        db.create_project("p1", "P", None, None, None).unwrap();
        db.upsert_chat("c1", "Chat", Some("p1"), None, None, None, None).unwrap();
        db.save_message("u1", "c1", "user", "question", Some(1), None).unwrap();
        db.save_message("a1", "c1", "assistant", "first", Some(2), None).unwrap();
        db.save_message("u2", "c1", "user", "follow-up", Some(3), None).unwrap();

        assert_eq!(db.supersede_messages_from("c1", "a1").unwrap(), 2);
        let retry = db.save_message("a1b", "c1", "assistant", "second", Some(4), Some("a1")).unwrap();
        assert_eq!(retry.version_count, 2);

        let live: Vec<String> = db.list_messages("c1", None).unwrap().into_iter().map(|m| m.id).collect();
        assert_eq!(live, vec!["u1", "a1b"]);
        let versions = db.list_message_versions("a1b").unwrap();
        assert_eq!(versions.iter().map(|v| v.content.as_str()).collect::<Vec<_>>(), vec!["first", "second"]);
        assert_eq!(versions.iter().map(|v| v.current).collect::<Vec<_>>(), vec![false, true]);
        assert!(db.search_messages("follow", None, None).unwrap().is_empty());

        let archived = db
            .patch_chat("c1", &ChatPatch { archived: Some(true), ..Default::default() })
            .unwrap()
            .unwrap();
        assert!(archived.archived);
        assert_eq!(archived.title, "Chat");
        let renamed = db
            .patch_chat("c1", &ChatPatch { title: Some("Renamed".into()), pinned: Some(true), ..Default::default() })
            .unwrap()
            .unwrap();
        assert!(renamed.archived && renamed.pinned);
        assert_eq!(renamed.project_id.as_deref(), Some("p1"));
        let cleared: ChatPatch = serde_json::from_str(r#"{"systemPrompt": null}"#).unwrap();
        assert_eq!(cleared.system_prompt, Some(None));
        let untouched: ChatPatch = serde_json::from_str("{}").unwrap();
        assert_eq!(untouched.system_prompt, None);
    }

    #[test]
    fn test_default_project_and_workspace_binding() {
        let db = Database::in_memory().unwrap();
        let default = db.list_projects().unwrap();
        assert_eq!(default.len(), 1);

        // A chat for a project that does not exist lands in the default one
        // instead of failing the foreign key.
        let chat = db.upsert_chat("c1", "First", Some("default"), None, None, None, None).unwrap();
        assert_eq!(chat.project_id.as_deref(), Some(default[0].id.as_str()));

        let bound = db.create_project("p1", "Repo", None, None, Some("  /work/repo ")).unwrap();
        assert_eq!(bound.project_root.as_deref(), Some("/work/repo"));
        let kept = db.update_project("p1", Some("Renamed"), None, None, None, None, None).unwrap().unwrap();
        assert_eq!(kept.project_root.as_deref(), Some("/work/repo"));
        let cleared = db.update_project("p1", None, None, None, None, None, Some(None)).unwrap().unwrap();
        assert_eq!(cleared.project_root, None);
        assert_eq!(cleared.name, "Renamed");
    }
}
