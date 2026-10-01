//! One provider for everything that speaks OpenAI's `/chat/completions`:
//! OpenAI, OpenRouter, 9Router and user-defined custom endpoints.

use super::traits::*;
use crate::error::{AppError, AppResult};
use async_trait::async_trait;
use eventsource_stream::Eventsource;
use futures::StreamExt;
use reqwest::{Client, RequestBuilder, Response};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::time::Duration;

const REFERER: &str = "https://github.com/coderaulia/vanailachat";
const TITLE: &str = "VanailaChat";

#[derive(Debug, Clone)]
pub struct CompatConfig {
    pub id: String,
    pub label: String,
    /// `openai`, `openrouter`, `9router` or `custom`; drives the provider badge.
    pub kind: String,
    pub base_url: String,
    pub api_key: String,
    /// Model ids the user typed in (for gateways without a `/models` listing).
    pub extra_models: Vec<String>,
}

pub struct OpenAiCompatProvider {
    config: CompatConfig,
    client: Client,
}

/// `https://x/v1/`, `https://x/v1/chat/completions` → `https://x/v1`.
pub fn normalize_base_url(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches('/');
    trimmed.strip_suffix("/chat/completions").unwrap_or(trimmed).trim_end_matches('/').to_string()
}

impl OpenAiCompatProvider {
    pub fn new(mut config: CompatConfig) -> Self {
        config.base_url = normalize_base_url(&config.base_url);
        config.api_key = config.api_key.trim().to_string();
        Self {
            config,
            client: Client::builder().connect_timeout(Duration::from_secs(15)).build().unwrap_or_default(),
        }
    }

    fn authorized(&self, request: RequestBuilder) -> RequestBuilder {
        let request = request.header("HTTP-Referer", REFERER).header("X-Title", TITLE);
        if self.config.api_key.is_empty() {
            request
        } else {
            request.bearer_auth(&self.config.api_key)
        }
    }

    fn model_info(&self, id: &str, context_window: Option<u64>, capabilities: Vec<String>) -> ModelInfo {
        ModelInfo {
            name: format!("{}:{}", self.config.id, id),
            model: id.to_string(),
            provider: self.config.id.clone(),
            provider_label: self.config.label.clone(),
            provider_kind: self.config.kind.clone(),
            context_window,
            capabilities,
            ..Default::default()
        }
    }
}

/// Context size from the fields gateways use, else a guess from well-known OpenAI ids.
fn context_window_of(entry: &Value) -> Option<u64> {
    for key in ["context_length", "max_model_len", "context_window", "max_context_length"] {
        if let Some(n) = entry[key].as_u64().filter(|n| *n > 0) {
            return Some(n);
        }
    }
    if let Some(n) = entry["top_provider"]["context_length"].as_u64().filter(|n| *n > 0) {
        return Some(n);
    }
    let id = entry["id"].as_str()?.to_lowercase();
    if id.contains("o1") || id.contains("o3") {
        Some(200_000)
    } else if id.contains("gpt-4o") || id.contains("gpt-4-turbo") || id.contains("gpt-4.5") {
        Some(128_000)
    } else if id.contains("gpt-4") {
        Some(8_192)
    } else if id.contains("gpt-3.5") {
        Some(16_384)
    } else {
        None
    }
}

fn capabilities_of(entry: &Value) -> Vec<String> {
    let vision = entry["architecture"]["modality"].as_str().is_some_and(|m| m.to_lowercase().contains("image"));
    let mut caps = vec!["chat".to_string()];
    if vision {
        caps.push("vision".into());
    }
    caps.push("tools".into());
    caps
}

fn data_url(image: &str) -> String {
    if image.starts_with("data:") || image.starts_with("http://") || image.starts_with("https://") {
        return image.to_string();
    }
    let mime = if image.starts_with("/9j/") {
        "image/jpeg"
    } else if image.starts_with("UklGR") {
        "image/webp"
    } else if image.starts_with("R0lGOD") {
        "image/gif"
    } else {
        "image/png"
    };
    format!("data:{mime};base64,{image}")
}

