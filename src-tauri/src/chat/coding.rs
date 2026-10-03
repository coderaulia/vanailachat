//! Desktop coding mode: a tool-using agent confined to the session's workspace.
//!
//! The web edition delegates this to external harnesses (Pi, DeepSeek) that run
//! as Node processes. The desktop app runs the same kind of loop natively: the
//! model gets file and command tools, every write or command waits for the
//! user's approval, and the events match an ordinary chat turn.

use super::agent::ToolRunner;
use super::memory::Embedder;
use super::tools::ChatTools;
use super::{prepare_chat, PreparedChat};
use crate::db::Database;
use crate::error::AppResult;
use crate::providers::traits::{ChatMessage, ChatRequest};
use crate::providers::ProviderRegistry;
use crate::tools::read_file::resolve_path;
use crate::tools::run_command::{parse_extra_commands, run_command_with};
use crate::tools::execute_tool;
use std::collections::HashMap;
use std::sync::LazyLock;
use async_trait::async_trait;
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::sync::Arc;

fn function(name: &str, description: &str, properties: Value, required: &[&str]) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": { "type": "object", "properties": properties, "required": required },
        },
    })
}

/// File and command tools, described like the web backend's.
pub fn definitions() -> Vec<Value> {
    vec![
        function(
            "list_directory",
            "List files and folders in a directory of the project",
            json!({
                "path": { "type": "string", "description": "Relative path to list (default: the project root)" },
                "maxDepth": { "type": "number", "description": "How many levels to show (default 2, max 6)" },
            }),
            &[],
        ),
        function(
            "search_files",
            "Search text inside project files. Use this instead of grep, rg, findstr, or Select-String.",
            json!({
                "query": { "type": "string", "description": "Plain text to find" },
                "path": { "type": "string", "description": "Relative file or directory to search (default: .)" },
                "file_pattern": { "type": "string", "description": "Optional glob such as *.ts or src/**/*.tsx" },
                "case_sensitive": { "type": "boolean", "description": "Use case-sensitive matching (default: false)" },
                "max_results": { "type": "number", "description": "Maximum matching lines, 1-200 (default: 100)" },
            }),
            &["query"],
        ),
        function(
            "read_file",
            "Read the contents of a local file in the current project",
            json!({
                "path": { "type": "string", "description": "Relative path to the file" },
                "start_line": { "type": "number", "description": "First line to return (1-based). Use with end_line for big files." },
                "end_line": { "type": "number", "description": "Last line to return" },
            }),
            &["path"],
        ),
        function(
            "write_file",
            "Create a file or replace its entire contents, relative to the project root. Use edit_file for a targeted change to an existing file.",
            json!({
                "path": { "type": "string", "description": "File path relative to the project root" },
                "content": { "type": "string", "description": "Full file contents to write" },
            }),
            &["path", "content"],
        ),
        function(
            "edit_file",
            "Replace an exact string in an existing file. The old_string must appear exactly once, so include enough surrounding context to be unambiguous.",
            json!({
                "path": { "type": "string", "description": "File path relative to the project root" },
                "old_string": { "type": "string", "description": "Exact text to replace, including indentation" },
                "new_string": { "type": "string", "description": "Replacement text" },
            }),
            &["path", "old_string", "new_string"],
        ),
        function(
            "run_command",
            "Run an allowlisted command: read-only git (status, diff, log, show, branch, blame, ls-files) or a package script (npm/pnpm/yarn/bun test, build, lint, type-check; cargo test or check). For files, use list_directory, read_file and search_files instead of shell commands.",
            json!({ "command": { "type": "string", "description": "The full command line, e.g. \"git diff --stat\" or \"pnpm test\"" } }),
            &["command"],
        ),
    ]
}

