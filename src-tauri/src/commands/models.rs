use crate::error::AppResult;
use crate::providers::ModelInfo;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn get_models(state: State<'_, AppState>) -> AppResult<Vec<ModelInfo>> {
    let registry = state.provider_registry.lock().clone();
    registry.list_all_models().await
}
