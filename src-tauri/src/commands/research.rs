use crate::chat::agent::EventSink;
use crate::error::{AppError, AppResult};
use crate::services::research::{run_research, LiveWeb, ResearchRequest};
use crate::state::AppState;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::watch;

/// Forwards research stages to the webview, tagged with the run they belong to.
struct ResearchSink {
    app: AppHandle,
    id: String,
}

impl EventSink for ResearchSink {
    fn emit(&self, mut event: Value) {
        if let Some(object) = event.as_object_mut() {
            object.insert("chat_id".into(), Value::String(self.id.clone()));
        }
        let _ = self.app.emit("research-stage", event);
    }
}

/// Runs a research turn. Progress arrives as `research-stage` events; the command
/// returns when the report is complete (or was cancelled), and rejects on failure.
#[tauri::command]
pub async fn start_research(app: AppHandle, state: State<'_, AppState>, request: ResearchRequest) -> AppResult<()> {
    let id = request.research_id.clone().unwrap_or_else(|| "__research__".to_string());
    let registry = state.provider_registry.lock().clone();
    let (provider, model) = registry
        .resolve_model(&request.model)
        .ok_or_else(|| AppError::NotFound(format!("No provider registered for model {}", request.model)))?;
    if provider.id() == "ollama" {
        state.ollama_manager.ensure_running().await;
    }

    let (tx, cancel) = watch::channel(false);
    state.active_streams.lock().await.insert(id.clone(), tx);

    let sink = ResearchSink { app, id: id.clone() };
    let outcome = run_research(&LiveWeb, provider.as_ref(), &model, &request, &sink, cancel).await;
    state.active_streams.lock().await.remove(&id);

    // The UI renders the failure from the same stage it gets on the web.
    if let Err(error) = &outcome {
        sink.emit(json!({ "stage": "error", "message": error.to_string() }));
    }
    Ok(())
}
