use crate::db::models::CodingSessionRecord;
use crate::error::{AppError, AppResult};
use crate::chat::agent::{run_agent, AgentDeps, APPROVAL_TIMEOUT};
use crate::chat::coding::{prepare_coding, CodingTools, CodingTurn};
use crate::commands::chat::{register_cancel, TauriSink};
use crate::providers::traits::ChatMessage;
use crate::state::AppState;
use serde::Deserialize;
use std::path::Path;
use tauri::{AppHandle, State};

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
    /// The conversation so far, so a follow-up ("now add tests") has its context.
    #[serde(default)]
    pub history: Vec<ChatMessage>,
}

/// Runs one coding turn in the session's workspace. Events stream as ordinary chat
/// events (text, tool events, approval requests); the command returns when the turn
/// is complete and rejects if it failed.
#[tauri::command]
pub async fn run_coding(app: AppHandle, state: State<'_, AppState>, request: CodingRunRequest) -> AppResult<()> {
    let session = state
        .db
        .lock()
        .get_coding_session(&request.chat_id)?
        .ok_or_else(|| AppError::InvalidRequest("Create a coding workspace first".into()))?;
    if !Path::new(&session.workspace_path).is_dir() {
        return Err(AppError::InvalidRequest("The workspace folder no longer exists".into()));
    }

    let registry = state.provider_registry.lock().clone();
    if registry.resolve_model(&request.model).is_some_and(|(provider, _)| provider.id() == "ollama") {
        state.ollama_manager.ensure_running().await;
    }
    let set_status = |status: &str| {
        let _ = state.db.lock().upsert_coding_session(&CodingSessionRecord { status: status.into(), ..session.clone() });
    };

    let prepared = prepare_coding(
        &state.db,
        &registry,
        CodingTurn {
            chat_id: request.chat_id.clone(),
            model: request.model,
            workspace: session.workspace_path.clone(),
            history: request.history,
            prompt: request.prompt,
        },
    )
    .await?;

    set_status("running");
    let cancel = register_cancel(&state, &request.chat_id).await;
    let runner = CodingTools::new(state.db.clone(), session.workspace_path.clone());
    let sink = TauriSink { app, chat_id: request.chat_id.clone() };
    let deps = AgentDeps {
        provider: prepared.provider.as_ref(),
        runner: &runner,
        sink: &sink,
        approvals: &state.approval_service,
        approval_required: prepared.approval_required,
        approval_timeout: APPROVAL_TIMEOUT,
    };
    let outcome = run_agent(&deps, prepared.request, cancel).await;
    state.active_streams.lock().await.remove(&request.chat_id);

    set_status(if outcome.is_ok() { "ready" } else { "error" });
    outcome.map(|_| ())
}
