use crate::db::models::ProjectRecord;
use crate::error::AppResult;
use crate::state::AppState;
use serde::Deserialize;
use tauri::State;

#[tauri::command]
pub async fn get_projects(state: State<'_, AppState>) -> AppResult<Vec<ProjectRecord>> {
    let db = state.db.lock();
    db.list_projects()
}

#[derive(Deserialize)]
pub struct CreateProjectPayload {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub instructions: Option<String>,
}

#[tauri::command]
pub async fn create_project(
    state: State<'_, AppState>,
    payload: CreateProjectPayload,
) -> AppResult<ProjectRecord> {
    let db = state.db.lock();
    db.create_project(
        &payload.id,
        &payload.name,
        payload.description.as_deref(),
        payload.instructions.as_deref(),
    )
}

#[tauri::command]
pub async fn delete_project(state: State<'_, AppState>, id: String) -> AppResult<bool> {
    let db = state.db.lock();
    db.delete_project(&id)
}
