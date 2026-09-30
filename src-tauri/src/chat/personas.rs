//! Persona prompts, shared with the web backend through `contracts/personas.json`
//! (generated from src/backend/services/personas.ts; a web test keeps them in sync).

use serde::Deserialize;
use std::collections::HashMap;
use std::sync::LazyLock;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Persona {
    system_prompt: String,
    #[serde(default)]
    tool_allowlist: Vec<String>,
}

#[derive(Deserialize)]
struct PersonaFile {
    personas: HashMap<String, Persona>,
}

static PERSONAS: LazyLock<HashMap<String, Persona>> = LazyLock::new(|| {
    serde_json::from_str::<PersonaFile>(include_str!("../../../contracts/personas.json"))
        .map(|file| file.personas)
        .unwrap_or_default()
});

pub fn system_prompt(id: Option<&str>) -> Option<&'static str> {
    PERSONAS.get(id?).map(|p| p.system_prompt.as_str()).filter(|p| !p.trim().is_empty())
}

/// Tools this persona may use; empty means no restriction.
pub fn tool_allowlist(id: Option<&str>) -> Vec<String> {
    id.and_then(|id| PERSONAS.get(id)).map(|p| p.tool_allowlist.clone()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_the_shared_personas() {
        assert!(system_prompt(Some("general")).unwrap().starts_with("You are a helpful assistant"));
        assert!(system_prompt(Some("coder")).unwrap().contains("software engineer"));
        assert!(system_prompt(Some("nope")).is_none());
        assert!(system_prompt(None).is_none());
    }

    #[test]
    fn exposes_tool_allowlists() {
        assert!(tool_allowlist(Some("general")).is_empty());
        assert_eq!(tool_allowlist(Some("creator")), vec!["search_web".to_string()]);
        assert!(tool_allowlist(None).is_empty());
    }
}
