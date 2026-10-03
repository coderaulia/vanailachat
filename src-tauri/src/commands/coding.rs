use crate::db::models::CodingSessionRecord;
use crate::error::{AppError, AppResult};
use crate::chat::agent::{run_agent, AgentDeps, APPROVAL_TIMEOUT};
use crate::chat::agent::EventSink;
use crate::chat::coding::{begin_turn, prepare_coding, remember_turn, undo_turn, CodingTools, CodingTurn, Mode};
use crate::commands::chat::{register_cancel, TauriSink};
use crate::providers::traits::ChatMessage;
use crate::state::AppState;
use serde::Deserialize;
use std::path::Path;
use tauri::{AppHandle, Runtime, State};

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
    /// `"plan"` investigates and proposes a plan without changing anything; anything else implements.
    #[serde(default)]
    pub mode: Option<String>,
}

/// Passes events on and keeps the assistant's text, which is remembered once the turn ends.
struct Recording<'a, S: EventSink> {
    inner: &'a S,
    text: std::sync::Mutex<String>,
}

impl<S: EventSink> EventSink for Recording<'_, S> {
    fn emit(&self, event: serde_json::Value) {
        if let Some(chunk) = event["message"]["content"].as_str() {
            self.text.lock().unwrap().push_str(chunk);
        }
        self.inner.emit(event);
    }
}

/// Puts back the files the last coding turn of this chat changed.
#[tauri::command]
pub async fn undo_coding_turn(chat_id: String) -> AppResult<String> {
    undo_turn(&chat_id).map_err(AppError::InvalidRequest)
}

