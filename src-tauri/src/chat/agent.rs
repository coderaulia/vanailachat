//! The tool-using conversation loop. Mirrors `runAgentLoop` in src/backend/routes/chat.ts
//! and emits the same event shapes, so the frontend handles both editions alike.

use crate::error::{AppError, AppResult};
use crate::providers::traits::*;
use crate::services::ApprovalService;
use async_trait::async_trait;
use futures::StreamExt;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{oneshot, watch};

pub const MAX_ITERATIONS: usize = 7;
pub const APPROVAL_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// Runs tools on the model's behalf. Errors become the tool's reply, so the
/// model can adjust instead of the whole turn failing.
#[async_trait]
pub trait ToolRunner: Send + Sync {
    async fn run(&self, name: &str, args: &Value) -> Result<String, String>;
}

/// Where stream events go (the webview in the app, a vector in tests).
pub trait EventSink: Send + Sync {
    fn emit(&self, event: Value);
}

/// Tools that change state and therefore need a decision first.
pub fn is_mutating_tool(name: &str) -> bool {
    matches!(
        name.to_lowercase().as_str(),
        "write_file" | "edit_file" | "run_command" | "bash" | "write" | "edit" | "filewrite" | "fileedit" | "replace" | "notebookeditcell"
    )
}

/// What the UI needs to show a tool call: a category plus file/command.
pub struct ToolDetails {
    pub category: &'static str,
    pub path: Option<String>,
    pub command: Option<String>,
    pub details: Value,
}

fn text_of<'a>(args: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|k| args[*k].as_str())
}

pub fn normalize_details(tool: &str, args: &Value) -> ToolDetails {
    let lowered = tool.to_lowercase();
    let mut details = if args.is_object() { args.clone() } else { json!({}) };
    let path = || text_of(args, &["path", "file_path", "target_file", "filePath"]).unwrap_or("unknown file").to_string();

    let (category, file, command) = match lowered.as_str() {
        "bash" | "run_command" | "terminal" | "exec" => {
            let rest = args["args"]
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(" "))
                .unwrap_or_default();
            let base = text_of(args, &["command", "cmd"]).unwrap_or("");
            let command = format!("{base} {rest}").trim().to_string();
            ("command", None, Some(command))
        }
        "write_file" | "write" | "filewrite" | "create_file" => ("file_write", Some(path()), None),
        "edit_file" | "edit" | "fileedit" | "replace" | "notebookeditcell" => ("file_edit", Some(path()), None),
        "create_document" => ("document", Some(text_of(args, &["filename", "name"]).unwrap_or("document.docx").to_string()), None),
        _ => ("tool", None, None),
    };

    if let Some(obj) = details.as_object_mut() {
        obj.insert("category".into(), json!(category));
        if let Some(file) = &file {
            obj.insert("path".into(), json!(file));
        }
        if let Some(command) = &command {
            obj.insert("command".into(), json!(command));
        }
    }
    ToolDetails { category, path: file, command, details }
}

/// Human-readable line for the approval prompt.
pub fn describe_tool_call(tool: &str, args: &Value) -> String {
    let d = normalize_details(tool, args);
    match d.category {
        "command" => match d.command.as_deref().filter(|c| !c.is_empty()) {
            Some(command) => format!("Run {command}"),
            None => "Run terminal command".into(),
        },
        "file_write" => {
            let size = text_of(args, &["content", "text"]).map(|c| format!(" ({} bytes)", c.len())).unwrap_or_default();
            format!("Write {}{size}", d.path.as_deref().unwrap_or("file"))
        }
        "file_edit" => format!("Edit {}", d.path.as_deref().unwrap_or("file")),
        "document" => format!("Create document: {}", d.path.as_deref().unwrap_or("document")),
        _ => format!("Run tool: {tool}"),
    }
}

pub struct AgentDeps<'a> {
    pub provider: &'a dyn LlmProvider,
    pub runner: &'a dyn ToolRunner,
    pub sink: &'a dyn EventSink,
    pub approvals: &'a ApprovalService,
    pub approval_required: bool,
    pub approval_timeout: Duration,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    Finished,
    Cancelled,
}

