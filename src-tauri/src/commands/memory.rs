use crate::db::models::MemoryRecord;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Deserialize;
use tauri::State;

#[tauri::command]
pub async fn get_memories(state: State<'_, AppState>) -> AppResult<Vec<MemoryRecord>> {
    state.db.lock().list_memories(None)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddMemoryPayload {
    pub content: String,
    #[serde(default, rename = "type")]
    pub kind: Option<String>,
    #[serde(default, alias = "source_id")]
    pub source_id: Option<String>,
}

/// Stores a memory by hand. It is embedded when Ollama's embedding model is
/// available and stays findable by keyword when it is not.
#[tauri::command]
pub async fn add_memory(state: State<'_, AppState>, payload: AddMemoryPayload) -> AppResult<MemoryRecord> {
    let content = payload.content.trim();
    if content.is_empty() {
        return Err(AppError::InvalidRequest("Content required".into()));
    }
    let ollama = state.provider_registry.lock().ollama();
    let embedding = ollama.embed_or_none(content).await;
    state.db.lock().upsert_memory(
        payload.kind.as_deref().unwrap_or("manual"),
        content,
        embedding.as_deref(),
        None,
        payload.source_id.as_deref(),
    )
}

#[tauri::command]
pub async fn delete_memory(state: State<'_, AppState>, id: String) -> AppResult<bool> {
    state.db.lock().delete_memory(&id)
}

/// Forgets every memory; chats are untouched. Returns how many were removed.
#[tauri::command]
pub async fn clear_memories(state: State<'_, AppState>) -> AppResult<usize> {
    state.db.lock().delete_all_memories()
}
