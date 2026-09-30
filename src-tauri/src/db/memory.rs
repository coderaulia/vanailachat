use super::models::{MemoryRecord, StoredMemory};
use super::Database;
use crate::error::AppResult;
use crate::services::memory::generate_memory_id;
use rusqlite::params;

fn vector_to_bytes(vector: &[f32]) -> Vec<u8> {
    vector.iter().flat_map(|v| v.to_le_bytes()).collect()
}

fn bytes_to_vector(bytes: &[u8]) -> Vec<f32> {
    bytes.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()
}

/// Oldest rows beyond this many are dropped. `MEMORY_TABLE_CAP` overrides (100..=100000).
fn memory_cap() -> i64 {
    std::env::var("MEMORY_TABLE_CAP")
        .ok()
        .and_then(|raw| raw.trim().parse::<i64>().ok())
        .map(|n| n.clamp(100, 100_000))
        .unwrap_or(5000)
}

impl Database {
    /// Stores a memory. The id is derived from the text, so saving the same
    /// thing twice updates one row. `embedding` is `None` when no embedding
    /// backend is reachable; the row is kept for keyword recall.
    pub fn upsert_memory(
        &self,
        kind: &str,
        content: &str,
        embedding: Option<&[f32]>,
        metadata: Option<&str>,
        source_id: Option<&str>,
    ) -> AppResult<MemoryRecord> {
        let id = generate_memory_id(kind, content);
        let now = chrono::Utc::now().timestamp_millis();
        let blob = embedding.map(vector_to_bytes).unwrap_or_default();
        self.conn.execute(
            "INSERT INTO memories (id, content, embedding, type, created_at, updated_at, embedding_blob, metadata, source_id)
             VALUES (?1, ?2, '', ?3, ?4, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
                content = excluded.content,
                embedding_blob = excluded.embedding_blob,
                metadata = excluded.metadata,
                source_id = excluded.source_id,
                updated_at = excluded.updated_at",
            params![id, content, kind, now, blob, metadata, source_id],
        )?;
        self.conn.execute(
            "DELETE FROM memories WHERE id IN (SELECT id FROM memories ORDER BY created_at DESC LIMIT -1 OFFSET ?1)",
            params![memory_cap()],
        )?;
        Ok(MemoryRecord {
            id,
            r#type: kind.to_string(),
            content: content.to_string(),
            embedding: String::new(),
            metadata: metadata.map(String::from),
            source_id: source_id.map(String::from),
            created_at: now,
        })
    }

    /// Newest first, like the web API.
    pub fn list_memories(&self, limit: Option<usize>) -> AppResult<Vec<MemoryRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, type, content, metadata, source_id, created_at FROM memories ORDER BY created_at DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit.map(|l| l as i64).unwrap_or(-1)], |row| {
            Ok(MemoryRecord {
                id: row.get(0)?,
                r#type: row.get(1)?,
                content: row.get(2)?,
                embedding: String::new(),
                metadata: row.get(3)?,
                source_id: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// The most recent memories with their vectors (empty when none was stored).
    pub fn memory_vectors(&self, limit: usize) -> AppResult<Vec<StoredMemory>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, content, metadata, created_at, embedding_blob FROM memories ORDER BY created_at DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit as i64], |row| {
            let blob: Option<Vec<u8>> = row.get(4)?;
            Ok(StoredMemory {
                id: row.get(0)?,
                content: row.get(1)?,
                metadata: row.get(2)?,
                created_at: row.get(3)?,
                vector: blob.map(|b| bytes_to_vector(&b)).unwrap_or_default(),
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn delete_memory(&self, id: &str) -> AppResult<bool> {
        Ok(self.conn.execute("DELETE FROM memories WHERE id = ?1", params![id])? > 0)
    }

    /// Forgets everything without touching chats; returns how many were removed.
    pub fn delete_all_memories(&self) -> AppResult<usize> {
        Ok(self.conn.execute("DELETE FROM memories", [])?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_dedupes_lists_and_forgets() {
        let db = Database::in_memory().unwrap();
        let first = db.upsert_memory("conversation", "I prefer tabs over spaces", Some(&[0.5, -0.25]), Some("{\"role\":\"user\"}"), Some("chat_1")).unwrap();
        // Same text, now without a vector: still one row.
        db.upsert_memory("conversation", "I prefer tabs over spaces", None, None, Some("chat_1")).unwrap();
        db.upsert_memory("manual", "Deploys go out on Fridays", None, None, None).unwrap();

        let listed = db.list_memories(None).unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed.iter().filter(|m| m.id == first.id).count(), 1);

        let vectors = db.memory_vectors(10).unwrap();
        assert!(vectors.iter().all(|m| m.vector.is_empty()), "the second save replaced the vector");

        assert!(db.delete_memory(&first.id).unwrap());
        assert_eq!(db.delete_all_memories().unwrap(), 1);
        assert!(db.list_memories(None).unwrap().is_empty());
    }

    #[test]
    fn vectors_round_trip_exactly() {
        let db = Database::in_memory().unwrap();
        db.upsert_memory("conversation", "vector round trip", Some(&[1.5, -2.0, 0.125]), None, None).unwrap();
        assert_eq!(db.memory_vectors(1).unwrap()[0].vector, vec![1.5, -2.0, 0.125]);
    }
}
