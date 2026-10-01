use crate::chat::ab::{self, AbPick, AbPickResult, AbRequest, AbResponse};
use crate::error::AppResult;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn run_ab(state: State<'_, AppState>, request: AbRequest) -> AppResult<AbResponse> {
    let registry = state.provider_registry.lock().clone();
    // Either model may be local; make sure Ollama is up before asking.
    state.ollama_manager.ensure_running().await;
    ab::run(&state.db, &registry, &request).await
}

#[tauri::command]
pub async fn pick_ab(state: State<'_, AppState>, pick: AbPick) -> AppResult<AbPickResult> {
    let saved = ab::record_pick(&state.db.lock(), &pick)?;

    // Embedding can be slow, so the pick returns first and the memory follows.
    let db = state.db.clone();
    let registry = state.provider_registry.lock().clone();
    let (pick, remembered) = (pick, saved.clone());
    tokio::spawn(async move {
        ab::remember_pick(&db, registry.ollama().as_ref(), &pick, &remembered).await;
    });
    Ok(saved)
}
