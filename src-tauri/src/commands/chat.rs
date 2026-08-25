use crate::error::{AppError, AppResult};
use crate::providers::traits::*;
use crate::state::AppState;
use futures::StreamExt;
use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::oneshot;

#[derive(Deserialize)]
pub struct StartChatPayload {
    pub request: ChatRequest,
}

#[tauri::command]
pub async fn start_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ChatRequest,
) -> AppResult<()> {
    // 1. Ensure Ollama is running if model targets Ollama
    if request.model.starts_with("ollama:") || !request.model.contains(':') {
        state.ollama_manager.ensure_running().await;
    }

    // 2. Resolve provider for model
    let provider = {
        let registry = state.provider_registry.lock();
        registry
            .resolve_provider_for_model(&request.model)
            .ok_or_else(|| AppError::NotFound(format!("No provider registered for model {}", request.model)))?
    };

    // 3. Initiate stream from provider
    let mut stream = provider.chat(request).await?;

    // 4. Setup abort channel
    let (abort_tx, mut abort_rx) = oneshot::channel::<()>();
    {
        let mut active = state.active_stream_abort.lock().await;
        *active = Some(abort_tx);
    }

    // 5. Spawn background task to emit chunks to frontend
    let app_handle = app.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut abort_rx => {
                    let _ = app_handle.emit("chat-stream", StreamChunk {
                        message: None,
                        tool_calls: None,
                        tool_event: None,
                        approval_request: None,
                        done: true,
                        prompt_eval_count: None,
                        eval_count: None,
                        error: Some("Stream cancelled by user".to_string()),
                    });
                    break;
                }
                item = stream.next() => {
                    match item {
                        Some(Ok(chunk)) => {
                            let is_done = chunk.done;
                            let _ = app_handle.emit("chat-stream", &chunk);
                            if is_done {
                                break;
                            }
                        }
                        Some(Err(e)) => {
                            let _ = app_handle.emit("chat-stream", StreamChunk {
                                message: None,
                                tool_calls: None,
                                tool_event: None,
                                approval_request: None,
                                done: true,
                                prompt_eval_count: None,
                                eval_count: None,
                                error: Some(e.to_string()),
                            });
                            break;
                        }
                        None => {
                            break;
                        }
                    }
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn cancel_chat(state: State<'_, AppState>) -> AppResult<()> {
    let mut active = state.active_stream_abort.lock().await;
    if let Some(tx) = active.take() {
        let _ = tx.send(());
    }
    Ok(())
}

#[tauri::command]
pub async fn approve_tool(
    state: State<'_, AppState>,
    id: String,
    approved: bool,
) -> AppResult<bool> {
    Ok(state.approval_service.resolve(&id, approved).await)
}
