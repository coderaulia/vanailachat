use crate::error::{AppError, AppResult};
use crate::services::secrets::{is_valid_key, mask_settings, resolve_write, MAX_SETTING_VALUE_CHARS};
use crate::state::{affects_providers, AppState};
use std::collections::HashMap;
use tauri::State;

/// Credentials are masked; the real ones never reach the webview.
#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> AppResult<HashMap<String, String>> {
    let db = state.db.lock();
    Ok(mask_settings(&db.get_all_settings()?))
}

#[tauri::command]
pub async fn update_setting(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> AppResult<()> {
    if !is_valid_key(&key) {
        return Err(AppError::InvalidRequest("Invalid setting name".into()));
    }
    if value.chars().count() > MAX_SETTING_VALUE_CHARS {
        return Err(AppError::InvalidRequest("value is too large".into()));
    }
    {
        let db = state.db.lock();
        let stored = db.get_setting(&key)?;
        // A masked secret means "unchanged".
        let Some(to_store) = resolve_write(&key, &value, stored.as_deref()) else { return Ok(()) };
        db.set_setting(&key, &to_store)?;
    }
    if affects_providers(&key) {
        state.refresh_providers();
    }
    Ok(())
}
