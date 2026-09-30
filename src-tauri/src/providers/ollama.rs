use super::ndjson::LineSplitter;
use super::traits::*;
use crate::error::{AppError, AppResult};
use async_trait::async_trait;
use futures::StreamExt;
use parking_lot::{Mutex, RwLock};
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;

pub const DEFAULT_OLLAMA_HOST: &str = "http://127.0.0.1:11434";
pub const EMBEDDING_MODEL: &str = "nomic-embed-text";

pub struct OllamaProvider {
    client: Client,
    base_url: RwLock<String>,
    /// `/api/show` answers per model; asking on every turn would add a round trip to each message.
    tool_support: Mutex<HashMap<String, bool>>,
    /// After a failed embedding, skip the round trip for a minute so a missing
    /// model does not slow every turn (a later `ollama pull` is noticed).
    embed_down_until_ms: AtomicI64,
}

const EMBED_RETRY_MS: i64 = 60_000;

impl OllamaProvider {
    pub fn new(base_url: Option<String>) -> Self {
        Self {
            client: Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .build()
                .unwrap_or_default(),
            base_url: RwLock::new(normalize_host(base_url.as_deref().unwrap_or(DEFAULT_OLLAMA_HOST))),
            tool_support: Mutex::new(HashMap::new()),
            embed_down_until_ms: AtomicI64::new(0),
        }
    }

    pub fn base_url(&self) -> String {
        self.base_url.read().clone()
    }

    pub fn set_base_url(&self, url: &str) {
        *self.base_url.write() = normalize_host(url);
        self.tool_support.lock().clear();
    }

    /// Like `embed`, but `None` on any failure, and quiet for a minute after one.
    pub async fn embed_or_none(&self, text: &str) -> Option<Vec<f32>> {
        let now = chrono::Utc::now().timestamp_millis();
        if now < self.embed_down_until_ms.load(Ordering::Relaxed) {
            return None;
        }
        let vector = self.embed(text).await.ok();
        if vector.is_none() {
            self.embed_down_until_ms.store(now + EMBED_RETRY_MS, Ordering::Relaxed);
        }
        vector
    }

    /// Embedding vector for `text`, or an error when the embedding model is not installed.
    pub async fn embed(&self, text: &str) -> AppResult<Vec<f32>> {
        let resp = self
            .client
            .post(format!("{}/api/embed", self.base_url()))
            .timeout(Duration::from_secs(30))
            .json(&json!({ "model": EMBEDDING_MODEL, "input": text }))
            .send()
            .await
            .map_err(AppError::Network)?;
        if !resp.status().is_success() {
            return Err(AppError::Provider(format!("Embedding failed: HTTP {}", resp.status())));
        }
        let payload: Value = resp.json().await.map_err(AppError::Network)?;
        let vector: Vec<f32> = payload["embeddings"][0]
            .as_array()
            .map(|values| values.iter().filter_map(|v| v.as_f64().map(|f| f as f32)).collect())
            .unwrap_or_default();
        if vector.is_empty() {
            return Err(AppError::Provider("Empty embedding returned".into()));
        }
        Ok(vector)
    }
}

/// `localhost:11434`, `http://host:11434/` and friends → `http://host:11434`.
fn normalize_host(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return DEFAULT_OLLAMA_HOST.to_string();
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("http://{trimmed}")
    }
}

#[derive(Deserialize)]
struct TagsResponse {
    models: Option<Vec<TagModel>>,
}

#[derive(Deserialize)]
struct TagModel {
    name: String,
    #[serde(default)]
    size: Option<u64>,
    #[serde(default)]
    digest: Option<String>,
    #[serde(default)]
    modified_at: Option<String>,
    #[serde(default)]
    details: Option<TagDetails>,
}

#[derive(Deserialize, Default)]
struct TagDetails {
    family: Option<String>,
    parameter_size: Option<String>,
    quantization_level: Option<String>,
}