/// Tools that only look: all a plan-mode turn gets.
pub fn read_only_definitions() -> Vec<Value> {
    definitions().into_iter().filter(|t| matches!(t["function"]["name"].as_str(), Some("list_directory" | "search_files" | "read_file"))).collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Mode {
    #[default]
    Implement,
    /// Investigate and propose a plan; nothing is changed.
    Plan,
}

impl Mode {
    pub fn parse(value: Option<&str>) -> Self {
        if value.is_some_and(|v| v.eq_ignore_ascii_case("plan")) { Mode::Plan } else { Mode::Implement }
    }
}

pub const PLAN_INSTRUCTIONS: &str = "[Plan Mode]\nDo not change anything and do not run commands: you only have tools that read. Investigate the code that matters, \
then answer with a short numbered plan: what you would change, in which files, in what order, and how you would verify it. Mention risks or open questions at the end.";

pub fn workspace_instructions(root: &str) -> String {
    format!(
        "[Coding Workspace]\nYou are working in the project at {root}. Every path is relative to that folder and nothing outside it is reachable.\n\
         Look before you change: list_directory, search_files and read_file first. Make targeted changes with edit_file and use write_file only for new files or full rewrites. \
         Writes and commands are shown to the user for approval before they run, so explain briefly what each one is for. \
         After changing code, run the project's test or type-check script when one exists, then summarise what you changed."
    )
}

/// A file as it was before the current turn first touched it (`None`: it did not exist).
struct Snapshot {
    path: std::path::PathBuf,
    before: Option<Vec<u8>>,
}

/// Snapshots of the latest turn per chat, so `/undo` can put the files back.
static UNDO: LazyLock<std::sync::Mutex<HashMap<String, Vec<Snapshot>>>> = LazyLock::new(Default::default);

/// Forgets the previous turn's snapshots; call when a new turn starts.
pub fn begin_turn(chat_id: &str) {
    UNDO.lock().unwrap().remove(chat_id);
}

fn snapshot(chat_id: &str, path: &std::path::Path) {
    let mut all = UNDO.lock().unwrap();
    let list = all.entry(chat_id.to_string()).or_default();
    // Only the state before the turn's first touch matters.
    if !list.iter().any(|s| s.path == path) {
        list.push(Snapshot { path: path.to_path_buf(), before: std::fs::read(path).ok() });
    }
}

/// Restores every file the last turn of `chat_id` wrote or edited. Returns what was done.
pub fn undo_turn(chat_id: &str) -> Result<String, String> {
    let snapshots = UNDO.lock().unwrap().remove(chat_id).unwrap_or_default();
    if snapshots.is_empty() {
        return Err("Nothing to undo: the last turn changed no files.".into());
    }
    let mut restored = Vec::new();
    for snap in snapshots.iter().rev() {
        let name = snap.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        match &snap.before {
            Some(bytes) => std::fs::write(&snap.path, bytes).map_err(|e| format!("Could not restore {name}: {e}"))?,
            None => {
                let _ = std::fs::remove_file(&snap.path);
            }
        }
        restored.push(name);
    }
    restored.reverse();
    Ok(format!("Restored {} file(s): {}", restored.len(), restored.join(", ")))
}

/// Runs the coding tools inside one workspace; skills and web tools fall through to the chat tools.
pub struct CodingTools {
    pub root: String,
    pub chat: ChatTools,
    pub chat_id: String,
    /// Extra commands the user allowed in settings.
    pub extra_commands: Vec<String>,
}

impl CodingTools {
    pub fn new(db: Arc<Mutex<Database>>, root: String) -> Self {
        Self { root, chat: ChatTools { db }, chat_id: String::new(), extra_commands: vec![] }
    }

    /// Records undo snapshots under `chat_id` and honours the user's extra allowed commands.
    pub fn for_chat(mut self, chat_id: &str, extra_commands: &str) -> Self {
        self.chat_id = chat_id.to_string();
        self.extra_commands = parse_extra_commands(extra_commands);
        self
    }
}

/// Models often send `args` separately, as the web tool allows; fold them into one command line.
fn command_line(args: &Value) -> Option<String> {
    let base = args["command"].as_str()?.trim();
    let rest = args["args"].as_array().map(|a| a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" ")).unwrap_or_default();
    let line = format!("{base} {rest}").trim().to_string();
    (!line.is_empty()).then_some(line)
}

#[async_trait]
impl ToolRunner for CodingTools {
    async fn run(&self, name: &str, args: &Value) -> Result<String, String> {
        match name {
            "write_file" | "edit_file" => {
                if !self.chat_id.is_empty() {
                    // Resolving also enforces the workspace boundary before anything is touched.
                    if let Some(path) = args["path"].as_str().and_then(|p| resolve_path(p, Some(&self.root)).ok()) {
                        snapshot(&self.chat_id, &path);
                    }
                }
                execute_tool(name, args.clone(), Some(&self.root)).await.map_err(|e| e.to_string())
            }
            "list_directory" | "search_files" | "read_file" => {
                execute_tool(name, args.clone(), Some(&self.root)).await.map_err(|e| e.to_string())
            }
            "run_command" => {
                let line = command_line(args).ok_or("missing command")?;
                run_command_with(&line, Some(&self.root), &self.extra_commands).await.map_err(|e| e.to_string())
            }
            other => self.chat.run(other, args).await,
        }
    }
}

