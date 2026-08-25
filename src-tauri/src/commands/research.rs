use crate::error::AppResult;
use crate::services::research::execute_research;
use tauri::{AppHandle, Emitter};

#[tauri::command]
pub async fn start_research(
    app: AppHandle,
    query: String,
) -> AppResult<Vec<String>> {
    let _ = app.emit("research-status", serde_json::json!({
        "status": "searching",
        "query": query
    }));

    let results = execute_research(&query).await?;

    let _ = app.emit("research-status", serde_json::json!({
        "status": "complete",
        "sources_count": results.len()
    }));

    Ok(results)
}