/// Converts our messages to Ollama's wire format.
pub(crate) fn ollama_messages(request: &ChatRequest) -> Vec<Value> {
    let mut out = Vec::new();
    if let Some(system) = request.system_prompt.as_deref().filter(|s| !s.trim().is_empty()) {
        out.push(json!({ "role": "system", "content": system }));
    }
    for message in &request.messages {
        let mut entry = json!({ "role": message.role, "content": message.content });
        if let Some(images) = message.images.as_ref().filter(|i| !i.is_empty()) {
            // Ollama wants raw base64, not a data: URL.
            let raw: Vec<String> = images
                .iter()
                .map(|image| image.split_once("base64,").map(|(_, data)| data).unwrap_or(image).to_string())
                .collect();
            entry["images"] = json!(raw);
        }
        if let Some(calls) = message.tool_calls.as_ref().filter(|c| !c.is_empty()) {
            entry["tool_calls"] = json!(calls
                .iter()
                .map(|call| json!({ "function": { "name": call.name, "arguments": call.arguments } }))
                .collect::<Vec<_>>());
        }
        if message.role == "tool" {
            if let Some(name) = &message.name {
                entry["tool_name"] = json!(name);
            }
        }
        out.push(entry);
    }
    out
}

#[async_trait]
impl LlmProvider for OllamaProvider {
    fn id(&self) -> &str {
        "ollama"
    }

    fn label(&self) -> &str {
        "Ollama"
    }

    async fn list_models(&self) -> AppResult<Vec<ModelInfo>> {
        let resp = match self
            .client
            .get(format!("{}/api/tags", self.base_url()))
            .timeout(Duration::from_secs(5))
            .send()
            .await
        {
            Ok(r) if r.status().is_success() => r,
            _ => return Ok(vec![]), // Ollama might be offline
        };

        let tags: TagsResponse = resp.json().await.unwrap_or(TagsResponse { models: None });
        Ok(tags
            .models
            .unwrap_or_default()
            .into_iter()
            .map(|m| {
                let details = m.details.unwrap_or_default();
                let lowered = m.name.to_lowercase();
                let capabilities = if lowered.contains("embed") { vec!["embedding"] } else { vec!["chat"] };
                ModelInfo {
                    name: m.name.clone(),
                    model: m.name,
                    provider: "ollama".into(),
                    provider_label: "Ollama".into(),
                    provider_kind: "ollama".into(),
                    context_window: None,
                    capabilities: capabilities.into_iter().map(String::from).collect(),
                    family: details.family,
                    parameter_size: details.parameter_size,
                    quantization_level: details.quantization_level,
                    modified_at: m.modified_at,
                    size: m.size,
                    digest: m.digest,
                }
            })
            .collect())
    }

    async fn supports_tools(&self, model: &str) -> bool {
        if let Some(known) = self.tool_support.lock().get(model) {
            return *known;
        }
        let answer = async {
            let resp = self
                .client
                .post(format!("{}/api/show", self.base_url()))
                .timeout(Duration::from_secs(10))
                .json(&json!({ "model": model }))
                .send()
                .await
                .ok()?;
            let details: Value = resp.json().await.ok()?;
            Some(
                details["capabilities"]
                    .as_array()
                    .map(|caps| caps.iter().any(|c| c.as_str() == Some("tools")))
                    .unwrap_or(false),
            )
        }
        .await;
        match answer {
            Some(value) => {
                self.tool_support.lock().insert(model.to_string(), value);
                value
            }
            // Not cached: Ollama may just be starting.
            None => false,
        }
    }

