//! Tools offered to the model in ordinary chat. File and command tools are
//! reserved for the coding agent, as on the web.

use super::agent::ToolRunner;
use crate::db::Database;
use crate::tools::{read_url, search_web};
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

/// Same names and descriptions as the web backend's tools.
pub fn definitions() -> Vec<Value> {
    vec![
        function(
            "search_web",
            "Search the web for real-time information using DuckDuckGo",
            json!({ "query": { "type": "string", "description": "The search query" } }),
            &["query"],
        ),
        function(
            "read_url",
            "Fetch and extract readable text from a web page URL. Use after search_web to read the full content of a result.",
            json!({
                "url": { "type": "string", "description": "The URL to fetch and read" },
                "max_chars": { "type": "number", "description": "Max characters to return (default 8000)" },
            }),
            &["url"],
        ),
        function(
            "load_skill",
            "Load the full instructions for one of the skills listed under [Available Skills] in the system prompt. Call this before acting on a skill — the system prompt only lists names and summaries.",
            json!({ "name": { "type": "string", "description": "Skill name exactly as listed under [Available Skills]" } }),
            &["name"],
        ),
    ]
}

fn name_of(tool: &Value) -> &str {
    tool["function"]["name"].as_str().unwrap_or("")
}

/// Which tools this request may use. Mirrors `resolveTools` in the web chat route.
pub fn resolve_tools(all: Vec<Value>, supports_tools: bool, persona_allowlist: &[String], search_enabled: bool, skills_available: bool) -> Vec<Value> {
    if !supports_tools {
        return vec![];
    }
    all.into_iter()
        // Offering load_skill with nothing to load only invites made-up calls.
        .filter(|tool| skills_available || name_of(tool) != "load_skill")
        .filter(|tool| {
            persona_allowlist.is_empty()
                || persona_allowlist.iter().any(|allowed| allowed == name_of(tool))
                // load_skill is how skills are reached at all, so a persona limit must not strip it.
                || (skills_available && name_of(tool) == "load_skill")
        })
        .filter(|tool| search_enabled || name_of(tool) != "search_web")
        .collect()
}

pub struct ChatTools {
    pub db: Arc<Mutex<Database>>,
}

#[async_trait]
impl ToolRunner for ChatTools {
    async fn run(&self, name: &str, args: &Value) -> Result<String, String> {
        match name {
            "search_web" => {
                let query = args["query"].as_str().filter(|q| !q.trim().is_empty()).ok_or("missing query")?;
                search_web::search_web(query).await.map_err(|e| format!("Search failed: {e}"))
            }
            "read_url" => {
                let url = args["url"].as_str().filter(|u| !u.trim().is_empty()).ok_or("missing url")?;
                let max_chars = args["max_chars"].as_u64().map(|n| n as usize).unwrap_or(read_url::DEFAULT_MAX_CHARS);
                read_url::read_url_limited(url, max_chars).await.map_err(|e| format!("read_url failed: {e}"))
            }
            "load_skill" => {
                let wanted = args["name"].as_str().filter(|n| !n.trim().is_empty()).ok_or("missing name")?;
                let enabled = self.db.lock().list_enabled_skills().map_err(|e| e.to_string())?;
                let found = enabled
                    .iter()
                    .find(|s| s.name == wanted)
                    .or_else(|| enabled.iter().find(|s| s.name.to_lowercase() == wanted.to_lowercase()));
                match found {
                    Some(skill) => Ok(format!("[Skill: {}]\n{}", skill.name, skill.content)),
                    None => {
                        let available = enabled.iter().map(|s| s.name.as_str()).collect::<Vec<_>>().join(", ");
                        Ok(format!("Skill '{wanted}' is not enabled. Available skills: {}", if available.is_empty() { "none" } else { &available }))
                    }
                }
            }
            other => Err(format!("Unknown tool: {other}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(tools: &[Value]) -> Vec<&str> {
        tools.iter().map(name_of).collect()
    }

    #[test]
    fn offers_search_only_when_enabled_and_load_skill_only_with_skills() {
        let all = definitions();
        assert_eq!(names(&resolve_tools(all.clone(), true, &[], false, false)), vec!["read_url"]);
        assert_eq!(names(&resolve_tools(all.clone(), true, &[], true, false)), vec!["search_web", "read_url"]);
        assert_eq!(names(&resolve_tools(all.clone(), true, &[], true, true)), vec!["search_web", "read_url", "load_skill"]);
    }

    #[test]
    fn a_persona_limit_keeps_only_its_tools_but_never_strips_load_skill() {
        let all = definitions();
        let limit = vec!["search_web".to_string()];
        assert_eq!(names(&resolve_tools(all.clone(), true, &limit, true, false)), vec!["search_web"]);
        assert_eq!(names(&resolve_tools(all, true, &limit, true, true)), vec!["search_web", "load_skill"]);
    }

    #[test]
    fn models_without_tool_support_get_none() {
        assert!(resolve_tools(definitions(), false, &[], true, true).is_empty());
    }

    #[tokio::test]
    async fn load_skill_finds_enabled_skills_case_insensitively_and_lists_the_rest() {
        let db = Arc::new(Mutex::new(Database::in_memory().unwrap()));
        {
            let db = db.lock();
            db.upsert_skill("s1", "Writer", Some("d"), "Write well.", None, true).unwrap();
            db.upsert_skill("s2", "hidden", Some("d"), "secret", None, false).unwrap();
        }
        let tools = ChatTools { db };
        assert_eq!(tools.run("load_skill", &json!({"name": "writer"})).await.unwrap(), "[Skill: Writer]\nWrite well.");
        let missing = tools.run("load_skill", &json!({"name": "hidden"})).await.unwrap();
        assert_eq!(missing, "Skill 'hidden' is not enabled. Available skills: Writer");
        assert!(tools.run("load_skill", &json!({})).await.is_err());
        assert!(tools.run("rm_rf", &json!({})).await.is_err());
    }

    #[tokio::test]
    async fn read_url_refuses_internal_addresses() {
        let tools = ChatTools { db: Arc::new(Mutex::new(Database::in_memory().unwrap())) };
        let error = tools.run("read_url", &json!({"url": "http://169.254.169.254/latest"})).await.unwrap_err();
        assert!(error.contains("blocked"), "{error}");
    }
}