/// Runs one coding turn in the session's workspace. Events stream as ordinary chat
/// events (text, tool events, approval requests); the command returns when the turn
/// is complete and rejects if it failed.
#[tauri::command]
pub async fn run_coding<R: Runtime>(app: AppHandle<R>, state: State<'_, AppState>, request: CodingRunRequest) -> AppResult<()> {
    let session = state
        .db
        .lock()
        .get_coding_session(&request.chat_id)?
        .ok_or_else(|| AppError::InvalidRequest("Create a coding workspace first".into()))?;
    if !Path::new(&session.workspace_path).is_dir() {
        return Err(AppError::InvalidRequest("The workspace folder no longer exists".into()));
    }

    // One turn at a time per chat: a second would share (and clobber) the first's cancel handle and undo snapshots.
    if state.active_streams.lock().await.contains_key(&request.chat_id) {
        return Err(AppError::InvalidRequest("This chat is still working on the previous request.".into()));
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
            mode: Mode::parse(request.mode.as_deref()),
        },
    )
    .await?;
    let plan = Mode::parse(request.mode.as_deref()) == Mode::Plan;

    set_status("running");
    let cancel = register_cancel(&state, &request.chat_id).await;
    begin_turn(&request.chat_id);
    let extra_commands = state.db.lock().get_setting("coding_extra_commands").ok().flatten().unwrap_or_default();
    let runner = CodingTools::new(state.db.clone(), session.workspace_path.clone()).for_chat(&request.chat_id, &extra_commands);
    let tauri_sink = TauriSink { app, chat_id: request.chat_id.clone() };
    let sink = Recording { inner: &tauri_sink, text: Default::default() };
    let deps = AgentDeps {
        provider: prepared.provider.as_ref(),
        runner: &runner,
        sink: &sink,
        approvals: &state.approval_service,
        approval_required: prepared.approval_required,
        approval_timeout: APPROVAL_TIMEOUT,
        read_only: plan,
    };
    let outcome = run_agent(&deps, prepared.request, cancel).await;
    state.active_streams.lock().await.remove(&request.chat_id);

    set_status(if outcome.is_ok() { "ready" } else { "error" });
    if outcome.is_ok() && !plan {
        let summary = sink.text.lock().unwrap().clone();
        remember_turn(&state.db, registry.ollama().as_ref(), &request.chat_id, &summary).await;
    }
    outcome.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::providers::test_support::{MockResponse, MockServer};
    use crate::providers::ProviderRegistry;
    use crate::services::{ApprovalService, OllamaManager};
    use parking_lot::Mutex;
    use std::sync::Arc;
    use tauri::{Listener, Manager};

    /// First model reply asks to write a file, the second wraps up.
    async fn scripted_ollama() -> MockServer {
        let calls = std::sync::atomic::AtomicUsize::new(0);
        MockServer::start(move |_, path, _| {
            if path == "/api/show" {
                return MockResponse::json("{\"capabilities\":[\"completion\",\"tools\"]}");
            }
            if path != "/api/chat" {
                return MockResponse::status(500, "{}");
            }
            let first = calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0;
            MockResponse::ok(
                "application/x-ndjson",
                vec![if first {
                    "{\"message\":{\"role\":\"assistant\",\"content\":\"\",\"tool_calls\":[{\"function\":{\"name\":\"write_file\",\"arguments\":{\"path\":\"hello.txt\",\"content\":\"hi\"}}}]},\"done\":true}\n"
                } else {
                    "{\"message\":{\"role\":\"assistant\",\"content\":\"All done.\"},\"done\":true}\n"
                }],
            )
        })
        .await
    }

    struct Harness {
        app: tauri::App<tauri::test::MockRuntime>,
        root: String,
        events: Arc<std::sync::Mutex<Vec<serde_json::Value>>>,
        _server: MockServer,
    }

    async fn harness(approve: bool) -> Harness {
        let server = scripted_ollama().await;
        let settings = std::collections::HashMap::from([("ollama_host".to_string(), server.url())]);
        let registry = ProviderRegistry::from_settings(&settings, &|_| None);
        let manager = OllamaManager::new(Some(registry.ollama().base_url()), false);
        let state = AppState {
            db: Arc::new(Mutex::new(Database::in_memory().unwrap())),
            provider_registry: Arc::new(Mutex::new(registry)),
            ollama_manager: Arc::new(manager),
            approval_service: Arc::new(ApprovalService::new()),
            active_streams: Arc::new(tokio::sync::Mutex::new(Default::default())),
        };
        let root = std::env::temp_dir().join(format!("vanaila-cmd-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let root = root.canonicalize().unwrap().to_string_lossy().into_owned();
        state.db.lock().upsert_chat("c1", "t", None, None, None, None, None).unwrap();
        state
            .db
            .lock()
            .upsert_coding_session(&CodingSessionRecord {
                chat_id: "c1".into(),
                harness: "pi-harness".into(),
                harness_session_id: None,
                workspace_path: root.clone(),
                status: "ready".into(),
                created_at: 0,
                updated_at: 0,
            })
            .unwrap();

        let app = tauri::test::mock_app();
        app.manage(state);

        // The "user": answers every approval request the way the test wants.
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let (sink, handle) = (events.clone(), app.handle().clone());
        app.listen("chat-stream", move |event| {
            let value: serde_json::Value = serde_json::from_str(event.payload()).unwrap();
            if let Some(id) = value["approval_request"]["id"].as_str() {
                let (handle, id) = (handle.clone(), id.to_string());
                tauri::async_runtime::spawn(async move {
                    handle.state::<AppState>().approval_service.resolve(&id, approve).await;
                });
            }
            sink.lock().unwrap().push(value);
        });
        Harness { app, root, events, _server: server }
    }

    fn request() -> CodingRunRequest {
        CodingRunRequest { chat_id: "c1".into(), prompt: "write hello".into(), model: "qwen3:8b".into(), history: vec![], mode: None }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn run_coding_writes_after_approval_and_resets_the_session_status() {
        let h = harness(true).await;
        run_coding(h.app.handle().clone(), h.app.state::<AppState>(), request()).await.unwrap();

        assert_eq!(std::fs::read_to_string(format!("{}/hello.txt", h.root)).unwrap(), "hi");
        let events = h.events.lock().unwrap().clone();
        assert!(events.iter().all(|e| e["chat_id"] == "c1"), "every event is tagged with its chat");
        assert!(events.iter().any(|e| e["approval_request"]["summary"] == "Write hello.txt (2 bytes)"));
        assert!(events.iter().any(|e| e["done"] == true));
        let session = h.app.state::<AppState>().db.lock().get_coding_session("c1").unwrap().unwrap();
        assert_eq!(session.status, "ready");
        assert!(h.app.state::<AppState>().active_streams.lock().await.is_empty(), "cancel handle is released");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn run_coding_changes_nothing_when_the_write_is_declined() {
        let h = harness(false).await;
        run_coding(h.app.handle().clone(), h.app.state::<AppState>(), request()).await.unwrap();
        assert!(!std::path::Path::new(&format!("{}/hello.txt", h.root)).exists());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn run_coding_needs_a_workspace_session_and_a_real_model() {
        let h = harness(true).await;
        let mut missing = request();
        missing.chat_id = "nope".into();
        let error = run_coding(h.app.handle().clone(), h.app.state::<AppState>(), missing).await.unwrap_err();
        assert!(error.to_string().contains("Create a coding workspace first"), "{error}");

        // A failing turn leaves the session in "error", not stuck on "running".
        let mut broken = request();
        broken.model = "openai:gpt-4o".into();
        let _ = run_coding(h.app.handle().clone(), h.app.state::<AppState>(), broken).await;
        let status = h.app.state::<AppState>().db.lock().get_coding_session("c1").unwrap().unwrap().status;
        assert_ne!(status, "running");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_plan_turn_never_changes_files_and_a_finished_turn_can_be_undone() {
        let h = harness(true).await;
        let mut plan = request();
        plan.mode = Some("plan".into());
        // The scripted model still asks to write, but plan mode offers no write tool and no approval is raised.
        let _ = run_coding(h.app.handle().clone(), h.app.state::<AppState>(), plan).await;
        assert!(!std::path::Path::new(&format!("{}/hello.txt", h.root)).exists());
        assert!(h.events.lock().unwrap().iter().all(|e| e.get("approval_request").is_none()));

        // A fresh script for the implementing turn, whose changes `/undo` then takes back.
        let h = harness(true).await;
        run_coding(h.app.handle().clone(), h.app.state::<AppState>(), request()).await.unwrap();
        assert!(std::path::Path::new(&format!("{}/hello.txt", h.root)).exists());
        let message = undo_coding_turn("c1".into()).await.unwrap();
        assert!(message.contains("hello.txt"), "{message}");
        assert!(!std::path::Path::new(&format!("{}/hello.txt", h.root)).exists());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_second_turn_while_one_runs_is_refused() {
        let h = harness(true).await;
        let (tx, _rx) = tokio::sync::watch::channel(false);
        h.app.state::<AppState>().active_streams.lock().await.insert("c1".into(), tx);
        let error = run_coding(h.app.handle().clone(), h.app.state::<AppState>(), request()).await.unwrap_err();
        assert!(error.to_string().contains("still working"), "{error}");
    }
}
