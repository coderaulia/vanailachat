use crate::error::AppResult;
use crate::state::{affects_providers, AppState};
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> AppResult<HashMap<String, String>> {
    let db = state.db.lock();
    db.get_all_settings()
}

#[tauri::command]
pub async fn update_setting(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> AppResult<()> {
    state.db.lock().set_setting(&key, &value)?;
    if affects_providers(&key) {
        state.refresh_providers();
    }
    Ok(())
}
