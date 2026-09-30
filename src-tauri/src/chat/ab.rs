//! A/B model comparison: the Rust counterpart of src/backend/routes/ab.ts.

use super::agent::complete_once;
use super::memory::Embedder;
use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::providers::traits::{ChatMessage, ChatRequest};
use crate::providers::ProviderRegistry;
use crate::services::memory::{search_by_keyword, search_with_vector, ScoredMemory, RECALL_WINDOW};
use crate::tools::search_web::search_web;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use std::time::Instant;

#[derive(Debug, Clone, Default, Deserialize)]
pub struct AbAttachment {
    #[serde(default, rename = "type")]
    pub kind: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub content: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbRequest {
    pub prompt: String,
    pub model_a: String,
    pub model_b: String,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub search: bool,
    #[serde(default)]
    pub deep_research: bool,
    #[serde(default)]
    pub attachments: Vec<AbAttachment>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AbResult {
    pub model: String,
    pub content: String,
    pub latency_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AbResponse {
    pub a: AbResult,
    pub b: AbResult,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbPick {
    pub user_content: String,
    pub winner_content: String,
    pub winner_model: String,
    #[serde(default)]
    pub loser_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AbPickResult {
    pub chat_id: String,
    pub message_id: String,
}

pub fn validate(request: &AbRequest) -> AppResult<()> {
    for (field, value) in [("prompt", &request.prompt), ("modelA", &request.model_a), ("modelB", &request.model_b)] {
        if value.trim().is_empty() {
            return Err(AppError::InvalidRequest(format!("{field}: required string")));
        }
    }
    Ok(())
}

/// Base instructions plus whatever grounding this run asked for.
pub fn build_system(request: &AbRequest, memories: &[ScoredMemory], web: Option<&str>) -> String {
    let mut system = request
        .system_prompt
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("You are a helpful assistant.")
        .to_string();
    let web = web.map(str::trim).filter(|w| !w.is_empty());

    if request.deep_research {
        if !memories.is_empty() {
            let block = memories
                .iter()
                .enumerate()
                .map(|(i, m)| format!("[Memory {} (relevance: {:.2})] {}", i + 1, m.score, m.content))
                .collect::<Vec<_>>()
                .join("\n\n");
            system.push_str(&format!("\n\n[Relevant Memories]\n{block}"));
        }
        if let Some(web) = web {
            system.push_str(&format!("\n\n[Deep Web Research Grounding]\n{web}"));
        }
    } else if request.search {
        if let Some(web) = web {
            system.push_str(&format!("\n\n[Web Search Results]\n{web}"));
        }
    }
    system
}

/// Text attachments are inlined ahead of the prompt; images travel separately.
pub fn build_user(request: &AbRequest) -> ChatMessage {
    let with_content = |a: &&AbAttachment| a.content.as_deref().is_some_and(|c| !c.is_empty());
    let is_image = |a: &&AbAttachment| a.kind.as_deref() == Some("image");

    let files: Vec<String> = request
        .attachments
        .iter()
        .filter(with_content)
        .filter(|a| !is_image(a))
        .map(|a| format!("[File: {}]\n```\n{}\n```", a.name.as_deref().filter(|n| !n.is_empty()).unwrap_or("attachment"), a.content.as_deref().unwrap_or("")))
        .collect();
    let images: Vec<String> = request.attachments.iter().filter(with_content).filter(is_image).filter_map(|a| a.content.clone()).collect();

    let content = if files.is_empty() { request.prompt.clone() } else { format!("{}\n\n{}", files.join("\n\n"), request.prompt) };
    let mut message = ChatMessage::new("user", content);
    if !images.is_empty() {
        message.images = Some(images);
    }
    message
}

async fn recall(db: &Arc<Mutex<Database>>, embedder: &dyn Embedder, prompt: &str) -> Vec<ScoredMemory> {
    let query = embedder.embed(prompt).await;
    let Ok(entries) = db.lock().memory_vectors(RECALL_WINDOW) else { return vec![] };
    let now = chrono::Utc::now().timestamp_millis();
    match query {
        Some(vector) => search_with_vector(&entries, &vector, 5, 0.25, now),
        None => search_by_keyword(&entries, prompt, 5, 0.2, now),
    }
}

/// Runs both models on the same prompt at once. Either failing fails the comparison.
pub async fn run(db: &Arc<Mutex<Database>>, registry: &ProviderRegistry, request: &AbRequest) -> AppResult<AbResponse> {
    validate(request)?;

    let memories = if request.deep_research { recall(db, registry.ollama().as_ref(), &request.prompt).await } else { vec![] };
    let web = if request.deep_research || request.search {
        match search_web(&request.prompt).await {
            Ok(results) => Some(results),
            Err(error) => {
                eprintln!("[AB] Web search failed: {error}");
                None
            }
        }
    } else {
        None
    };

    let system = build_system(request, &memories, web.as_deref());
    let user = build_user(request);

    let run_model = |model: String| {
        let system = system.clone();
        let user = user.clone();
        async move {
            let (provider, name) = registry
                .resolve_model(&model)
                .ok_or_else(|| AppError::NotFound(format!("No provider registered for model {model}")))?;
            let started = Instant::now();
            let content = complete_once(
                provider.as_ref(),
                ChatRequest { model: name, messages: vec![user], system_prompt: Some(system), skip_memory: true, ..Default::default() },
            )
            .await?;
            Ok::<_, AppError>(AbResult { model, content, latency_ms: started.elapsed().as_millis() as u64 })
        }
    };

    let (a, b) = tokio::join!(run_model(request.model_a.clone()), run_model(request.model_b.clone()));
    Ok(AbResponse { a: a?, b: b? })
}

pub fn validate_pick(pick: &AbPick) -> AppResult<()> {
    for (field, value) in [("userContent", &pick.user_content), ("winnerContent", &pick.winner_content), ("winnerModel", &pick.winner_model)] {
        if value.trim().is_empty() {
            return Err(AppError::InvalidRequest(format!("{field}: required string")));
        }
    }
    Ok(())
}

/// Saves the winning answer as a +1 training pair in its own chat.
pub fn record_pick(db: &Database, pick: &AbPick) -> AppResult<AbPickResult> {
    validate_pick(pick)?;
    let now = chrono::Utc::now().timestamp_millis();
    let chat_id = format!("chat_{}", uuid::Uuid::new_v4().simple());
    let user_id = format!("msg_{}", uuid::Uuid::new_v4().simple());
    let message_id = format!("msg_{}", uuid::Uuid::new_v4().simple());

    let title = format!("A/B Eval — {}", chrono::Utc::now().format("%Y-%m-%d"));
    db.upsert_chat(&chat_id, &title, None, None, None, Some(&pick.winner_model), None)?;
    db.save_message(&user_id, &chat_id, "user", &pick.user_content, Some(now), None)?;
    db.save_message(&message_id, &chat_id, "assistant", &pick.winner_content, Some(now + 1), None)?;
    db.set_feedback(&message_id, 1, None, false)?;
    Ok(AbPickResult { chat_id, message_id })
}

/// Stores the winner as a memory so the recall scoring can favour it. Best effort.
pub async fn remember_pick(db: &Arc<Mutex<Database>>, embedder: &dyn Embedder, pick: &AbPick, saved: &AbPickResult) {
    let content: String = pick.winner_content.chars().take(4000).collect();
    if content.chars().count() < 20 {
        return;
    }
    let embedding = embedder.embed(&content).await;
    let metadata = json!({
        "role": "assistant",
        "rating": 1,
        "source": "ab_pick",
        "winnerModel": pick.winner_model,
        "messageId": saved.message_id,
        "chatId": saved.chat_id,
    })
    .to_string();
    if let Err(error) = db.lock().upsert_memory("assistant_positive", &content, embedding.as_deref(), Some(&metadata), Some(&saved.chat_id)) {
        eprintln!("[AB PICK] memory save failed: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::test_support::{MockResponse, MockServer};
    use async_trait::async_trait;
    use std::collections::HashMap;

    fn request() -> AbRequest {
        AbRequest { prompt: "Compare tabs and spaces".into(), model_a: "alpha:1".into(), model_b: "beta:1".into(), ..Default::default() }
    }

    fn attachment(kind: &str, name: &str, content: &str) -> AbAttachment {
        AbAttachment { kind: Some(kind.into()), name: Some(name.into()), content: Some(content.into()) }
    }

    #[test]
    fn requires_a_prompt_and_both_models() {
        assert!(validate(&request()).is_ok());
        for mutate in [|r: &mut AbRequest| r.prompt = "  ".into(), |r: &mut AbRequest| r.model_a.clear(), |r: &mut AbRequest| r.model_b.clear()] {
            let mut bad = request();
            mutate(&mut bad);
            assert!(validate(&bad).is_err());
        }
    }

    #[test]
    fn system_prompt_defaults_and_takes_grounding_by_mode() {
        let memories = [ScoredMemory { id: "m".into(), content: "likes tabs".into(), score: 0.876, metadata: None }];
        let mut req = request();
        assert_eq!(build_system(&req, &memories, Some("web")), "You are a helpful assistant.", "no grounding unless asked");

        req.search = true;
        assert_eq!(build_system(&req, &memories, Some(" web ")), "You are a helpful assistant.\n\n[Web Search Results]\nweb");

        req.deep_research = true;
        req.system_prompt = Some("  Be brief. ".into());
        let deep = build_system(&req, &memories, Some("web"));
        assert_eq!(deep, "Be brief.\n\n[Relevant Memories]\n[Memory 1 (relevance: 0.88)] likes tabs\n\n[Deep Web Research Grounding]\nweb");
    }

    #[test]
    fn attachments_are_inlined_or_sent_as_images() {
        let mut req = request();
        req.attachments = vec![attachment("file", "a.txt", "hello"), attachment("image", "p.png", "data:image/png;base64,AAAA"), attachment("file", "empty.txt", "")];
        let user = build_user(&req);
        assert_eq!(user.content, "[File: a.txt]\n```\nhello\n```\n\nCompare tabs and spaces");
        assert_eq!(user.images, Some(vec!["data:image/png;base64,AAAA".to_string()]));

        assert_eq!(build_user(&request()).images, None);
    }

    fn registry_for(server: &MockServer) -> ProviderRegistry {
        ProviderRegistry::from_settings(&HashMap::from([("ollama_host".to_string(), server.url())]), &|_| None)
    }

    #[tokio::test]
    async fn runs_both_models_and_times_each() {
        let server = MockServer::start(|_, path, body| {
            assert_eq!(path, "/api/chat");
            let reply = if body.contains("\"model\":\"one\"") { "from one" } else { "from two" };
            MockResponse::ok("application/x-ndjson", vec![&format!("{{\"message\":{{\"role\":\"assistant\",\"content\":\"{reply}\"}},\"done\":false}}\n"), "{\"done\":true}\n"])
        })
        .await;
        let db = Arc::new(Mutex::new(Database::in_memory().unwrap()));
        let req = AbRequest { model_a: "one".into(), model_b: "two".into(), ..request() };

        let response = run(&db, &registry_for(&server), &req).await.unwrap();
        assert_eq!((response.a.model.as_str(), response.a.content.as_str()), ("one", "from one"));
        assert_eq!((response.b.model.as_str(), response.b.content.as_str()), ("two", "from two"));

        let bodies: Vec<String> = server.recorded().into_iter().map(|(_, _, body)| body).collect();
        assert!(bodies.iter().all(|b| b.contains("You are a helpful assistant.") && b.contains("Compare tabs and spaces")));
    }

    #[tokio::test]
    async fn one_failing_model_fails_the_comparison() {
        let server = MockServer::start(|_, _, body| {
            if body.contains("\"model\":\"bad\"") {
                MockResponse::status(500, "{\"error\":\"model exploded\"}")
            } else {
                MockResponse::ok("application/x-ndjson", vec!["{\"message\":{\"role\":\"assistant\",\"content\":\"ok\"},\"done\":true}\n"])
            }
        })
        .await;
        let db = Arc::new(Mutex::new(Database::in_memory().unwrap()));
        let req = AbRequest { model_a: "good".into(), model_b: "bad".into(), ..request() };
        let error = run(&db, &registry_for(&server), &req).await.unwrap_err().to_string();
        assert!(error.contains("model exploded"), "{error}");
    }

    struct FixedEmbedder;
    #[async_trait]
    impl Embedder for FixedEmbedder {
        async fn embed(&self, _: &str) -> Option<Vec<f32>> {
            Some(vec![0.5, 0.5])
        }
    }

    #[tokio::test]
    async fn a_pick_saves_a_rated_pair_in_the_default_project_and_a_memory() {
        let db = Arc::new(Mutex::new(Database::in_memory().unwrap()));
        let pick = AbPick {
            user_content: "Which is better?".into(),
            winner_content: "A long and thoughtful winning answer".into(),
            winner_model: "alpha:1".into(),
            loser_model: Some("beta:1".into()),
        };
        let saved = record_pick(&db.lock(), &pick).unwrap();
        remember_pick(&db, &FixedEmbedder, &pick, &saved).await;

        let db = db.lock();
        let chat = db.get_chat(&saved.chat_id).unwrap().unwrap();
        assert!(chat.title.starts_with("A/B Eval — "));
        assert_eq!(chat.model.as_deref(), Some("alpha:1"));
        assert_eq!(chat.project_id.as_deref(), Some(db.ensure_default_project().unwrap().id.as_str()));

        let messages = db.list_messages(&saved.chat_id, None).unwrap();
        assert_eq!(messages.iter().map(|m| m.role.as_str()).collect::<Vec<_>>(), vec!["user", "assistant"]);
        assert!(messages[0].created_at < messages[1].created_at);
        let feedback = db.get_feedback(&saved.message_id).unwrap().unwrap();
        assert_eq!((feedback.rating, feedback.implicit), (1, false));

        let memory = db.list_memories(None).unwrap().remove(0);
        assert_eq!(memory.r#type, "assistant_positive");
        assert_eq!(memory.source_id.as_deref(), Some(saved.chat_id.as_str()));
        assert!(memory.metadata.unwrap().contains("ab_pick"));
    }

    #[test]
    fn a_pick_needs_all_three_fields() {
        let db = Database::in_memory().unwrap();
        let pick = AbPick { user_content: "q".into(), winner_content: " ".into(), winner_model: "m".into(), loser_model: None };
        assert!(record_pick(&db, &pick).unwrap_err().to_string().contains("winnerContent"));
    }
}
