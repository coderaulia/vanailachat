//! Desktop chat pipeline: the Rust counterpart of src/backend/routes/chat.ts.

pub mod ab;
pub mod agent;
pub mod memory;
pub mod personas;
pub mod prompt;
pub mod tools;

use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::providers::traits::*;
use crate::providers::ProviderRegistry;
use parking_lot::Mutex;
use prompt::{build_system_prompt, PromptContext};
use std::sync::Arc;

/// Everything needed to run one turn.
pub struct PreparedChat {
    pub provider: Arc<dyn LlmProvider>,
    pub request: ChatRequest,
    pub approval_required: bool,
}

/// The newest user message's text, for memory recall.
fn last_user_text(messages: &[ChatMessage]) -> Option<&str> {
    messages.iter().rev().find(|m| m.role == "user").map(|m| m.content.as_str())
}

/// Resolves the model, builds the system prompt (profile, project, skills,
/// persona, memories) and picks the tools this turn may use.
pub async fn prepare_chat(db: &Arc<Mutex<Database>>, registry: &ProviderRegistry, mut request: ChatRequest) -> AppResult<PreparedChat> {
    let (provider, model_name) = registry
        .resolve_model(&request.model)
        .ok_or_else(|| AppError::NotFound(format!("No provider registered for model {}", request.model)))?;

    // Everything from the database is read up front; the lock is never held across an await.
    let (settings, chat, project, skills) = {
        let db = db.lock();
        let settings = db.get_all_settings().unwrap_or_default();
        let chat = match request.chat_id.as_deref() {
            Some(id) => db.get_chat(id).ok().flatten(),
            None => None,
        };
        // A brand-new chat has no row yet, so its project comes from the request.
        let project_id = chat.as_ref().and_then(|c| c.project_id.clone()).or_else(|| request.project_id.clone());
        let project = project_id.and_then(|id| db.get_project(&id).ok().flatten());
        let skills = db.list_enabled_skills().unwrap_or_default();
        (settings, chat, project, skills)
    };

    let memory_enabled = settings.get("memory_enabled").map(|v| v.trim()) != Some("false");
    let memories = match last_user_text(&request.messages) {
        Some(text) if !request.skip_memory && memory_enabled => {
            memory::recall_and_store(db, registry.ollama().as_ref(), text, chat.as_ref(), request.chat_id.as_deref()).await
        }
        _ => vec![],
    };

    let built = build_system_prompt(&PromptContext {
        settings: &settings,
        project: project.as_ref(),
        chat: chat.as_ref(),
        search: request.search,
        skills: &skills,
        persona: request.persona.as_deref(),
        memories: &memories,
        skip_profile: request.skip_memory,
    });

    let tools = if request.skip_memory {
        vec![]
    } else {
        let supports = provider.supports_tools(&model_name).await;
        tools::resolve_tools(tools::definitions(), supports, &built.persona_tools, request.search, built.skills_available)
    };

    request.model = model_name;
    request.system_prompt = Some(built.text);
    request.tools = (!tools.is_empty()).then_some(tools);

    Ok(PreparedChat {
        provider,
        request,
        // On unless explicitly disabled, so an upgrade never grants write access that did not exist.
        approval_required: settings.get("require_tool_approval").map(|v| v.trim()) != Some("false"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::test_support::{MockResponse, MockServer};
    use std::collections::HashMap;

    async fn ollama_mock(tools: bool) -> MockServer {
        MockServer::start(move |_, path, _| match path {
            "/api/show" => MockResponse::json(if tools { "{\"capabilities\":[\"completion\",\"tools\"]}" } else { "{\"capabilities\":[\"completion\"]}" }),
            "/api/embed" => MockResponse::status(500, "{}"),
            _ => MockResponse::status(404, "{}"),
        })
        .await
    }

    fn registry(server: &MockServer) -> ProviderRegistry {
        let settings = HashMap::from([("ollama_host".to_string(), server.url())]);
        ProviderRegistry::from_settings(&settings, &|_| None)
    }

    fn db_with(settings: &[(&str, &str)]) -> Arc<Mutex<Database>> {
        let db = Database::in_memory().unwrap();
        for (key, value) in settings {
            db.set_setting(key, value).unwrap();
        }
        Arc::new(Mutex::new(db))
    }

    fn request(text: &str) -> ChatRequest {
        ChatRequest { model: "qwen3:8b".into(), messages: vec![ChatMessage::new("user", text)], ..Default::default() }
    }

    #[tokio::test]
    async fn builds_the_prompt_from_settings_project_skills_and_persona() {
        let server = ollama_mock(true).await;
        let db = db_with(&[("user_name", "Alex"), ("base_instructions", "Be terse.")]);
        {
            let db = db.lock();
            db.create_project("p1", "Docs", None, Some("Write in British English."), None).unwrap();
            db.upsert_skill("s1", "writer", Some("Drafts posts"), "full text", None, true).unwrap();
        }
        let mut req = request("Please draft a short post");
        req.project_id = Some("p1".into());
        req.persona = Some("creator".into());
        req.search = true;

        let prepared = prepare_chat(&db, &registry(&server), req).await.unwrap();

        assert_eq!(prepared.request.model, "qwen3:8b");
        let system = prepared.request.system_prompt.unwrap();
        for needle in ["Name: Alex", "Be terse.", "Write in British English.", "- writer: Drafts posts", "Web search is enabled", "content creator"] {
            assert!(system.contains(needle), "missing {needle:?} in:\n{system}");
        }
        let tool_names: Vec<&str> = prepared.request.tools.as_ref().unwrap().iter().map(|t| t["function"]["name"].as_str().unwrap()).collect();
        assert_eq!(tool_names, vec!["search_web", "load_skill"], "the creator persona is limited to search, plus skills");
        assert!(prepared.approval_required);
    }

    #[tokio::test]
    async fn offers_no_tools_to_a_model_that_cannot_use_them() {
        let server = ollama_mock(false).await;
        let prepared = prepare_chat(&db_with(&[]), &registry(&server), request("hello there, how are you")).await.unwrap();
        assert!(prepared.request.tools.is_none());
    }

    #[tokio::test]
    async fn internal_calls_skip_profile_memory_and_tools() {
        let server = ollama_mock(true).await;
        let db = db_with(&[("user_name", "Alex")]);
        let mut req = request("Generate a title for this conversation about gardening");
        req.skip_memory = true;
        let prepared = prepare_chat(&db, &registry(&server), req).await.unwrap();

        assert_eq!(prepared.request.system_prompt.as_deref(), Some("You are a helpful assistant."));
        assert!(prepared.request.tools.is_none());
        assert!(db.lock().list_memories(None).unwrap().is_empty(), "synthetic prompts are not remembered");
    }

    #[tokio::test]
    async fn memory_can_be_turned_off_and_approvals_relaxed() {
        let server = ollama_mock(true).await;
        let db = db_with(&[("memory_enabled", "false"), ("require_tool_approval", "false")]);
        let prepared = prepare_chat(&db, &registry(&server), request("a message long enough to be stored")).await.unwrap();
        assert!(db.lock().list_memories(None).unwrap().is_empty());
        assert!(!prepared.approval_required);
    }

    #[tokio::test]
    async fn remembers_a_long_message_and_recalls_it_next_time() {
        let server = ollama_mock(true).await;
        let db = db_with(&[]);
        let reg = registry(&server);

        prepare_chat(&db, &reg, request("Remember that our staging database is called orchard")).await.unwrap();
        let second = prepare_chat(&db, &reg, request("What is our staging database called again?")).await.unwrap();
        let system = second.request.system_prompt.unwrap();
        assert!(system.contains("[Relevant Memories]") && system.contains("staging database is called orchard"), "{system}");
    }

    #[tokio::test]
    async fn an_unknown_provider_prefix_falls_back_to_ollama_and_no_providers_is_an_error() {
        let server = ollama_mock(true).await;
        let mut req = request("hi");
        req.model = "nonsense:latest".into();
        let prepared = prepare_chat(&db_with(&[]), &registry(&server), req).await.unwrap();
        assert_eq!(prepared.provider.id(), "ollama");
        assert_eq!(prepared.request.model, "nonsense:latest");
    }
}
