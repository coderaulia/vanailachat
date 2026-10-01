use super::models::SkillRecord;
use super::Database;
use crate::error::{AppError, AppResult};
use rusqlite::{params, OptionalExtension};

const COLUMNS: &str = "id, name, description, content, source_url, enabled, installed_at";

fn map_skill(row: &rusqlite::Row) -> rusqlite::Result<SkillRecord> {
    Ok(SkillRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        content: row.get(3)?,
        source_url: row.get(4)?,
        enabled: row.get::<_, i32>(5)? != 0,
        installed_at: row.get(6)?,
    })
}

impl Database {
    pub fn list_skills(&self) -> AppResult<Vec<SkillRecord>> {
        let mut stmt = self.conn.prepare(&format!("SELECT {COLUMNS} FROM skills ORDER BY name ASC"))?;
        let rows = stmt.query_map([], map_skill)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn list_enabled_skills(&self) -> AppResult<Vec<SkillRecord>> {
        let mut stmt = self
            .conn
            .prepare(&format!("SELECT {COLUMNS} FROM skills WHERE enabled = 1 ORDER BY name ASC"))?;
        let rows = stmt.query_map([], map_skill)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn get_skill_by_name(&self, name: &str) -> AppResult<Option<SkillRecord>> {
        Ok(self
            .conn
            .query_row(&format!("SELECT {COLUMNS} FROM skills WHERE name = ?1"), params![name], map_skill)
            .optional()?)
    }

    /// Installing a skill that already exists (same name) refreshes its text and keeps its id.
    pub fn upsert_skill(
        &self,
        id: &str,
        name: &str,
        description: Option<&str>,
        content: &str,
        source_url: Option<&str>,
        enabled: bool,
    ) -> AppResult<SkillRecord> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "INSERT INTO skills (id, name, description, content, source_url, enabled, installed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(name) DO UPDATE SET
                description = excluded.description,
                content = excluded.content,
                source_url = excluded.source_url,
                enabled = excluded.enabled",
            params![id, name, description, content, source_url, enabled as i32, now],
        )?;
        self.get_skill_by_name(name)?
            .ok_or_else(|| AppError::NotFound(format!("Skill '{name}' not found")))
    }

    pub fn set_skill_enabled(&self, id: &str, enabled: bool) -> AppResult<bool> {
        Ok(self.conn.execute("UPDATE skills SET enabled = ?1 WHERE id = ?2", params![enabled as i32, id])? > 0)
    }

    pub fn delete_skill(&self, id: &str) -> AppResult<bool> {
        Ok(self.conn.execute("DELETE FROM skills WHERE id = ?1", params![id])? > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_toggle_reinstall_and_delete() {
        let db = Database::in_memory().unwrap();
        let first = db.upsert_skill("skill_a", "writer", Some("Writes"), "v1", Some("https://x/SKILL.md"), true).unwrap();
        assert!(first.enabled);

        assert!(db.set_skill_enabled(&first.id, false).unwrap());
        assert!(db.list_enabled_skills().unwrap().is_empty());
        assert_eq!(db.list_skills().unwrap().len(), 1);

        // Reinstalling the same name refreshes the text, keeps the id, and re-enables it.
        let again = db.upsert_skill("skill_b", "writer", Some("Writes better"), "v2", None, true).unwrap();
        assert_eq!((again.id.as_str(), again.content.as_str(), again.enabled), ("skill_a", "v2", true));

        assert!(db.delete_skill(&again.id).unwrap());
        assert!(!db.delete_skill(&again.id).unwrap());
        assert!(db.get_skill_by_name("writer").unwrap().is_none());
    }
}
