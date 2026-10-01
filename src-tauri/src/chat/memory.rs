//! Recall before answering, then remember what the user said.

use crate::db::models::ChatRecord;
use crate::db::Database;
use crate::providers::ollama::OllamaProvider;
use crate::services::memory::{search_by_keyword, search_with_vector, ScoredMemory, RECALL_WINDOW};
use async_trait::async_trait;
use parking_lot::Mutex;
use serde_json::json;
use std::sync::Arc;

#[async_trait]
pub trait Embedder: Send + Sync {
    async fn embed(&self, text: &str) -> Option<Vec<f32>>;
}

#[async_trait]
impl Embedder for OllamaProvider {
    async fn embed(&self, text: &str) -> Option<Vec<f32>> {
        self.embed_or_none(text).await
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Memories relevant to `user_text` (vector search when embeddings work, keyword
/// search when they do not), after which the message itself is stored.
pub async fn recall_and_store(
    db: &Arc<Mutex<Database>>,
    embedder: &dyn Embedder,
    user_text: &str,
    chat: Option<&ChatRecord>,
    chat_id: Option<&str>,
) -> Vec<ScoredMemory> {
    let text = user_text.trim();
    if text.is_empty() {
        return vec![];
    }

    let query = embedder.embed(text).await;
    let entries = match db.lock().memory_vectors(RECALL_WINDOW) {
        Ok(entries) => entries,
        Err(error) => {
            eprintln!("[MEMORY] Recall failed: {error}");
            return vec![];
        }
    };
    let now = now_ms();
    let memories = match &query {
        Some(vector) => search_with_vector(&entries, vector, 3, 0.3, now),
        None => search_by_keyword(&entries, text, 3, 0.2, now),
    };

    if text.chars().count() >= 20 {
        let content: String = text.chars().take(4000).collect();
        let metadata = json!({ "role": "user", "chatId": chat_id, "chatTitle": chat.map(|c| c.title.as_str()) }).to_string();
        if let Err(error) = db.lock().upsert_memory("conversation", &content, query.as_deref(), Some(&metadata), chat_id) {
            eprintln!("[MEMORY] Store failed: {error}");
        }
    }
    memories
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FixedEmbedder(Option<Vec<f32>>);
    #[async_trait]
    impl Embedder for FixedEmbedder {
        async fn embed(&self, _text: &str) -> Option<Vec<f32>> {
            self.0.clone()
        }
    }

    fn db() -> Arc<Mutex<Database>> {
        Arc::new(Mutex::new(Database::in_memory().unwrap()))
    }

    #[tokio::test]
    async fn recalls_by_vector_then_by_keyword_and_stores_long_messages_once() {
        let db = db();

        // Vector path: the stored vector is found again.
        let with_vectors = FixedEmbedder(Some(vec![1.0, 0.0]));
        let first = recall_and_store(&db, &with_vectors, "Remember that I prefer tabs over spaces", None, Some("chat_1")).await;
        assert!(first.is_empty(), "a message never recalls itself");
        let second = recall_and_store(&db, &with_vectors, "Which indentation do I prefer for tabs?", None, Some("chat_1")).await;
        assert_eq!(second.len(), 1);
        assert!(second[0].content.contains("prefer tabs"));

        // Repeating the same text stores one row, not two.
        recall_and_store(&db, &with_vectors, "Remember that I prefer tabs over spaces", None, Some("chat_1")).await;
        let rows = db.lock().list_memories(None).unwrap();
        assert_eq!(rows.iter().filter(|m| m.content.contains("prefer tabs over spaces")).count(), 1);
        assert_eq!(rows[0].source_id.as_deref(), Some("chat_1"));

        // Keyword path when embeddings are unavailable.
        let without = FixedEmbedder(None);
        let recalled = recall_and_store(&db, &without, "tabs preference reminder please", None, None).await;
        // Both earlier messages mention tabs, and neither vector is used on this path.
        assert_eq!(recalled.len(), 2);
        assert!(recalled.iter().all(|m| m.content.to_lowercase().contains("tabs")));

        // Short messages are not stored.
        let before = db.lock().list_memories(None).unwrap().len();
        recall_and_store(&db, &without, "ok thanks", None, None).await;
        assert_eq!(db.lock().list_memories(None).unwrap().len(), before);
    }
}