/// Resolves when the user cancels; never resolves if the cancel handle is dropped.
async fn cancelled(rx: &mut watch::Receiver<bool>) {
    loop {
        if *rx.borrow() {
            return;
        }
        if rx.changed().await.is_err() {
            std::future::pending::<()>().await;
        }
    }
}

fn dedupe_key(name: &str, args: &Value) -> String {
    // serde_json objects are key-sorted (BTreeMap), so key order cannot hide a repeat.
    format!("{name}:{args}")
}

pub async fn run_agent(deps: &AgentDeps<'_>, mut request: ChatRequest, mut cancel: watch::Receiver<bool>) -> AppResult<Outcome> {
    let mut seen_calls: HashSet<String> = HashSet::new();
    let mut last_usage = (None, None);

    for iteration in 1..=MAX_ITERATIONS {
        let stream = tokio::select! {
            biased;
            _ = cancelled(&mut cancel) => return Ok(Outcome::Cancelled),
            started = deps.provider.chat(request.clone()) => started?,
        };
        let mut stream = stream;

        let mut text = String::new();
        let mut calls: Vec<ToolCall> = Vec::new();
        loop {
            let item = tokio::select! {
                biased;
                _ = cancelled(&mut cancel) => return Ok(Outcome::Cancelled),
                item = stream.next() => item,
            };
            let Some(item) = item else { break };
            let chunk = item?;
            if let Some(message) = &chunk.message {
                if !message.content.is_empty() {
                    text.push_str(&message.content);
                    deps.sink.emit(json!({ "message": { "role": "assistant", "content": message.content }, "done": false }));
                }
            }
            if let Some(found) = chunk.tool_calls {
                calls.extend(found);
            }
            if chunk.prompt_eval_count.is_some() || chunk.eval_count.is_some() {
                last_usage = (chunk.prompt_eval_count.or(last_usage.0), chunk.eval_count.or(last_usage.1));
            }
            if chunk.done {
                break;
            }
        }

        if calls.is_empty() {
            deps.sink.emit(json!({ "done": true, "prompt_eval_count": last_usage.0, "eval_count": last_usage.1 }));
            return Ok(Outcome::Finished);
        }

        request.messages.push(ChatMessage { tool_calls: Some(calls.clone()), ..ChatMessage::new("assistant", text) });

        let mut skipped = 0;
        for call in &calls {
            if !seen_calls.insert(dedupe_key(&call.name, &call.arguments)) {
                skipped += 1;
                continue;
            }
            let reply = match run_one(deps, iteration, call, &mut cancel).await? {
                Some(reply) => reply,
                None => return Ok(Outcome::Cancelled),
            };
            request.messages.push(ChatMessage {
                tool_call_id: Some(call.id.clone()),
                name: Some(call.name.clone()),
                ..ChatMessage::new("tool", reply)
            });
        }
        if skipped > 0 {
            deps.sink.emit(json!({ "tool_event": true, "iteration": iteration, "tool": "dedup", "status": "done",
                "category": "tool", "detail": format!("Skipped {skipped} duplicate tool call(s)") }));
        }
    }

    deps.sink.emit(json!({
        "message": { "role": "assistant", "content": format!("\n\n*Agent looped {MAX_ITERATIONS} times without finishing. Please simplify your request.*") },
        "done": true,
    }));
    Ok(Outcome::Finished)
}

fn tool_event(iteration: usize, call: &ToolCall, status: &str, detail: Option<String>) -> Value {
    let d = normalize_details(&call.name, &call.arguments);
    let mut event = json!({
        "tool_event": true, "id": call.id, "iteration": iteration, "tool": call.name, "status": status,
        "category": d.category, "file": d.path, "command": d.command,
    });
    if let Some(detail) = detail {
        event["detail"] = json!(detail.chars().take(300).collect::<String>());
    }
    event
}