/// A coding turn: the prompt, the conversation so far and the workspace it runs in.
pub struct CodingTurn {
    pub chat_id: String,
    pub model: String,
    pub workspace: String,
    pub history: Vec<ChatMessage>,
    pub prompt: String,
    pub mode: Mode,
}

/// Builds the request: the usual profile, skills and memories, plus the workspace
/// instructions, with the coding tools in place of the chat tools.
pub async fn prepare_coding(db: &Arc<Mutex<Database>>, registry: &ProviderRegistry, turn: CodingTurn) -> AppResult<PreparedChat> {
    let mut messages = turn.history;
    messages.push(ChatMessage::new("user", turn.prompt));
    let request = ChatRequest {
        model: turn.model,
        messages,
        chat_id: Some(turn.chat_id),
        project_root: Some(turn.workspace.clone()),
        persona: Some("coder".into()),
        // Coding turns edit files, so the model must be told about the tools even when chat search is off.
        ..Default::default()
    };
    let mut prepared = prepare_chat(db, registry, request).await?;

    let system = prepared.request.system_prompt.take().unwrap_or_default();
    let instructions = match turn.mode {
        Mode::Plan => format!("{}\n\n{PLAN_INSTRUCTIONS}", workspace_instructions(&turn.workspace)),
        Mode::Implement => workspace_instructions(&turn.workspace),
    };
    prepared.request.system_prompt = Some(format!("{system}\n\n{instructions}"));

    let supports = prepared.provider.supports_tools(&prepared.request.model).await;
    prepared.request.tools = supports.then(|| {
        let mut tools = if turn.mode == Mode::Plan { read_only_definitions() } else { definitions() };
        // Skills stay reachable, exactly as in chat.
        tools.extend(prepared.request.tools.take().unwrap_or_default().into_iter().filter(|t| t["function"]["name"] == "load_skill"));
        tools
    });
    Ok(prepared)
}