pub(crate) fn openai_messages(request: &ChatRequest) -> Vec<Value> {
    let mut out = Vec::new();
    if let Some(system) = request.system_prompt.as_deref().filter(|s| !s.trim().is_empty()) {
        out.push(json!({ "role": "system", "content": system }));
    }
    for message in &request.messages {
        let content = match message.images.as_ref().filter(|i| !i.is_empty()) {
            Some(images) => {
                let mut parts = Vec::new();
                if !message.content.is_empty() {
                    parts.push(json!({ "type": "text", "text": message.content }));
                }
                for image in images.iter().filter(|i| !i.trim().is_empty()) {
                    parts.push(json!({ "type": "image_url", "image_url": { "url": data_url(image.trim()) } }));
                }
                Value::Array(parts)
            }
            None => Value::String(message.content.clone()),
        };
        let mut entry = json!({ "role": message.role, "content": content });
        if let Some(id) = &message.tool_call_id {
            entry["tool_call_id"] = json!(id);
        }
        if let Some(calls) = message.tool_calls.as_ref().filter(|c| !c.is_empty()) {
            entry["tool_calls"] = json!(calls
                .iter()
                .map(|call| json!({
                    "id": call.id,
                    "type": "function",
                    // The API wants a JSON-encoded string; we hold an object.
                    "function": { "name": call.name, "arguments": call.arguments.to_string() },
                }))
                .collect::<Vec<_>>());
        }
        out.push(entry);
    }
    out
}

/// `{"error":{"message":"…"}}`, `{"error":"…"}` or plain text → a readable message.
fn error_message(body: &str) -> String {
    let parsed: Option<Value> = serde_json::from_str(body).ok();
    let from_json = parsed.as_ref().and_then(|v| {
        v["error"]["message"].as_str().or_else(|| v["error"].as_str()).or_else(|| v["message"].as_str()).map(String::from)
    });
    let text = from_json.unwrap_or_else(|| body.trim().to_string());
    if text.chars().count() > 400 {
        format!("{}…", text.chars().take(400).collect::<String>())
    } else {
        text
    }
}

#[derive(Default)]
struct PendingCall {
    id: String,
    name: String,
    arguments: String,
}

fn finish_calls(pending: &mut BTreeMap<u64, PendingCall>) -> Vec<ToolCall> {
    std::mem::take(pending)
        .into_iter()
        .filter(|(_, call)| !call.name.is_empty())
        .map(|(index, call)| ToolCall {
            id: if call.id.is_empty() { format!("call_{index}") } else { call.id },
            name: call.name,
            arguments: if call.arguments.trim().is_empty() {
                json!({})
            } else {
                serde_json::from_str(&call.arguments).unwrap_or_else(|_| json!({}))
            },
        })
        .collect()
}

#[async_trait]
impl LlmProvider for OpenAiCompatProvider {
    fn id(&self) -> &str {
        &self.config.id
    }

    fn label(&self) -> &str {
        &self.config.label
    }

    async fn list_models(&self) -> AppResult<Vec<ModelInfo>> {
        let mut models: Vec<ModelInfo> = Vec::new();

        if !self.config.base_url.is_empty() {
            let response = self
                .authorized(self.client.get(format!("{}/models", self.config.base_url)))
                .timeout(Duration::from_secs(10))
                .send()
                .await;
            if let Ok(resp) = response.and_then(|r| r.error_for_status()) {
                if let Ok(data) = resp.json::<Value>().await {
                    let list = data["data"].as_array().or_else(|| data.as_array()).cloned().unwrap_or_default();
                    for entry in list {
                        if let Some(id) = entry["id"].as_str().or_else(|| entry["name"].as_str()) {
                            models.push(self.model_info(id, context_window_of(&entry), capabilities_of(&entry)));
                        }
                    }
                }
            }
        }

        for id in &self.config.extra_models {
            if !models.iter().any(|m| &m.model == id) {
                models.push(self.model_info(id, None, vec!["chat".into(), "tools".into()]));
            }
        }
        Ok(models)
    }

