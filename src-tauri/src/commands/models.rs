use crate::error::AppResult;
use crate::providers::ModelInfo;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn get_models(state: State<'_, AppState>) -> AppResult<Vec<ModelInfo>> {
    let registry = state.provider_registry.lock().clone();
    registry.list_all_models().await
}

#[tauri::command]
pub async fn pull_model(
    app: tauri::AppHandle,
    _state: State<'_, AppState>,
    name: String,
) -> AppResult<()> {
    use crate::providers::ollama::OllamaProvider;
    use tauri::Emitter;

    let ollama = OllamaProvider::new(None);
    let app_handle = app.clone();
    
    ollama
        .pull_model(&name, move |progress| {
            let _ = app_handle.emit("ollama-pull-progress", progress);
        })
        .await
}
