use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub instructions: Option<String>,
    #[serde(default)]
    pub memory: Option<String>,
    #[serde(default)]
    pub pinned: bool,
    #[serde(alias = "created_at")]
    pub created_at: i64,
    #[serde(alias = "updated_at", default)]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRecord {
    pub id: String,
    pub title: String,
    #[serde(alias = "project_id")]
    pub project_id: Option<String>,
    #[serde(alias = "project_root")]
    pub project_root: Option<String>,
    #[serde(alias = "system_prompt")]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub pinned: bool,
    pub model: Option<String>,
    pub role: Option<String>,
    #[serde(alias = "created_at")]
    pub created_at: i64,
    #[serde(alias = "updated_at")]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageRecord {
    pub id: String,
    #[serde(alias = "chat_id")]
    pub chat_id: String,
    pub role: String,
    pub content: String,
    #[serde(alias = "created_at")]
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingRecord {
    pub key: String,
    pub value: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRecord {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub content: String,
    #[serde(alias = "source_url")]
    pub source_url: Option<String>,
    pub enabled: bool,
    #[serde(alias = "installed_at")]
    pub installed_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRecord {
    pub id: String,
    pub content: String,
    pub embedding: String,
    pub r#type: String,
    #[serde(alias = "created_at")]
    pub created_at: i64,
    #[serde(alias = "updated_at")]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackRecord {
    #[serde(alias = "message_id")]
    pub message_id: String,
    pub rating: i32,
    #[serde(alias = "edited_content")]
    pub edited_content: Option<String>,
    pub implicit: bool,
    #[serde(alias = "created_at")]
    pub created_at: i64,
    #[serde(alias = "updated_at")]
    pub updated_at: i64,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingExample {
    pub id: String,
    #[serde(alias = "chat_id")]
    pub chat_id: String,
    #[serde(alias = "chat_title")]
    pub chat_title: String,
    #[serde(alias = "user_content")]
    pub user_content: String,
    #[serde(alias = "assistant_content")]
    pub assistant_content: String,
    pub rating: i32,
    pub edited: bool,
    #[serde(alias = "created_at")]
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodingSessionRecord {
    #[serde(alias = "chat_id")]
    pub chat_id: String,
    pub harness: String,
    #[serde(alias = "harness_session_id")]
    pub harness_session_id: Option<String>,
    #[serde(alias = "workspace_path")]
    pub workspace_path: String,
    pub status: String,
    #[serde(alias = "created_at")]
    pub created_at: i64,
    #[serde(alias = "updated_at")]
    pub updated_at: i64,
}

/// One message-body hit from full-text search (web: `GET /api/messages/search`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageSearchHit {
    pub chat_id: String,
    pub chat_title: String,
    pub project_id: Option<String>,
    pub message_id: String,
    pub role: String,
    pub snippet: String,
    pub created_at: i64,
}