/// Runs one call, gating it behind approval when needed. `None` means cancelled.
async fn run_one(deps: &AgentDeps<'_>, iteration: usize, call: &ToolCall, cancel: &mut watch::Receiver<bool>) -> AppResult<Option<String>> {
    if deps.approval_required && is_mutating_tool(&call.name) {
        let id = format!("apr_{}", uuid::Uuid::new_v4().simple());
        let (tx, rx) = oneshot::channel();
        deps.approvals.register(id.clone(), tx).await;
        deps.sink.emit(json!({ "approval_request": {
            "id": id, "tool": call.name,
            "summary": describe_tool_call(&call.name, &call.arguments),
            "details": normalize_details(&call.name, &call.arguments).details,
        }}));

        // Anything unanswered is denied: a timeout or a closed window must not become an approval.
        let approved = tokio::select! {
            biased;
            _ = cancelled(cancel) => {
                deps.approvals.resolve(&id, false).await;
                return Ok(None);
            }
            decision = tokio::time::timeout(deps.approval_timeout, rx) => match decision {
                Ok(Ok(approved)) => approved,
                _ => {
                    deps.approvals.resolve(&id, false).await;
                    false
                }
            },
        };
        deps.sink.emit(json!({ "approval_resolved": { "id": id, "approved": approved } }));

        if !approved {
            deps.sink.emit(tool_event(iteration, call, "error", Some("Declined by user".into())));
            return Ok(Some(format!("The user declined this {} call. Do not retry it; ask what to do differently.", call.name)));
        }
    }

    deps.sink.emit(tool_event(iteration, call, "start", None));
    let outcome = tokio::select! {
        biased;
        _ = cancelled(cancel) => return Ok(None),
        outcome = deps.runner.run(&call.name, &call.arguments) => outcome,
    };
    match outcome {
        Ok(result) => {
            deps.sink.emit(tool_event(iteration, call, "done", Some(result.clone())));
            Ok(Some(result))
        }
        Err(message) => {
            deps.sink.emit(tool_event(iteration, call, "error", Some(message.clone())));
            Ok(Some(format!("Error: {message}")))
        }
    }
}

/// Collects a provider's streamed answer into one string (title generation and the like).
pub async fn complete_once(provider: &dyn LlmProvider, request: ChatRequest) -> AppResult<String> {
    let mut stream = provider.chat(request).await?;
    let mut text = String::new();
    while let Some(item) = stream.next().await {
        let chunk = item?;
        if let Some(message) = chunk.message {
            text.push_str(&message.content);
        }
        if chunk.done {
            break;
        }
    }
    if text.trim().is_empty() {
        return Err(AppError::Provider("The model returned no text".into()));
    }
    Ok(text)
}