    async fn chat(&self, request: ChatRequest) -> AppResult<ChunkStream> {
        if self.config.base_url.is_empty() {
            return Err(AppError::Provider(format!("{} has no base URL configured. Add one in Settings → AI Connection.", self.config.label)));
        }
        if self.config.api_key.is_empty() && self.config.kind != "custom" && self.config.kind != "9router" {
            return Err(AppError::Provider(format!("{} API key not configured. Add it in Settings → AI Connection.", self.config.label)));
        }

        let mut body = json!({
            "model": request.model,
            "messages": openai_messages(&request),
            "stream": true,
            "stream_options": { "include_usage": true },
            "temperature": request.temperature.unwrap_or(0.7),
        });
        if let Some(max) = request.max_tokens {
            body["max_tokens"] = json!(max);
        }
        if let Some(tools) = request.tools.as_ref().filter(|t| !t.is_empty()) {
            body["tools"] = json!(tools);
            body["tool_choice"] = json!("auto");
        }

        let url = format!("{}/chat/completions", self.config.base_url);
        let mut resp = self.authorized(self.client.post(&url)).json(&body).send().await.map_err(AppError::Network)?;

        // Some gateways reject stream_options outright; retry once without it.
        if resp.status() == reqwest::StatusCode::BAD_REQUEST {
            let detail = resp.text().await.unwrap_or_default();
            if !detail.contains("stream_options") {
                return Err(AppError::Provider(format!("{} returned HTTP 400: {}", self.config.label, error_message(&detail))));
            }
            if let Some(object) = body.as_object_mut() {
                object.remove("stream_options");
            }
            resp = self.authorized(self.client.post(&url)).json(&body).send().await.map_err(AppError::Network)?;
        }
        let resp = check_status(&self.config.label, resp).await?;
        into_stream(resp)
    }
}

async fn check_status(label: &str, resp: Response) -> AppResult<Response> {
    if resp.status().is_success() {
        return Ok(resp);
    }
    let status = resp.status();
    let detail = resp.text().await.unwrap_or_default();
    Err(AppError::Provider(format!("{label} returned HTTP {status}: {}", error_message(&detail))))
}

fn into_stream(resp: Response) -> AppResult<ChunkStream> {
    let mut events = resp.bytes_stream().eventsource();
    let stream = async_stream::stream! {
        let mut pending: BTreeMap<u64, PendingCall> = BTreeMap::new();

        while let Some(event) = events.next().await {
            let event = match event {
                Ok(event) => event,
                Err(error) => {
                    yield Err(AppError::Provider(error.to_string()));
                    return;
                }
            };
            let data = event.data.trim();
            if data == "[DONE]" {
                break;
            }
            let Ok(parsed) = serde_json::from_str::<Value>(data) else { continue };

            if let Some(message) = parsed["error"]["message"].as_str().or_else(|| parsed["error"].as_str()) {
                yield Err(AppError::Provider(message.to_string()));
                return;
            }

            let choice = &parsed["choices"][0];
            let delta = &choice["delta"];
            if let Some(calls) = delta["tool_calls"].as_array() {
                for call in calls {
                    let entry = pending.entry(call["index"].as_u64().unwrap_or(0)).or_default();
                    if let Some(id) = call["id"].as_str().filter(|s| !s.is_empty()) {
                        entry.id = id.to_string();
                    }
                    if let Some(name) = call["function"]["name"].as_str() {
                        entry.name.push_str(name);
                    }
                    if let Some(args) = call["function"]["arguments"].as_str() {
                        entry.arguments.push_str(args);
                    }
                }
            }

            let text = delta["content"].as_str().unwrap_or("");
            if !text.is_empty() {
                yield Ok(StreamChunk::text(text));
            }

            if choice["finish_reason"].as_str().is_some() && !pending.is_empty() {
                yield Ok(StreamChunk { tool_calls: Some(finish_calls(&mut pending)), ..Default::default() });
            }

            // With include_usage the counts arrive in a trailing chunk that has no choices.
            let usage = &parsed["usage"];
            if usage.is_object() {
                yield Ok(StreamChunk {
                    prompt_eval_count: usage["prompt_tokens"].as_u64(),
                    eval_count: usage["completion_tokens"].as_u64(),
                    ..Default::default()
                });
            }
        }

        if !pending.is_empty() {
            yield Ok(StreamChunk { tool_calls: Some(finish_calls(&mut pending)), ..Default::default() });
        }
        yield Ok(StreamChunk::finished());
    };
    Ok(Box::pin(stream))
}

