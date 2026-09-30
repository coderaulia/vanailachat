use crate::db::models::{FeedbackRecord, MessageRecord, MessageSearchHit, MessageVersion};
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
    pub created_at: Option<i64>,
    pub version_of: Option<String>,
}

#[tauri::command]
pub async fn save_message(
    state: State<'_, AppState>,
    payload: SaveMessagePayload,
) -> AppResult<MessageRecord> {
    let db = state.db.lock();
    db.save_message(
        &payload.id,
        &payload.chat_id,
        &payload.role,
        &payload.content,
        payload.created_at,
        payload.version_of.as_deref(),
    )
}

/// Hides a message and everything after it (regenerate/edit); returns how many.
#[tauri::command]
pub async fn supersede_messages(
    state: State<'_, AppState>,
    chat_id: String,
    from_message_id: String,
) -> AppResult<usize> {
    let db = state.db.lock();
    db.supersede_messages_from(&chat_id, &from_message_id)
}

#[tauri::command]
pub async fn get_message_versions(state: State<'_, AppState>, message_id: String) -> AppResult<Vec<MessageVersion>> {
    let db = state.db.lock();
    db.list_message_versions(&message_id)
}

#[tauri::command]
pub async fn search_messages(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
    project_id: Option<String>,
) -> AppResult<Vec<MessageSearchHit>> {
    let db = state.db.lock();
    db.search_messages(&query, limit, project_id.as_deref())
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

#[tauri::command]
pub async fn get_feedback(state: State<'_, AppState>, message_id: String) -> AppResult<Option<FeedbackRecord>> {
    let db = state.db.lock();
    db.get_feedback(&message_id)
}
