use super::traits::*;
use crate::error::{AppError, AppResult};
use async_trait::async_trait;
use futures::StreamExt;
use reqwest::Client;
use serde::Deserialize;

pub struct OllamaProvider {
    client: Client,
    base_url: String,
}

impl OllamaProvider {
    pub fn new(base_url: Option<String>) -> Self {
        Self {
            client: Client::new(),
            base_url: base_url.unwrap_or_else(|| "http://127.0.0.1:11434".to_string()),
        }
    }
}

#[derive(Deserialize)]
struct OllamaTagsResponse {
    models: Option<Vec<OllamaTagModel>>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct OllamaTagModel {
    name: String,
    model: Option<String>,
    details: Option<OllamaModelDetails>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct OllamaModelDetails {
    family: Option<String>,
    parameter_size: Option<String>,
}

#[derive(Deserialize)]
struct OllamaChatChunk {
    message: Option<OllamaChatMessage>,
    done: Option<bool>,
    prompt_eval_count: Option<u64>,
    eval_count: Option<u64>,
}

#[derive(Deserialize)]
struct OllamaChatMessage {
    role: Option<String>,
    content: Option<String>,
}

#[async_trait]
impl LlmProvider for OllamaProvider {
    fn id(&self) -> &'static str {
        "ollama"
    }

    async fn list_models(&self) -> AppResult<Vec<ModelInfo>> {
        let url = format!("{}/api/tags", self.base_url);
        let resp = match self.client.get(&url).send().await {
            Ok(r) => r,
            Err(_) => return Ok(vec![]), // Ollama might be offline
        };

        let tags: OllamaTagsResponse = resp.json().await.unwrap_or(OllamaTagsResponse { models: None });
        let mut list = Vec::new();

        if let Some(models) = tags.models {
            for m in models {
                let name = m.name.clone();
                list.push(ModelInfo {
                    id: format!("ollama:{}", name),
                    name,
                    provider: "ollama".to_string(),
                    context_length: Some(4096),
                    vision: false,
                    tools: true,
                });
            }
        }

        Ok(list)
    }

    async fn chat(&self, request: ChatRequest) -> AppResult<ChunkStream> {
        let url = format!("{}/api/chat", self.base_url);
        let mut ollama_messages = Vec::new();

        if let Some(sys) = request.system_prompt {
            ollama_messages.push(serde_json::json!({
                "role": "system",
                "content": sys,
            }));
        }

        for m in request.messages {
            ollama_messages.push(serde_json::json!({
                "role": m.role,
                "content": m.content,
            }));
        }

        let model_clean = request.model.strip_prefix("ollama:").unwrap_or(&request.model);

        let body = serde_json::json!({
            "model": model_clean,
            "messages": ollama_messages,
            "stream": true,
            "options": {
                "temperature": request.temperature.unwrap_or(0.7)
            }
        });

        let resp = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(AppError::Network)?;

        let byte_stream = resp.bytes_stream();
        let chunk_stream = byte_stream.map(|res| -> AppResult<StreamChunk> {
            let bytes = res.map_err(AppError::Network)?;
            let text = String::from_utf8_lossy(&bytes);

            for line in text.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if let Ok(parsed) = serde_json::from_str::<OllamaChatChunk>(trimmed) {
                    return Ok(StreamChunk {
                        message: parsed.message.map(|m| ChatMessage {
                            role: m.role.unwrap_or_else(|| "assistant".to_string()),
                            content: m.content.unwrap_or_default(),
                            tool_calls: None,
                            tool_call_id: None,
                        }),
                        tool_calls: None,
                        tool_event: None,
                        approval_request: None,
                        done: parsed.done.unwrap_or(false),
                        prompt_eval_count: parsed.prompt_eval_count,
                        eval_count: parsed.eval_count,
                        error: None,
                    });
                }
            }

            Ok(StreamChunk {
                message: None,
                tool_calls: None,
                tool_event: None,
                approval_request: None,
                done: false,
                prompt_eval_count: None,
                eval_count: None,
                error: None,
            })
        });

        Ok(Box::pin(chunk_stream))
    }
}

impl OllamaProvider {
    pub async fn pull_model(
        &self,
        model_name: &str,
        mut on_progress: impl FnMut(serde_json::Value) + Send + 'static,
    ) -> AppResult<()> {
        let url = format!("{}/api/pull", self.base_url);
        let resp = self
            .client
            .post(&url)
            .json(&serde_json::json!({ "name": model_name }))
            .send()
            .await
            .map_err(AppError::Network)?;

        let mut stream = resp.bytes_stream();
        let mut buffer = String::new();

        while let Some(chunk_res) = stream.next().await {
            let chunk = chunk_res.map_err(AppError::Network)?;
            let text = String::from_utf8_lossy(&chunk);
            buffer.push_str(&text);

            while let Some(idx) = buffer.find('\n') {
                let line = buffer[..idx].trim().to_string();
                buffer.drain(..=idx);
                if !line.is_empty() {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&line) {
                        on_progress(parsed);
                    }
                }
            }
        }

        if !buffer.trim().is_empty() {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(buffer.trim()) {
                on_progress(parsed);
            }
        }

        Ok(())
    }
}
