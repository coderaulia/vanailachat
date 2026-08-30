use crate::db::models::CodingSessionRecord;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Deserialize;
use std::path::Path;
use tauri::State;

#[derive(Deserialize)]
pub struct CreateCodingSessionRequest {
    pub chat_id: String,
    pub harness: String,
    pub workspace_path: String,
}

fn validate_workspace(path: &str) -> AppResult<String> {
    if path.trim().is_empty() { return Err(AppError::InvalidRequest("A workspace directory is required".into())); }
    let resolved = std::fs::canonicalize(path).map_err(|_| AppError::InvalidRequest("Workspace directory does not exist".into()))?;
    if !resolved.is_dir() { return Err(AppError::InvalidRequest("Workspace path is not a directory".into())); }
    Ok(resolved.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn get_coding_session(state: State<'_, AppState>, chat_id: String) -> AppResult<Option<CodingSessionRecord>> {
    let db = state.db.lock();
    db.get_coding_session(&chat_id)
}

#[tauri::command]
pub async fn create_coding_session(state: State<'_, AppState>, request: CreateCodingSessionRequest) -> AppResult<CodingSessionRecord> {
    if request.chat_id.trim().is_empty() { return Err(AppError::InvalidRequest("chat_id is required".into())); }
    if request.harness != "pi-harness" && request.harness != "deepseek-harness" {
        return Err(AppError::InvalidRequest("Unknown coding harness".into()));
    }
    let workspace = validate_workspace(&request.workspace_path)?;
    let db = state.db.lock();
    db.upsert_coding_session(&CodingSessionRecord {
        chat_id: request.chat_id, harness: request.harness, harness_session_id: None,
        workspace_path: workspace, status: "ready".into(), created_at: 0, updated_at: 0,
    })
}

#[tauri::command]
pub async fn update_coding_session(state: State<'_, AppState>, session: CodingSessionRecord) -> AppResult<CodingSessionRecord> {
    if !Path::new(&session.workspace_path).is_dir() { return Err(AppError::InvalidRequest("Workspace directory does not exist".into())); }
    let db = state.db.lock();
    db.upsert_coding_session(&session)
}