#[cfg(test)]
mod tests {
    use super::super::test_support::{MockResponse, MockServer};
    use super::*;

    fn provider(server: &MockServer, kind: &str, key: &str) -> OpenAiCompatProvider {
        OpenAiCompatProvider::new(CompatConfig {
            id: if kind == "custom" { "custom_1".into() } else { kind.into() },
            label: "Test".into(),
            kind: kind.into(),
            base_url: format!("{}/v1/", server.url()),
            api_key: key.into(),
            extra_models: vec!["typed-model".into()],
        })
    }

    fn request(model: &str) -> ChatRequest {
        ChatRequest { model: model.into(), messages: vec![ChatMessage::new("user", "hi")], ..Default::default() }
    }

    async fn collect(p: &OpenAiCompatProvider, req: ChatRequest) -> AppResult<Vec<StreamChunk>> {
        let mut stream = p.chat(req).await?;
        let mut out = Vec::new();
        while let Some(item) = stream.next().await {
            out.push(item?);
        }
        Ok(out)
    }

    const SSE: &str = "text/event-stream";

    #[test]
    fn normalizes_base_urls() {
        assert_eq!(normalize_base_url("https://api.x.com/v1/"), "https://api.x.com/v1");
        assert_eq!(normalize_base_url(" https://api.x.com/v1/chat/completions/ "), "https://api.x.com/v1");
    }

