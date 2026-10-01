use crate::error::AppResult;
use async_trait::async_trait;
use futures::Stream;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::pin::Pin;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    #[serde(default)]
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    /// Name of the tool a `tool` message answers (Ollama wants it).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Base64 images, with or without a `data:` prefix; providers normalise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<String>>,
}

impl ChatMessage {
    pub fn new(role: &str, content: impl Into<String>) -> Self {
        Self { role: role.to_string(), content: content.into(), ..Default::default() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolStatusEvent {
    pub tool: String,
    pub status: String, // "start" | "done" | "error"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalRequest {
    pub id: String,
    pub tool: String,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StreamChunk {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_event: Option<ToolStatusEvent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_request: Option<ApprovalRequest>,
    pub done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_eval_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eval_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl StreamChunk {
    pub fn text(content: impl Into<String>) -> Self {
        Self { message: Some(ChatMessage::new("assistant", content)), ..Default::default() }
    }

    pub fn finished() -> Self {
        Self { done: true, ..Default::default() }
    }
}

/// One selectable model, shaped like the metadata the web `/api/models` returns
/// so the same frontend code reads both editions.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    /// What the UI selects and sends back: the bare name for Ollama, `provider:name` for the rest.
    pub name: String,
    pub model: String,
    pub provider: String,
    pub provider_label: String,
    pub provider_kind: String,
    pub context_window: Option<u64>,
    pub capabilities: Vec<String>,
    pub family: Option<String>,
    pub parameter_size: Option<String>,
    pub quantization_level: Option<String>,
    pub modified_at: Option<String>,
    pub size: Option<u64>,
    pub digest: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ChatRequest {
    #[serde(default)]
    pub messages: Vec<ChatMessage>,
    pub model: String,
    #[serde(default, alias = "systemPrompt")]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default, alias = "maxTokens")]
    pub max_tokens: Option<u32>,
    /// OpenAI-style function definitions offered to the model.
    #[serde(default)]
    pub tools: Option<Vec<Value>>,

    // Context the chat pipeline uses to build the prompt; providers ignore it.
    #[serde(default, alias = "chatId")]
    pub chat_id: Option<String>,
    #[serde(default, alias = "assistantMessageId")]
    pub assistant_message_id: Option<String>,
    #[serde(default, alias = "projectId")]
    pub project_id: Option<String>,
    #[serde(default, alias = "projectRoot")]
    pub project_root: Option<String>,
    #[serde(default)]
    pub search: bool,
    #[serde(default)]
    pub persona: Option<String>,
    /// Internal calls (title generation) skip profile, memory and tools.
    #[serde(default, alias = "skipMemory")]
    pub skip_memory: bool,
}

pub type ChunkStream = Pin<Box<dyn Stream<Item = AppResult<StreamChunk>> + Send>>;

#[async_trait]
pub trait LlmProvider: Send + Sync {
    fn id(&self) -> &str;
    fn label(&self) -> &str;
    async fn list_models(&self) -> AppResult<Vec<ModelInfo>>;
    async fn chat(&self, request: ChatRequest) -> AppResult<ChunkStream>;

    /// Whether `model` accepts tool definitions. Sending them to one that does
    /// not makes the provider reject the whole request.
    async fn supports_tools(&self, _model: &str) -> bool {
        true
    }
}