pub type SharedSink = Arc<dyn EventSink>;

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Plays back one scripted reply per call to `chat`, recording each request.
    struct ScriptedProvider {
        turns: Mutex<Vec<Vec<AppResult<StreamChunk>>>>,
        requests: Mutex<Vec<ChatRequest>>,
        hang_after_first_chunk: bool,
    }

    impl ScriptedProvider {
        fn new(turns: Vec<Vec<StreamChunk>>) -> Self {
            Self {
                turns: Mutex::new(turns.into_iter().map(|t| t.into_iter().map(Ok).collect()).collect()),
                requests: Mutex::new(vec![]),
                hang_after_first_chunk: false,
            }
        }
    }

    #[async_trait]
    impl LlmProvider for ScriptedProvider {
        fn id(&self) -> &str {
            "scripted"
        }
        fn label(&self) -> &str {
            "Scripted"
        }
        async fn list_models(&self) -> AppResult<Vec<ModelInfo>> {
            Ok(vec![])
        }
        async fn chat(&self, request: ChatRequest) -> AppResult<ChunkStream> {
            self.requests.lock().unwrap().push(request);
            let mut turns = self.turns.lock().unwrap();
            assert!(!turns.is_empty(), "the model was asked more times than scripted");
            let turn = turns.remove(0);
            let hang = self.hang_after_first_chunk;
            Ok(Box::pin(async_stream::stream! {
                for item in turn {
                    yield item;
                }
                if hang {
                    std::future::pending::<()>().await;
                }
            }))
        }
    }

    #[derive(Default)]
    struct VecSink(Mutex<Vec<Value>>);
    impl EventSink for VecSink {
        fn emit(&self, event: Value) {
            self.0.lock().unwrap().push(event);
        }
    }
    impl VecSink {
        fn events(&self) -> Vec<Value> {
            self.0.lock().unwrap().clone()
        }
    }

    struct FnRunner(Box<dyn Fn(&str, &Value) -> Result<String, String> + Send + Sync>, Mutex<Vec<String>>);
    impl FnRunner {
        fn new(f: impl Fn(&str, &Value) -> Result<String, String> + Send + Sync + 'static) -> Self {
            Self(Box::new(f), Mutex::new(vec![]))
        }
        fn ran(&self) -> Vec<String> {
            self.1.lock().unwrap().clone()
        }
    }
    #[async_trait]
    impl ToolRunner for FnRunner {
        async fn run(&self, name: &str, args: &Value) -> Result<String, String> {
            self.1.lock().unwrap().push(name.to_string());
            (self.0)(name, args)
        }
    }

    fn text(content: &str) -> StreamChunk {
        StreamChunk::text(content)
    }

    fn done(prompt: u64, completion: u64) -> StreamChunk {
        StreamChunk { done: true, prompt_eval_count: Some(prompt), eval_count: Some(completion), ..Default::default() }
    }

    fn call(id: &str, name: &str, args: Value) -> StreamChunk {
        StreamChunk { tool_calls: Some(vec![ToolCall { id: id.into(), name: name.into(), arguments: args }]), ..Default::default() }
    }

    fn request() -> ChatRequest {
        ChatRequest { model: "m".into(), messages: vec![ChatMessage::new("user", "hi")], ..Default::default() }
    }

    struct Harness {
        sink: VecSink,
        approvals: ApprovalService,
    }

    impl Harness {
        fn new() -> Self {
            Self { sink: VecSink::default(), approvals: ApprovalService::new() }
        }

        async fn run(&self, provider: &ScriptedProvider, runner: &FnRunner, approval_required: bool) -> AppResult<Outcome> {
            let (_tx, rx) = watch::channel(false);
            self.run_with(provider, runner, approval_required, rx, Duration::from_secs(5)).await
        }

        async fn run_with(&self, provider: &ScriptedProvider, runner: &FnRunner, approval_required: bool, cancel: watch::Receiver<bool>, timeout: Duration) -> AppResult<Outcome> {
            let deps = AgentDeps { provider, runner, sink: &self.sink, approvals: &self.approvals, approval_required, approval_timeout: timeout };
            run_agent(&deps, request(), cancel).await
        }
    }

    #[tokio::test]
    async fn streams_text_then_reports_usage() {
        let provider = ScriptedProvider::new(vec![vec![text("Hel"), text("lo"), done(11, 4)]]);
        let harness = Harness::new();
        let outcome = harness.run(&provider, &FnRunner::new(|_, _| Ok(String::new())), false).await.unwrap();

        assert_eq!(outcome, Outcome::Finished);
        let events = harness.sink.events();
        assert_eq!(events[0]["message"]["content"], "Hel");
        assert_eq!(events[1]["message"]["content"], "lo");
        assert_eq!(events[2], json!({"done": true, "prompt_eval_count": 11, "eval_count": 4}));
    }

    #[tokio::test]
    async fn runs_a_tool_and_feeds_the_result_back() {
        let provider = ScriptedProvider::new(vec![
            vec![text("Let me check. "), call("c1", "search_web", json!({"query": "rust"})), done(5, 2)],
            vec![text("Found it."), done(20, 6)],
        ]);
        let runner = FnRunner::new(|name, args| Ok(format!("{name} result for {}", args["query"])));
        let harness = Harness::new();
        harness.run(&provider, &runner, false).await.unwrap();

        // The second request carries the assistant's tool call and the tool's answer.
        let second = provider.requests.lock().unwrap()[1].clone();
        let roles: Vec<&str> = second.messages.iter().map(|m| m.role.as_str()).collect();
        assert_eq!(roles, vec!["user", "assistant", "tool"]);
        assert_eq!(second.messages[1].content, "Let me check. ");
        assert_eq!(second.messages[1].tool_calls.as_ref().unwrap()[0].name, "search_web");
        assert_eq!(second.messages[2].tool_call_id.as_deref(), Some("c1"));
        assert_eq!(second.messages[2].name.as_deref(), Some("search_web"));
        assert!(second.messages[2].content.contains("search_web result for \"rust\""));

        let events = harness.sink.events();
        let statuses: Vec<&str> = events.iter().filter(|e| e["tool_event"] == true).map(|e| e["status"].as_str().unwrap()).collect();
        assert_eq!(statuses, vec!["start", "done"]);
        assert_eq!(events.last().unwrap()["prompt_eval_count"], 20, "usage of the final turn");
    }

    #[tokio::test]
    async fn a_failing_tool_is_reported_to_the_model_not_fatal() {
        let provider = ScriptedProvider::new(vec![
            vec![call("c1", "read_url", json!({"url": "http://127.0.0.1"})), done(1, 1)],
            vec![text("Could not read it."), done(2, 2)],
        ]);
        let runner = FnRunner::new(|_, _| Err("Access to private/local address is blocked".into()));
        let harness = Harness::new();
        assert_eq!(harness.run(&provider, &runner, false).await.unwrap(), Outcome::Finished);

        let second = provider.requests.lock().unwrap()[1].clone();
        assert!(second.messages[2].content.starts_with("Error: Access to private"));
        assert!(harness.sink.events().iter().any(|e| e["tool_event"] == true && e["status"] == "error"));
    }

    #[tokio::test]
    async fn skips_a_repeated_identical_call_even_with_keys_in_another_order() {
        let provider = ScriptedProvider::new(vec![
            vec![call("c1", "read_url", json!({"url": "https://a.example", "max_chars": 10})), done(1, 1)],
            vec![call("c2", "read_url", json!({"max_chars": 10, "url": "https://a.example"})), done(1, 1)],
            vec![text("ok"), done(1, 1)],
        ]);
        let runner = FnRunner::new(|_, _| Ok("page".into()));
        let harness = Harness::new();
        harness.run(&provider, &runner, false).await.unwrap();

        assert_eq!(runner.ran().len(), 1);
        assert!(harness.sink.events().iter().any(|e| e["tool"] == "dedup"));
    }

    #[tokio::test]
    async fn stops_after_the_iteration_limit() {
        let turns = (0..MAX_ITERATIONS).map(|i| vec![call(&format!("c{i}"), "search_web", json!({"query": i})), done(1, 1)]).collect();
        let provider = ScriptedProvider::new(turns);
        let harness = Harness::new();
        harness.run(&provider, &FnRunner::new(|_, _| Ok("r".into())), false).await.unwrap();

        let last = harness.sink.events().pop().unwrap();
        assert_eq!(last["done"], true);
        assert!(last["message"]["content"].as_str().unwrap().contains("looped 7 times"));
    }

    #[tokio::test]
    async fn gates_mutating_tools_behind_approval() {
        let provider = ScriptedProvider::new(vec![
            vec![call("c1", "write_file", json!({"path": "a.txt", "content": "hello"})), done(1, 1)],
            vec![text("Written."), done(2, 2)],
        ]);
        let runner = FnRunner::new(|_, _| Ok("Created a.txt".into()));
        let harness = Harness::new();

        let approve = async {
            // Wait for the request event, then answer it like the UI would.
            loop {
                let id = harness.sink.events().iter().find_map(|e| e["approval_request"]["id"].as_str().map(String::from));
                if let Some(id) = id {
                    assert!(harness.approvals.resolve(&id, true).await);
                    return;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        };
        let (outcome, _) = tokio::join!(harness.run(&provider, &runner, true), approve);
        assert_eq!(outcome.unwrap(), Outcome::Finished);

        let events = harness.sink.events();
        let request = events.iter().find(|e| e.get("approval_request").is_some()).unwrap();
        assert_eq!(request["approval_request"]["summary"], "Write a.txt (5 bytes)");
        assert_eq!(request["approval_request"]["details"]["category"], "file_write");
        assert!(events.iter().any(|e| e["approval_resolved"]["approved"] == true));
        assert_eq!(runner.ran(), vec!["write_file"]);
    }

    #[tokio::test]
    async fn a_declined_call_never_runs_and_the_model_is_told() {
        let provider = ScriptedProvider::new(vec![
            vec![call("c1", "run_command", json!({"command": "git", "args": ["status"]})), done(1, 1)],
            vec![text("Understood."), done(2, 2)],
        ]);
        let runner = FnRunner::new(|_, _| Ok("should not run".into()));
        let harness = Harness::new();
        let decline = async {
            loop {
                if let Some(id) = harness.sink.events().iter().find_map(|e| e["approval_request"]["id"].as_str().map(String::from)) {
                    harness.approvals.resolve(&id, false).await;
                    return;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        };
        let (outcome, _) = tokio::join!(harness.run(&provider, &runner, true), decline);
        outcome.unwrap();

        assert!(runner.ran().is_empty());
        let second = provider.requests.lock().unwrap()[1].clone();
        assert!(second.messages[2].content.contains("declined this run_command call"));
        let request = harness.sink.events().into_iter().find(|e| e.get("approval_request").is_some()).unwrap();
        assert_eq!(request["approval_request"]["summary"], "Run git status");
    }

    #[tokio::test]
    async fn an_unanswered_approval_times_out_as_a_denial() {
        let provider = ScriptedProvider::new(vec![
            vec![call("c1", "write_file", json!({"path": "a", "content": "x"})), done(1, 1)],
            vec![text("ok"), done(1, 1)],
        ]);
        let runner = FnRunner::new(|_, _| Ok("ran".into()));
        let harness = Harness::new();
        let (_tx, rx) = watch::channel(false);
        harness.run_with(&provider, &runner, true, rx, Duration::from_millis(30)).await.unwrap();

        assert!(runner.ran().is_empty());
        assert!(harness.sink.events().iter().any(|e| e["approval_resolved"]["approved"] == false));
    }

    #[tokio::test]
    async fn no_approval_is_asked_when_the_setting_is_off_or_the_tool_is_read_only() {
        let provider = ScriptedProvider::new(vec![
            vec![call("c1", "write_file", json!({"path": "a", "content": "x"})), call("c2", "read_file", json!({"path": "a"})), done(1, 1)],
            vec![text("ok"), done(1, 1)],
        ]);
        let runner = FnRunner::new(|_, _| Ok("ran".into()));
        let harness = Harness::new();
        harness.run(&provider, &runner, false).await.unwrap();
        assert_eq!(runner.ran(), vec!["write_file", "read_file"]);
        assert!(!harness.sink.events().iter().any(|e| e.get("approval_request").is_some()));
    }

    #[tokio::test]
    async fn cancelling_stops_the_stream_without_a_done_event() {
        let mut provider = ScriptedProvider::new(vec![vec![text("partial")]]);
        provider.hang_after_first_chunk = true;
        let harness = Harness::new();
        let (tx, rx) = watch::channel(false);

        let cancel_soon = async {
            tokio::time::sleep(Duration::from_millis(40)).await;
            tx.send(true).unwrap();
        };
        let runner = FnRunner::new(|_, _| Ok(String::new()));
        let (outcome, _) = tokio::join!(harness.run_with(&provider, &runner, false, rx, Duration::from_secs(5)), cancel_soon);

        assert_eq!(outcome.unwrap(), Outcome::Cancelled);
        assert!(!harness.sink.events().iter().any(|e| e["done"] == true));
    }

    #[tokio::test]
    async fn provider_errors_fail_the_turn() {
        let provider = ScriptedProvider::new(vec![vec![]]);
        provider.turns.lock().unwrap()[0].push(Err(AppError::Provider("boom".into())));
        let harness = Harness::new();
        let error = harness.run(&provider, &FnRunner::new(|_, _| Ok(String::new())), false).await.unwrap_err();
        assert!(error.to_string().contains("boom"));
    }

    #[test]
    fn describes_and_categorises_tool_calls() {
        assert_eq!(describe_tool_call("run_command", &json!({"command": "git", "args": ["diff", "--stat"]})), "Run git diff --stat");
        assert_eq!(describe_tool_call("edit_file", &json!({"path": "src/a.rs"})), "Edit src/a.rs");
        assert_eq!(describe_tool_call("create_document", &json!({"filename": "r.docx"})), "Create document: r.docx");
        assert_eq!(describe_tool_call("search_web", &json!({})), "Run tool: search_web");
        assert_eq!(normalize_details("Bash", &json!({"cmd": "ls"})).category, "command");
        assert!(is_mutating_tool("Write") && is_mutating_tool("run_command") && !is_mutating_tool("read_file") && !is_mutating_tool("create_document"));
    }
}
