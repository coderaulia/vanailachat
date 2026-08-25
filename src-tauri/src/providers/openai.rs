use super::traits::*;
use crate::error::{AppError, AppResult};
use async_trait::async_trait;
use eventsource_stream::Eventsource;
use futures::StreamExt;
use reqwest::Client;
use serde::Deserialize;

pub struct OpenAiProvider {
    client: Client,
    api_key: String,
    base_url: String,
    provider_id: &'static str,
}

impl OpenAiProvider {
    pub fn new(api_key: String, base_url: Option<String>, provider_id: &'static str) -> Self {
        Self {
            client: Client::new(),
            api_key,
            base_url: base_url.unwrap_or_else(|| "https://api.openai.com/v1".to_string()),
            provider_id,
        }
    }
}

#[derive(Deserialize)]
struct OpenAiChatChunk {
    choices: Option<Vec<OpenAiChoice>>,
    usage: Option<OpenAiUsage>,
}

#[derive(Deserialize)]
struct OpenAiChoice {
    delta: Option<OpenAiDelta>,
    finish_reason: Option<String>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct OpenAiDelta {
    role: Option<String>,
    content: Option<String>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct OpenAiUsage {
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
}

#[async_trait]
impl LlmProvider for OpenAiProvider {
    fn id(&self) -> &'static str {
        self.provider_id
    }

    async fn list_models(&self) -> AppResult<Vec<ModelInfo>> {
        if self.api_key.is_empty() {
            return Ok(vec![]);
        }

        // Return popular models for OpenAI / OpenRouter
        if self.provider_id == "openai" {
            return Ok(vec![
                ModelInfo {
                    id: "openai:gpt-4o".to_string(),
                    name: "GPT-4o".to_string(),
                    provider: "openai".to_string(),
                    context_length: Some(128000),
                    vision: true,
                    tools: true,
                },
                ModelInfo {
                    id: "openai:gpt-4o-mini".to_string(),
                    name: "GPT-4o Mini".to_string(),
                    provider: "openai".to_string(),
                    context_length: Some(128000),
                    vision: true,
                    tools: true,
                },
            ]);
        }

        Ok(vec![])
    }

    async fn chat(&self, request: ChatRequest) -> AppResult<ChunkStream> {
        let url = format!("{}/chat/completions", self.base_url);
        let mut messages = Vec::new();

        if let Some(sys) = request.system_prompt {
            messages.push(serde_json::json!({
                "role": "system",
                "content": sys
            }));
        }

        for m in request.messages {
            messages.push(serde_json::json!({
                "role": m.role,
                "content": m.content
            }));
        }

        let model_clean = request
            .model
            .strip_prefix(&format!("{}:", self.provider_id))
            .unwrap_or(&request.model);

        let body = serde_json::json!({
            "model": model_clean,
            "messages": messages,
            "stream": true,
            "stream_options": { "include_usage": true },
            "temperature": request.temperature.unwrap_or(0.7)
        });

        let resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&body)
            .send()
            .await
            .map_err(AppError::Network)?;

        let mut event_stream = resp.bytes_stream().eventsource();

        let chunk_stream = async_stream::stream! {
            while let Some(event_res) = event_stream.next().await {
                match event_res {
                    Ok(event) => {
                        let data = event.data.trim();
                        if data == "[DONE]" {
                            yield Ok(StreamChunk {
                                message: None,
                                tool_calls: None,
                                tool_event: None,
                                approval_request: None,
                                done: true,
                                prompt_eval_count: None,
                                eval_count: None,
                                error: None,
                            });
                            break;
                        }
                        if let Ok(parsed) = serde_json::from_str::<OpenAiChatChunk>(data) {
                            let mut text = String::new();
                            let mut done = false;
                            if let Some(choices) = parsed.choices {
                                if let Some(first) = choices.first() {
                                    if let Some(delta) = &first.delta {
                                        if let Some(c) = &delta.content {
                                            text.push_str(c);
                                        }
                                    }
                                    if first.finish_reason.is_some() {
                                        done = true;
                                    }
                                }
                            }
                            yield Ok(StreamChunk {
                                message: if text.is_empty() {
                                    None
                                } else {
                                    Some(ChatMessage {
                                        role: "assistant".to_string(),
                                        content: text,
                                        tool_calls: None,
                                        tool_call_id: None,
                                    })
                                },
                                tool_calls: None,
                                tool_event: None,
                                approval_request: None,
                                done,
                                prompt_eval_count: parsed.usage.as_ref().and_then(|u| u.prompt_tokens),
                                eval_count: parsed.usage.as_ref().and_then(|u| u.completion_tokens),
                                error: None,
                            });
                        }
                    }
                    Err(e) => {
                        yield Err(AppError::Provider(e.to_string()));
                        break;
                    }
                }
            }
        };

        Ok(Box::pin(chunk_stream))
    }
}