    async fn chat(&self, request: ChatRequest) -> AppResult<ChunkStream> {
        let mut body = json!({
            "model": request.model,
            "messages": ollama_messages(&request),
            "stream": true,
            "options": { "temperature": request.temperature.unwrap_or(0.7) },
        });
        if let Some(max) = request.max_tokens {
            body["options"]["num_predict"] = json!(max);
        }
        if let Some(tools) = request.tools.as_ref().filter(|t| !t.is_empty()) {
            body["tools"] = json!(tools);
        }

        let resp = self
            .client
            .post(format!("{}/api/chat", self.base_url()))
            .json(&body)
            .send()
            .await
            .map_err(AppError::Network)?;
        if !resp.status().is_success() {
            let status = resp.status();
            let detail = resp.text().await.unwrap_or_default();
            let message = serde_json::from_str::<Value>(&detail)
                .ok()
                .and_then(|v| v["error"].as_str().map(String::from))
                .unwrap_or(detail);
            return Err(AppError::Provider(format!("Ollama returned HTTP {status}: {message}")));
        }

        let mut bytes = resp.bytes_stream();
        let stream = async_stream::stream! {
            let mut splitter = LineSplitter::default();
            let mut call_counter = 0usize;
            while let Some(part) = bytes.next().await {
                let part = match part {
                    Ok(part) => part,
                    Err(error) => {
                        yield Err(AppError::Network(error));
                        return;
                    }
                };
                for line in splitter.push(&part) {
                    match parse_chat_line(&line, &mut call_counter) {
                        Ok(Some(chunk)) => yield Ok(chunk),
                        Ok(None) => {}
                        Err(error) => {
                            yield Err(error);
                            return;
                        }
                    }
                }
            }
            if let Some(line) = splitter.finish() {
                match parse_chat_line(&line, &mut call_counter) {
                    Ok(Some(chunk)) => yield Ok(chunk),
                    Ok(None) => {}
                    Err(error) => yield Err(error),
                }
            }
        };
        Ok(Box::pin(stream))
    }
}

/// One NDJSON line from `/api/chat` → a chunk. `Ok(None)` for lines that carry nothing.
fn parse_chat_line(line: &str, call_counter: &mut usize) -> AppResult<Option<StreamChunk>> {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return Ok(None);
    };
    if let Some(message) = value["error"].as_str() {
        return Err(AppError::Provider(format!("Ollama error: {message}")));
    }

    let content = value["message"]["content"].as_str().unwrap_or("");
    let tool_calls: Vec<ToolCall> = value["message"]["tool_calls"]
        .as_array()
        .map(|calls| {
            calls
                .iter()
                .filter_map(|call| {
                    let name = call["function"]["name"].as_str()?.to_string();
                    *call_counter += 1;
                    let arguments = match &call["function"]["arguments"] {
                        Value::String(text) => serde_json::from_str(text).unwrap_or_else(|_| json!({})),
                        Value::Null => json!({}),
                        other => other.clone(),
                    };
                    Some(ToolCall { id: format!("call_{}", *call_counter), name, arguments })
                })
                .collect()
        })
        .unwrap_or_default();
    let done = value["done"].as_bool().unwrap_or(false);

    if content.is_empty() && tool_calls.is_empty() && !done {
        return Ok(None);
    }
    Ok(Some(StreamChunk {
        message: (!content.is_empty()).then(|| ChatMessage::new("assistant", content)),
        tool_calls: (!tool_calls.is_empty()).then_some(tool_calls),
        done,
        prompt_eval_count: value["prompt_eval_count"].as_u64(),
        eval_count: value["eval_count"].as_u64(),
        ..Default::default()
    }))
}

impl OllamaProvider {
    pub async fn pull_model(
        &self,
        model_name: &str,
        mut on_progress: impl FnMut(serde_json::Value) + Send + 'static,
    ) -> AppResult<()> {
        let resp = self
            .client
            .post(format!("{}/api/pull", self.base_url()))
            .json(&serde_json::json!({ "name": model_name }))
            .send()
            .await
            .map_err(AppError::Network)?;
        if !resp.status().is_success() {
            let status = resp.status();
            let detail = resp.text().await.unwrap_or_default();
            return Err(AppError::Agent(format!("Ollama returned HTTP {status}: {detail}")));
        }

        let mut stream = resp.bytes_stream();
        let mut splitter = LineSplitter::default();
        let mut handle = |line: String| -> AppResult<()> {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&line) {
                pull_error(&parsed)?;
                on_progress(parsed);
            }
            Ok(())
        };

        while let Some(chunk_res) = stream.next().await {
            let chunk = chunk_res.map_err(AppError::Network)?;
            for line in splitter.push(&chunk) {
                handle(line)?;
            }
        }
        if let Some(line) = splitter.finish() {
            handle(line)?;
        }

        Ok(())
    }
}

