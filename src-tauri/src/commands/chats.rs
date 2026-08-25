use crate::db::models::ChatRecord;
use crate::error::AppResult;
use crate::state::AppState;
use serde::Deserialize;
use tauri::State;

#[tauri::command]
pub async fn get_chats(
    state: State<'_, AppState>,
    project_id: Option<String>,
    limit: Option<usize>,
) -> AppResult<Vec<ChatRecord>> {
    let db = state.db.lock();
    db.list_chats(project_id.as_deref(), limit)
}

#[derive(Deserialize)]
pub struct CreateChatPayload {
    pub id: String,
    pub title: String,
    pub project_id: Option<String>,
    pub project_root: Option<String>,
    pub system_prompt: Option<String>,
    pub model: Option<String>,
    pub role: Option<String>,
}

#[tauri::command]
pub async fn create_chat(
    state: State<'_, AppState>,
    payload: CreateChatPayload,
) -> AppResult<ChatRecord> {
    let db = state.db.lock();
    db.upsert_chat(
        &payload.id,
        &payload.title,
        payload.project_id.as_deref(),
        payload.project_root.as_deref(),
        payload.system_prompt.as_deref(),
        payload.model.as_deref(),
        payload.role.as_deref(),
    )
}

#[tauri::command]
pub async fn delete_chat(state: State<'_, AppState>, id: String) -> AppResult<bool> {
    let db = state.db.lock();
    db.delete_chat(&id)
}