/// Remembers what a coding turn did, like the web edition, so later chats can recall it. Best effort.
pub async fn remember_turn(db: &Arc<Mutex<Database>>, embedder: &dyn Embedder, chat_id: &str, summary: &str) {
    let text = summary.trim();
    if text.chars().count() < 40 {
        return;
    }
    let (enabled, title) = {
        let db = db.lock();
        let enabled = db.get_setting("memory_enabled").ok().flatten().map(|v| v.trim() != "false").unwrap_or(true);
        (enabled, db.get_chat(chat_id).ok().flatten().map(|c| c.title))
    };
    if !enabled {
        return;
    }
    let content: String = text.chars().take(4000).collect();
    let embedding = embedder.embed(&content.chars().take(2000).collect::<String>()).await;
    let metadata = json!({ "role": "assistant", "mode": "coding", "chatId": chat_id, "chatTitle": title }).to_string();
    if let Err(error) = db.lock().upsert_memory("conversation", &content, embedding.as_deref(), Some(&metadata), Some(chat_id)) {
        eprintln!("[CODING MEMORY] Store failed: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::test_support::{MockResponse, MockServer};
    use std::collections::HashMap;

    fn workspace() -> String {
        let root = std::env::temp_dir().join(format!("vanaila-coding-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src/main.rs"), "fn main() {\n    println!(\"hi\");\n}\n").unwrap();
        root.canonicalize().unwrap().to_string_lossy().into_owned()
    }

    fn names(tools: &[Value]) -> Vec<&str> {
        tools.iter().map(|t| t["function"]["name"].as_str().unwrap()).collect()
    }

    #[test]
    fn offers_the_web_coding_tools() {
        assert_eq!(names(&definitions()), vec!["list_directory", "search_files", "read_file", "write_file", "edit_file", "run_command"]);
    }

    #[tokio::test]
    async fn tools_read_edit_write_and_search_inside_the_workspace() {
        let root = workspace();
        let tools = CodingTools::new(Arc::new(Mutex::new(Database::in_memory().unwrap())), root.clone());

        let listing = tools.run("list_directory", &json!({})).await.unwrap();
        assert!(listing.contains("- src/") && listing.contains("  - main.rs"), "{listing}");
        assert!(tools.run("read_file", &json!({ "path": "src/main.rs" })).await.unwrap().contains("println"));

        tools.run("edit_file", &json!({ "path": "src/main.rs", "old_string": "\"hi\"", "new_string": "\"hello\"" })).await.unwrap();
        tools.run("write_file", &json!({ "path": "notes/todo.txt", "content": "ship it" })).await.unwrap();
        assert_eq!(std::fs::read_to_string(format!("{root}/notes/todo.txt")).unwrap(), "ship it");
        let found = tools.run("search_files", &json!({ "query": "hello" })).await.unwrap();
        assert_eq!(found, "src/main.rs:2: println!(\"hello\");");

        // Separate `args` still form one command line; anything off the allowlist is refused.
        assert!(tools.run("run_command", &json!({ "command": "pwd" })).await.unwrap().contains("vanaila-coding"));
        assert_eq!(command_line(&json!({ "command": "git", "args": ["status", "-s"] })).as_deref(), Some("git status -s"));
        assert_eq!(command_line(&json!({ "command": " pnpm test " })).as_deref(), Some("pnpm test"));
        assert_eq!(command_line(&json!({ "command": "" })), None);
        assert!(tools.run("run_command", &json!({ "command": "rm", "args": ["-rf", "."] })).await.is_err());
        assert!(tools.run("run_command", &json!({})).await.is_err());
        assert!(tools.run("unknown_tool", &json!({})).await.is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn tools_cannot_leave_the_workspace() {
        let root = workspace();
        let tools = CodingTools::new(Arc::new(Mutex::new(Database::in_memory().unwrap())), root.clone());
        for (tool, args) in [
            ("read_file", json!({ "path": "../../etc/passwd" })),
            ("read_file", json!({ "path": "/etc/passwd" })),
            ("write_file", json!({ "path": "../escape.txt", "content": "x" })),
            ("list_directory", json!({ "path": "/" })),
            ("search_files", json!({ "query": "root", "path": "/etc" })),
        ] {
            let error = tools.run(tool, &args).await.unwrap_err();
            assert!(error.contains("outside workspace"), "{tool}: {error}");
        }
        let _ = std::fs::remove_dir_all(root);
    }

    async fn ollama(tools: bool) -> MockServer {
        MockServer::start(move |_, path, _| match path {
            "/api/show" => MockResponse::json(if tools { "{\"capabilities\":[\"completion\",\"tools\"]}" } else { "{\"capabilities\":[\"completion\"]}" }),
            _ => MockResponse::status(500, "{}"),
        })
        .await
    }

    fn turn(root: &str) -> CodingTurn {
        CodingTurn {
            chat_id: "c1".into(),
            model: "qwen3:8b".into(),
            workspace: root.into(),
            history: vec![ChatMessage::new("user", "earlier question"), ChatMessage::new("assistant", "earlier answer")],
            prompt: "add a flag".into(),
            mode: Mode::Implement,
        }
    }

    #[tokio::test]
    async fn the_turn_gets_workspace_instructions_history_and_coding_tools() {
        let server = ollama(true).await;
        let registry = ProviderRegistry::from_settings(&HashMap::from([("ollama_host".to_string(), server.url())]), &|_| None);
        let db = Arc::new(Mutex::new(Database::in_memory().unwrap()));
        db.lock().upsert_skill("s1", "writer", Some("Drafts"), "body", None, true).unwrap();

        let prepared = prepare_coding(&db, &registry, turn("/work/app")).await.unwrap();
        let system = prepared.request.system_prompt.unwrap();
        assert!(system.contains("expert software engineer"), "coder persona");
        assert!(system.contains("[Coding Workspace]") && system.contains("/work/app"), "{system}");

        let roles: Vec<&str> = prepared.request.messages.iter().map(|m| m.role.as_str()).collect();
        assert_eq!(roles, vec!["user", "assistant", "user"]);
        assert_eq!(prepared.request.messages[2].content, "add a flag");

        let tool_names = names(prepared.request.tools.as_ref().unwrap());
        assert_eq!(tool_names, vec!["list_directory", "search_files", "read_file", "write_file", "edit_file", "run_command", "load_skill"]);
        assert!(prepared.approval_required, "writes and commands are gated by default");
    }

    #[tokio::test]
    async fn a_model_without_tool_support_gets_none() {
        let server = ollama(false).await;
        let registry = ProviderRegistry::from_settings(&HashMap::from([("ollama_host".to_string(), server.url())]), &|_| None);
        let db = Arc::new(Mutex::new(Database::in_memory().unwrap()));
        let prepared = prepare_coding(&db, &registry, turn("/work/app")).await.unwrap();
        assert!(prepared.request.tools.is_none());
    }

    /// The model asks to write a file on its first reply and wraps up on its second.
    async fn scripted_model() -> MockServer {
        let calls = std::sync::atomic::AtomicUsize::new(0);
        MockServer::start(move |_, path, _| {
            if path == "/api/show" {
                return MockResponse::json("{\"capabilities\":[\"completion\",\"tools\"]}");
            }
            // Memory recall also calls /api/embed; only chat turns advance the script.
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

    /// Answers every approval request the way the test wants, like a user clicking a button.
    struct Clicker {
        approve: bool,
        approvals: Arc<crate::services::ApprovalService>,
        events: std::sync::Mutex<Vec<Value>>,
    }
    impl crate::chat::agent::EventSink for Clicker {
        fn emit(&self, event: Value) {
            if let Some(id) = event["approval_request"]["id"].as_str() {
                let (approvals, id, approve) = (self.approvals.clone(), id.to_string(), self.approve);
                tokio::spawn(async move { approvals.resolve(&id, approve).await });
            }
            self.events.lock().unwrap().push(event);
        }
    }

    async fn run_turn(approve: bool) -> (String, Vec<Value>) {
        use crate::chat::agent::{run_agent, AgentDeps, APPROVAL_TIMEOUT};
        let server = scripted_model().await;
        let registry = ProviderRegistry::from_settings(&HashMap::from([("ollama_host".to_string(), server.url())]), &|_| None);
        let db = Arc::new(Mutex::new(Database::in_memory().unwrap()));
        let root = workspace();

        let prepared = prepare_coding(&db, &registry, turn(&root)).await.unwrap();
        let approvals = Arc::new(crate::services::ApprovalService::new());
        let sink = Clicker { approve, approvals: approvals.clone(), events: Default::default() };
        let runner = CodingTools::new(db, root.clone());
        let deps = AgentDeps {
            provider: prepared.provider.as_ref(),
            runner: &runner,
            sink: &sink,
            approvals: &approvals,
            approval_required: prepared.approval_required,
            approval_timeout: APPROVAL_TIMEOUT,
            read_only: false,
        };
        let (_tx, cancel) = tokio::sync::watch::channel(false);
        run_agent(&deps, prepared.request, cancel).await.unwrap();
        let events = sink.events.lock().unwrap().clone();
        (root, events)
    }

    #[tokio::test]
    async fn an_approved_write_lands_in_the_workspace() {
        let (root, events) = run_turn(true).await;
        assert_eq!(std::fs::read_to_string(format!("{root}/hello.txt")).unwrap(), "hi");
        let kinds: Vec<&str> = events
            .iter()
            .map(|e| if e.get("approval_request").is_some() { "approval" } else if e.get("approval_resolved").is_some() { "resolved" } else if e["tool_event"] == true { "tool" } else if e["done"] == true { "done" } else { "text" })
            .collect();
        assert_eq!(kinds, vec!["approval", "resolved", "tool", "tool", "text", "done"]);
        assert_eq!(events[0]["approval_request"]["summary"], "Write hello.txt (2 bytes)");
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn a_declined_write_changes_nothing() {
        let (root, events) = run_turn(false).await;
        assert!(!std::path::Path::new(&format!("{root}/hello.txt")).exists());
        assert!(events.iter().any(|e| e["approval_resolved"]["approved"] == false));
        assert!(events.iter().any(|e| e["tool_event"] == true && e["detail"] == "Declined by user"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn plan_mode_offers_only_read_tools_and_says_not_to_change_anything() {
        let server = ollama(true).await;
        let registry = ProviderRegistry::from_settings(&HashMap::from([("ollama_host".to_string(), server.url())]), &|_| None);
        let db = Arc::new(Mutex::new(Database::in_memory().unwrap()));
        let mut plan = turn("/work/app");
        plan.mode = Mode::Plan;
        let prepared = prepare_coding(&db, &registry, plan).await.unwrap();
        assert_eq!(names(prepared.request.tools.as_ref().unwrap()), vec!["list_directory", "search_files", "read_file"]);
        let system = prepared.request.system_prompt.unwrap();
        assert!(system.contains("[Plan Mode]") && system.contains("numbered plan"), "{system}");
        assert_eq!(Mode::parse(Some("PLAN")), Mode::Plan);
        assert_eq!(Mode::parse(Some("implement")), Mode::Implement);
        assert_eq!(Mode::parse(None), Mode::Implement);
    }

    #[tokio::test]
    async fn undo_restores_edited_files_and_removes_new_ones() {
        let root = workspace();
        let chat = format!("undo-{}", uuid::Uuid::new_v4());
        let tools = CodingTools::new(Arc::new(Mutex::new(Database::in_memory().unwrap())), root.clone()).for_chat(&chat, "");
        assert!(undo_turn(&chat).is_err(), "nothing to undo before any change");

        begin_turn(&chat);
        tools.run("edit_file", &json!({ "path": "src/main.rs", "old_string": "\"hi\"", "new_string": "\"yo\"" })).await.unwrap();
        tools.run("edit_file", &json!({ "path": "src/main.rs", "old_string": "\"yo\"", "new_string": "\"hey\"" })).await.unwrap();
        tools.run("write_file", &json!({ "path": "new/file.txt", "content": "x" })).await.unwrap();

        let message = undo_turn(&chat).unwrap();
        assert!(message.starts_with("Restored 2 file(s)"), "{message}");
        assert!(std::fs::read_to_string(format!("{root}/src/main.rs")).unwrap().contains("\"hi\""), "back to the state before the first edit");
        assert!(!std::path::Path::new(&format!("{root}/new/file.txt")).exists());
        assert!(undo_turn(&chat).is_err(), "undo works once");
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn a_new_turn_forgets_the_previous_turns_snapshots() {
        let root = workspace();
        let chat = format!("undo-{}", uuid::Uuid::new_v4());
        let tools = CodingTools::new(Arc::new(Mutex::new(Database::in_memory().unwrap())), root.clone()).for_chat(&chat, "");
        tools.run("write_file", &json!({ "path": "a.txt", "content": "1" })).await.unwrap();
        begin_turn(&chat);
        assert!(undo_turn(&chat).is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn extra_allowed_commands_run_and_others_are_still_refused() {
        let root = workspace();
        let db = || Arc::new(Mutex::new(Database::in_memory().unwrap()));
        let denied = CodingTools::new(db(), root.clone()).run("run_command", &json!({ "command": "uname" })).await.unwrap_err();
        assert!(denied.contains("not in the security allowlist"), "{denied}");

        let allowed = CodingTools::new(db(), root.clone()).for_chat("c", "uname\nbash");
        assert!(!allowed.run("run_command", &json!({ "command": "uname" })).await.unwrap().is_empty());
        assert!(allowed.run("run_command", &json!({ "command": "bash", "args": ["-c", "id"] })).await.is_err(), "shells stay refused");
        let _ = std::fs::remove_dir_all(root);
    }

    struct Fixed;
    #[async_trait]
    impl Embedder for Fixed {
        async fn embed(&self, _: &str) -> Option<Vec<f32>> {
            Some(vec![1.0, 0.0])
        }
    }

    #[tokio::test]
    async fn a_turn_summary_is_remembered_unless_short_or_memory_is_off() {
        let db = Arc::new(Mutex::new(Database::in_memory().unwrap()));
        db.lock().upsert_chat("c1", "Add flag", None, None, None, None, None).unwrap();

        remember_turn(&db, &Fixed, "c1", "ok").await;
        assert!(db.lock().list_memories(None).unwrap().is_empty(), "too short");

        let summary = "Added a --verbose flag to the CLI parser and covered it with two tests.";
        remember_turn(&db, &Fixed, "c1", summary).await;
        let memories = db.lock().list_memories(None).unwrap();
        assert_eq!(memories.len(), 1);
        assert!(memories[0].metadata.as_deref().unwrap().contains("\"mode\":\"coding\""));
        assert_eq!(memories[0].source_id.as_deref(), Some("c1"));

        db.lock().set_setting("memory_enabled", "false").unwrap();
        remember_turn(&db, &Fixed, "c1", "A completely different and sufficiently long summary of work done.").await;
        assert_eq!(db.lock().list_memories(None).unwrap().len(), 1, "memory switched off");
    }

    #[tokio::test]
    async fn read_file_takes_a_line_range() {
        let root = workspace();
        let tools = CodingTools::new(Arc::new(Mutex::new(Database::in_memory().unwrap())), root.clone());
        let out = tools.run("read_file", &json!({ "path": "src/main.rs", "start_line": 2, "end_line": 2 })).await.unwrap();
        assert_eq!(out, "[lines 2-2 of 3]\n    println!(\"hi\");");
        let _ = std::fs::remove_dir_all(root);
    }
}
