use crate::db::models::MessageRecord;
use crate::error::AppResult;
use crate::state::AppState;
use serde::Deserialize;
use tauri::State;

#[tauri::command]
pub async fn get_messages(
    state: State<'_, AppState>,
    chat_id: String,
    limit: Option<usize>,
) -> AppResult<Vec<MessageRecord>> {
    let db = state.db.lock();
    db.list_messages(&chat_id, limit)
}

#[derive(Deserialize)]
pub struct SaveMessagePayload {
    pub id: String,
    pub chat_id: String,
    pub role: String,
    pub content: String,
}

#[tauri::command]
pub async fn save_message(
    state: State<'_, AppState>,
    payload: SaveMessagePayload,
) -> AppResult<MessageRecord> {
    let db = state.db.lock();
    db.save_message(&payload.id, &payload.chat_id, &payload.role, &payload.content)
}

#[tauri::command]
pub async fn search_messages(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> AppResult<Vec<MessageRecord>> {
    let db = state.db.lock();
    db.search_messages(&query, limit)
}

#[derive(Deserialize)]
pub struct SetFeedbackPayload {
    pub message_id: String,
    pub rating: i32,
    pub edited_content: Option<String>,
    pub implicit: Option<bool>,
}

#[tauri::command]
pub async fn set_feedback(
    state: State<'_, AppState>,
    payload: SetFeedbackPayload,
) -> AppResult<()> {
    let db = state.db.lock();
    db.set_feedback(
        &payload.message_id,
        payload.rating,
        payload.edited_content.as_deref(),
        payload.implicit.unwrap_or(false),
    )
}
