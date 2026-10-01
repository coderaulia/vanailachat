use crate::chat::agent::{complete_once, run_agent, AgentDeps, EventSink, Outcome, APPROVAL_TIMEOUT};
use crate::chat::prepare_chat;
use crate::chat::tools::ChatTools;
use crate::error::AppResult;
use crate::providers::traits::ChatRequest;
use crate::state::AppState;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::watch;

/// Key for turns that arrive without a chat id.
const ANONYMOUS_CHAT: &str = "__anonymous__";

/// Forwards events to the webview, tagged with the chat they belong to so two
/// chats streaming at once do not write into each other's message.
pub struct TauriSink {
    pub app: AppHandle,
    pub chat_id: String,
}

impl EventSink for TauriSink {
    fn emit(&self, mut event: Value) {
        if let Some(object) = event.as_object_mut() {
            object.insert("chat_id".into(), Value::String(self.chat_id.clone()));
        }
        let _ = self.app.emit("chat-stream", event);
    }
}

/// Registers a cancel handle for a chat; the returned receiver fires when the user stops it.
pub async fn register_cancel(state: &AppState, chat_id: &str) -> watch::Receiver<bool> {
    let (tx, rx) = watch::channel(false);
    state.active_streams.lock().await.insert(chat_id.to_string(), tx);
    rx
}

#[tauri::command]
pub async fn start_chat(app: AppHandle, state: State<'_, AppState>, request: ChatRequest) -> AppResult<()> {
    let chat_id = request.chat_id.clone().unwrap_or_else(|| ANONYMOUS_CHAT.to_string());
    let registry = state.provider_registry.lock().clone();

    if registry.resolve_model(&request.model).is_some_and(|(provider, _)| provider.id() == "ollama") {
        state.ollama_manager.ensure_running().await;
    }

    let prepared = prepare_chat(&state.db, &registry, request).await?;
    let cancel = register_cancel(&state, &chat_id).await;

    let runner = ChatTools { db: state.db.clone() };
    let sink = TauriSink { app, chat_id: chat_id.clone() };
    let deps = AgentDeps {
        provider: prepared.provider.as_ref(),
        runner: &runner,
        sink: &sink,
        approvals: &state.approval_service,
        approval_required: prepared.approval_required,
        approval_timeout: APPROVAL_TIMEOUT,
    };

    // The command only returns once the reply is complete, so the frontend
    // keeps listening for exactly as long as the stream runs.
    let outcome = run_agent(&deps, prepared.request, cancel).await;
    state.active_streams.lock().await.remove(&chat_id);
    match outcome? {
        Outcome::Finished | Outcome::Cancelled => Ok(()),
    }
}

/// A single non-streaming completion, e.g. for chat titles. Skips profile, memory and tools.
#[tauri::command]
pub async fn chat_once(state: State<'_, AppState>, mut request: ChatRequest) -> AppResult<String> {
    request.skip_memory = true;
    let registry = state.provider_registry.lock().clone();
    if registry.resolve_model(&request.model).is_some_and(|(provider, _)| provider.id() == "ollama") {
        state.ollama_manager.ensure_running().await;
    }
    let prepared = prepare_chat(&state.db, &registry, request).await?;
    complete_once(prepared.provider.as_ref(), prepared.request).await
}

/// Stops the stream of `chat_id`, or every stream when no id is given.
#[tauri::command]
pub async fn cancel_chat(state: State<'_, AppState>, chat_id: Option<String>) -> AppResult<()> {
    let streams = state.active_streams.lock().await;
    match chat_id {
        Some(id) => {
            if let Some(tx) = streams.get(&id) {
                let _ = tx.send(true);
            }
        }
        None => streams.values().for_each(|tx| {
            let _ = tx.send(true);
        }),
    }
    Ok(())
}

#[tauri::command]
pub async fn approve_tool(state: State<'_, AppState>, id: String, approved: bool) -> AppResult<bool> {
    Ok(state.approval_service.resolve(&id, approved).await)
}
