use crate::db::models::CodingSessionRecord;
use crate::error::{AppError, AppResult};
use crate::providers::traits::{ChatMessage, ChatRequest, StreamChunk};
use crate::state::AppState;
use serde::Deserialize;
use std::path::Path;
use tauri::{AppHandle, Emitter, State};
use futures::StreamExt;

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

#[derive(Deserialize)]
pub struct CodingRunRequest {
    pub chat_id: String,
    pub prompt: String,
    pub model: String,
    pub system_prompt: Option<String>,
}

fn coding_event(event_type: &str, text: Option<String>, usage: Option<serde_json::Value>) -> serde_json::Value {
    let mut event = serde_json::json!({ "type": event_type });
    if let Some(text) = text { event["text"] = serde_json::Value::String(text); }
    if let Some(usage) = usage { event["usage"] = usage; }
    event
}

#[tauri::command]
pub async fn run_coding(
    app: AppHandle,
    state: State<'_, AppState>,
    request: CodingRunRequest,
) -> AppResult<()> {
    let session = {
        let db = state.db.lock();
        db.get_coding_session(&request.chat_id)?
            .ok_or_else(|| AppError::InvalidRequest("Create a coding workspace first".into()))?
    };
    let provider = {
        let registry = state.provider_registry.lock();
        registry.resolve_provider_for_model(&request.model)
            .ok_or_else(|| AppError::NotFound(format!("No provider registered for model {}", request.model)))?
    };
    {
        let db = state.db.lock();
        db.upsert_coding_session(&CodingSessionRecord { status: "running".into(), ..session.clone() })?;
    }
    let chat_request = ChatRequest {
        messages: vec![ChatMessage { role: "user".into(), content: request.prompt, tool_calls: None, tool_call_id: None }],
        model: request.model,
        system_prompt: request.system_prompt,
        temperature: Some(0.7),
        max_tokens: None,
    };
    let mut stream = provider.chat(chat_request).await?;
    let app_handle = app.clone();
    while let Some(item) = stream.next().await {
        match item {
            Ok(StreamChunk { message: Some(message), prompt_eval_count, eval_count, done, .. }) => {
                if !message.content.is_empty() {
                    let _ = app_handle.emit("chat-stream", serde_json::json!({
                        "coding_event": coding_event("text", Some(message.content), None)
                    }));
                }
                if prompt_eval_count.is_some() || eval_count.is_some() {
                    let _ = app_handle.emit("chat-stream", serde_json::json!({
                        "coding_event": coding_event("usage", None, Some(serde_json::json!({
                            "prompt_tokens": prompt_eval_count,
                            "completion_tokens": eval_count,
                            "total_tokens": prompt_eval_count.unwrap_or(0) + eval_count.unwrap_or(0)
                        })))
                    }));
                }
                if done { break; }
            }
            Ok(StreamChunk { done: true, .. }) => break,
            Ok(_) => {}
            Err(error) => {
                let _ = app_handle.emit("chat-stream", serde_json::json!({ "error": error.to_string() }));
                break;
            }
        }
    }
    {
        let db = state.db.lock();
        db.upsert_coding_session(&CodingSessionRecord { status: "ready".into(), ..session })?;
    }
    let _ = app_handle.emit("chat-stream", serde_json::json!({ "done": true }));
    Ok(())
}