    #[test]
    fn builds_messages_with_images_and_tool_calls() {
        let req = ChatRequest {
            system_prompt: Some("sys".into()),
            messages: vec![
                ChatMessage { images: Some(vec!["iVBORw0KGgoAAA".into()]), ..ChatMessage::new("user", "look") },
                ChatMessage {
                    tool_calls: Some(vec![ToolCall { id: "c1".into(), name: "search_web".into(), arguments: json!({"query": "x"}) }]),
                    ..ChatMessage::new("assistant", "")
                },
                ChatMessage { tool_call_id: Some("c1".into()), ..ChatMessage::new("tool", "found") },
            ],
            ..Default::default()
        };
        let messages = openai_messages(&req);
        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[1]["content"][1]["image_url"]["url"], "data:image/png;base64,iVBORw0KGgoAAA");
        assert_eq!(messages[2]["tool_calls"][0]["function"]["arguments"], "{\"query\":\"x\"}");
        assert_eq!(messages[3]["tool_call_id"], "c1");
    }

    #[tokio::test]
    async fn streams_text_and_reads_usage_from_the_trailing_chunk() {
        let server = MockServer::start(|_, _, _| {
            MockResponse::ok(
                SSE,
                vec![
                    "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n",
                    "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":9,\"completion_tokens\":2}}\n\n",
                    "data: [DONE]\n\n",
                ],
            )
        })
        .await;
        let chunks = collect(&provider(&server, "openai", "sk-test"), request("gpt-4o")).await.unwrap();

        let text: String = chunks.iter().filter_map(|c| c.message.as_ref()).map(|m| m.content.clone()).collect();
        assert_eq!(text, "Hello");
        let usage = chunks.iter().find(|c| c.prompt_eval_count.is_some()).unwrap();
        assert_eq!((usage.prompt_eval_count, usage.eval_count), (Some(9), Some(2)));
        assert!(chunks.last().unwrap().done, "done comes last, after the usage chunk");
        assert_eq!(server.header_of(0, "authorization").as_deref(), Some("Bearer sk-test"));
        assert_eq!(server.recorded()[0].1, "/v1/chat/completions");
    }

    #[tokio::test]
    async fn assembles_streamed_tool_call_arguments() {
        let server = MockServer::start(|_, _, _| {
            MockResponse::ok(
                SSE,
                vec![
                    "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_a\",\"function\":{\"name\":\"search_web\",\"arguments\":\"{\\\"que\"}}]}}]}\n\n",
                    "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"ry\\\":\\\"rust\\\"}\"}}]}}]}\n\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\ndata: [DONE]\n\n",
                ],
            )
        })
        .await;
        let mut req = request("gpt-4o");
        req.tools = Some(vec![json!({"type": "function", "function": {"name": "search_web"}})]);
        let chunks = collect(&provider(&server, "openai", "k"), req).await.unwrap();

        let calls: Vec<&ToolCall> = chunks.iter().filter_map(|c| c.tool_calls.as_ref()).flatten().collect();
        assert_eq!(calls.len(), 1, "emitted once, not per fragment");
        assert_eq!((calls[0].id.as_str(), calls[0].name.as_str()), ("call_a", "search_web"));
        assert_eq!(calls[0].arguments, json!({"query": "rust"}));

        let body: Value = serde_json::from_str(&server.recorded()[0].2).unwrap();
        assert_eq!(body["tool_choice"], "auto");
    }

    #[tokio::test]
    async fn retries_without_stream_options_when_the_gateway_rejects_them() {
        let server = MockServer::start(|_, _, body| {
            if body.contains("stream_options") {
                MockResponse::status(400, "{\"error\":{\"message\":\"Unknown field: stream_options\"}}")
            } else {
                MockResponse::ok(SSE, vec!["data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\ndata: [DONE]\n\n"])
            }
        })
        .await;
        let chunks = collect(&provider(&server, "custom", ""), request("m")).await.unwrap();
        assert_eq!(chunks[0].message.as_ref().unwrap().content, "ok");
        assert_eq!(server.recorded().len(), 2);
    }

    #[tokio::test]
    async fn reports_http_errors_instead_of_returning_an_empty_reply() {
        let server = MockServer::start(|_, _, _| MockResponse::status(401, "{\"error\":{\"message\":\"Incorrect API key\"}}")).await;
        let error = collect(&provider(&server, "openai", "bad"), request("gpt-4o")).await.err().unwrap();
        assert!(error.to_string().contains("401") && error.to_string().contains("Incorrect API key"), "{error}");
    }

    #[tokio::test]
    async fn refuses_without_a_key_unless_the_endpoint_is_local_or_custom() {
        let server = MockServer::start(|_, _, _| MockResponse::ok(SSE, vec!["data: [DONE]\n\n"])).await;
        assert!(collect(&provider(&server, "openai", ""), request("m")).await.err().unwrap().to_string().contains("API key"));
        assert!(collect(&provider(&server, "custom", ""), request("m")).await.is_ok());
    }

    #[tokio::test]
    async fn lists_discovered_models_plus_typed_ones() {
        let server = MockServer::start(|_, _, _| {
            MockResponse::json("{\"data\":[{\"id\":\"gpt-4o\"},{\"id\":\"vision-x\",\"context_length\":32000,\"architecture\":{\"modality\":\"text+image->text\"}}]}")
        })
        .await;
        let models = provider(&server, "openai", "k").list_models().await.unwrap();
        let names: Vec<&str> = models.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(names, vec!["openai:gpt-4o", "openai:vision-x", "openai:typed-model"]);
        assert_eq!(models[0].context_window, Some(128_000));
        assert_eq!(models[1].context_window, Some(32_000));
        assert!(models[1].capabilities.contains(&"vision".to_string()));
    }

    #[tokio::test]
    async fn falls_back_to_typed_models_when_discovery_fails() {
        let server = MockServer::start(|_, _, _| MockResponse::status(404, "{}")).await;
        let models = provider(&server, "custom", "").list_models().await.unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].name, "custom_1:typed-model");
        assert_eq!(models[0].provider_kind, "custom");
    }
}