/// Ollama reports a failed pull (unknown model, disk full) as an `{"error": ...}`
/// progress line with HTTP 200, which must not be treated as success.
fn pull_error(line: &serde_json::Value) -> AppResult<()> {
    match line.get("error").and_then(|e| e.as_str()) {
        Some(message) => Err(AppError::Agent(format!("Pull failed: {message}"))),
        None => Ok(()),
    }
}

/// Shared handle so the registry and the pull command use the same configured host.
pub type SharedOllama = Arc<OllamaProvider>;

#[cfg(test)]
mod tests {
    use super::super::test_support::{MockResponse, MockServer};
    use super::*;

    async fn collect(provider: &OllamaProvider, request: ChatRequest) -> Vec<StreamChunk> {
        let mut stream = provider.chat(request).await.expect("chat should start");
        let mut chunks = Vec::new();
        while let Some(item) = stream.next().await {
            chunks.push(item.expect("chunk"));
        }
        chunks
    }

    fn request(model: &str) -> ChatRequest {
        ChatRequest { model: model.into(), messages: vec![ChatMessage::new("user", "hi")], ..Default::default() }
    }

    #[test]
    fn error_lines_fail_the_pull() {
        assert!(pull_error(&serde_json::json!({ "status": "pulling manifest" })).is_ok());
        assert!(pull_error(&serde_json::json!({ "error": "pull model manifest: file does not exist" })).is_err());
    }

    #[test]
    fn normalizes_hosts() {
        assert_eq!(normalize_host("localhost:11434"), "http://localhost:11434");
        assert_eq!(normalize_host("http://box:11434/"), "http://box:11434");
        assert_eq!(normalize_host("  "), DEFAULT_OLLAMA_HOST);
    }

    #[tokio::test]
    async fn keeps_every_token_when_a_network_chunk_holds_several_lines_or_splits_one() {
        // Two lines in one chunk, then a line cut in half: the old parser kept only the first.
        let server = MockServer::start(|_, _, _| {
            MockResponse::ok(
                "application/x-ndjson",
                vec![
                    "{\"message\":{\"role\":\"assistant\",\"content\":\"Hel\"},\"done\":false}\n{\"message\":{\"role\":\"assistant\",\"content\":\"lo \"},\"done\":false}\n{\"message\":{\"content\":\"wor",
                    "ld\"},\"done\":false}\n{\"message\":{\"content\":\"\"},\"done\":true,\"prompt_eval_count\":7,\"eval_count\":3}\n",
                ],
            )
        })
        .await;
        let provider = OllamaProvider::new(Some(server.url()));
        let chunks = collect(&provider, request("llama3")).await;

        let text: String = chunks.iter().filter_map(|c| c.message.as_ref()).map(|m| m.content.clone()).collect();
        assert_eq!(text, "Hello world");
        let last = chunks.last().unwrap();
        assert!(last.done);
        assert_eq!((last.prompt_eval_count, last.eval_count), (Some(7), Some(3)));
    }

    #[tokio::test]
    async fn sends_tools_images_and_tool_results_in_ollama_format() {
        let server = MockServer::start(|_, _, _| MockResponse::ok("application/x-ndjson", vec!["{\"done\":true}\n"])).await;
        let provider = OllamaProvider::new(Some(server.url()));
        let mut req = request("qwen3");
        req.system_prompt = Some("Be brief.".into());
        req.tools = Some(vec![json!({"type": "function", "function": {"name": "search_web", "parameters": {}}})]);
        req.messages = vec![
            ChatMessage { images: Some(vec!["data:image/png;base64,AAAA".into()]), ..ChatMessage::new("user", "what is this?") },
            ChatMessage {
                tool_calls: Some(vec![ToolCall { id: "call_1".into(), name: "search_web".into(), arguments: json!({"query": "x"}) }]),
                ..ChatMessage::new("assistant", "")
            },
            ChatMessage { name: Some("search_web".into()), tool_call_id: Some("call_1".into()), ..ChatMessage::new("tool", "result") },
        ];
        collect(&provider, req).await;

        let (_, path, body) = server.recorded().remove(0);
        assert_eq!(path, "/api/chat");
        let body: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(body["messages"][0], json!({"role": "system", "content": "Be brief."}));
        assert_eq!(body["messages"][1]["images"], json!(["AAAA"]));
        assert_eq!(body["messages"][2]["tool_calls"][0]["function"]["arguments"], json!({"query": "x"}));
        assert_eq!(body["messages"][3]["tool_name"], "search_web");
        assert_eq!(body["tools"][0]["function"]["name"], "search_web");
    }

    #[tokio::test]
    async fn parses_tool_calls_and_gives_them_ids() {
        let server = MockServer::start(|_, _, _| {
            MockResponse::ok(
                "application/x-ndjson",
                vec!["{\"message\":{\"role\":\"assistant\",\"content\":\"\",\"tool_calls\":[{\"function\":{\"name\":\"search_web\",\"arguments\":{\"query\":\"rust\"}}}]},\"done\":false}\n{\"done\":true}\n"],
            )
        })
        .await;
        let provider = OllamaProvider::new(Some(server.url()));
        let chunks = collect(&provider, request("qwen3")).await;
        let call = &chunks[0].tool_calls.as_ref().unwrap()[0];
        assert_eq!((call.id.as_str(), call.name.as_str()), ("call_1", "search_web"));
        assert_eq!(call.arguments, json!({"query": "rust"}));
    }

    #[tokio::test]
    async fn surfaces_http_and_in_stream_errors() {
        let server = MockServer::start(|_, _, body| {
            if body.contains("missing") {
                MockResponse::status(404, "{\"error\":\"model 'missing' not found\"}")
            } else {
                MockResponse::ok("application/x-ndjson", vec!["{\"error\":\"model runner crashed\"}\n"])
            }
        })
        .await;
        let provider = OllamaProvider::new(Some(server.url()));

        let failed = provider.chat(request("missing")).await;
        assert!(failed.err().unwrap().to_string().contains("not found"));

        let mut stream = provider.chat(request("other")).await.unwrap();
        assert!(stream.next().await.unwrap().err().unwrap().to_string().contains("runner crashed"));
    }

    #[tokio::test]
    async fn checks_tool_support_once_per_model() {
        let server = MockServer::start(|_, path, body| {
            assert_eq!(path, "/api/show");
            if body.contains("qwen3") {
                MockResponse::json("{\"capabilities\":[\"completion\",\"tools\"]}")
            } else {
                MockResponse::json("{\"capabilities\":[\"completion\"]}")
            }
        })
        .await;
        let provider = OllamaProvider::new(Some(server.url()));
        assert!(provider.supports_tools("qwen3").await);
        assert!(provider.supports_tools("qwen3").await);
        assert!(!provider.supports_tools("llama2").await);
        assert_eq!(server.recorded().len(), 2, "the second qwen3 answer comes from the cache");
    }

    #[tokio::test]
    async fn lists_models_with_details_and_embeds_text() {
        let server = MockServer::start(|_, path, _| match path {
            "/api/tags" => MockResponse::json(
                "{\"models\":[{\"name\":\"llama3:latest\",\"size\":42,\"details\":{\"family\":\"llama\",\"parameter_size\":\"8B\"}},{\"name\":\"nomic-embed-text:latest\"}]}",
            ),
            "/api/embed" => MockResponse::json("{\"embeddings\":[[0.5,0.25]]}"),
            _ => MockResponse::status(404, "{}"),
        })
        .await;
        let provider = OllamaProvider::new(Some(server.url()));
        let models = provider.list_models().await.unwrap();
        assert_eq!(models[0].name, "llama3:latest");
        assert_eq!(models[0].parameter_size.as_deref(), Some("8B"));
        assert_eq!(models[1].capabilities, vec!["embedding"]);
        assert_eq!(provider.embed("hello").await.unwrap(), vec![0.5, 0.25]);
    }

    #[tokio::test]
    async fn stops_asking_for_embeddings_for_a_while_after_a_failure() {
        let server = MockServer::start(|_, _, _| MockResponse::status(404, "{\"error\":\"model not found\"}")).await;
        let provider = OllamaProvider::new(Some(server.url()));
        assert!(provider.embed_or_none("a").await.is_none());
        assert!(provider.embed_or_none("b").await.is_none());
        assert_eq!(server.recorded().len(), 1, "the second call is answered from the cooldown");
    }
}
