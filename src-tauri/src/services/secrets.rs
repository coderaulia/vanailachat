//! Provider credentials stay out of what the webview (and exports) can read: they
//! see a mask (`••••` plus the last four characters), and a mask sent back means
//! "leave it as it is". Mirrors src/backend/services/secrets.ts.

use serde_json::{json, Value};
use std::collections::HashMap;

pub const SECRET_SETTING_KEYS: &[&str] = &[
    "openai_api_key",
    "openrouter_api_key",
    "nine_router_api_key",
    "custom_openai_api_key",
    "pi_api_key",
    "deepseek_api_key",
];

pub const MASK_PREFIX: &str = "••••";
const CUSTOM_PROVIDERS_KEY: &str = "custom_openai_providers";
pub const MAX_SETTING_VALUE_CHARS: usize = 100_000;

pub fn mask_secret(value: &str) -> String {
    let count = value.chars().count();
    if count == 0 {
        String::new()
    } else if count >= 12 {
        format!("{MASK_PREFIX}{}", value.chars().skip(count - 4).collect::<String>())
    } else {
        MASK_PREFIX.to_string()
    }
}

pub fn is_masked(value: &str) -> bool {
    value.starts_with(MASK_PREFIX)
}

fn parse_providers(raw: &str) -> Option<Vec<Value>> {
    serde_json::from_str::<Value>(raw).ok()?.as_array().cloned()
}

/// Settings safe to hand to the webview.
pub fn mask_settings(settings: &HashMap<String, String>) -> HashMap<String, String> {
    let mut out = settings.clone();
    for key in SECRET_SETTING_KEYS {
        if let Some(value) = out.get_mut(*key) {
            *value = mask_secret(value);
        }
    }
    if let Some(providers) = out.get(CUSTOM_PROVIDERS_KEY).and_then(|raw| parse_providers(raw)) {
        let masked: Vec<Value> = providers
            .into_iter()
            .map(|mut p| {
                if let Some(key) = p["apiKey"].as_str().map(mask_secret) {
                    p["apiKey"] = json!(key);
                }
                p
            })
            .collect();
        out.insert(CUSTOM_PROVIDERS_KEY.to_string(), Value::Array(masked).to_string());
    }
    out
}

/// The value to store for an incoming write, or `None` to keep what is stored.
pub fn resolve_write(key: &str, value: &str, stored: Option<&str>) -> Option<String> {
    if SECRET_SETTING_KEYS.contains(&key) {
        return (!is_masked(value)).then(|| value.to_string());
    }
    if key == CUSTOM_PROVIDERS_KEY {
        let Some(incoming) = parse_providers(value) else { return Some(value.to_string()) };
        if !incoming.iter().any(|p| p["apiKey"].as_str().is_some_and(is_masked)) {
            return Some(value.to_string());
        }
        let known: HashMap<String, String> = stored
            .and_then(parse_providers)
            .unwrap_or_default()
            .iter()
            .filter_map(|p| Some((p["id"].as_str()?.to_string(), p["apiKey"].as_str().unwrap_or("").to_string())))
            .collect();
        let merged: Vec<Value> = incoming
            .into_iter()
            .map(|mut p| {
                if p["apiKey"].as_str().is_some_and(is_masked) {
                    let id = p["id"].as_str().unwrap_or("").to_string();
                    p["apiKey"] = json!(known.get(&id).cloned().unwrap_or_default());
                }
                p
            })
            .collect();
        return Some(Value::Array(merged).to_string());
    }
    Some(value.to_string())
}

/// Setting names are short snake_case identifiers; anything else is not ours.
pub fn is_valid_key(key: &str) -> bool {
    let mut chars = key.chars();
    key.len() <= 64
        && chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_like_the_web_backend() {
        assert_eq!(mask_secret(""), "");
        assert_eq!(mask_secret("short"), "••••");
        assert_eq!(mask_secret("sk-live-1234567890abcd"), "••••abcd");
        assert_eq!(mask_secret("ключ-секретный-1234"), "••••1234", "counts characters, not bytes");
    }

    #[test]
    fn settings_never_expose_a_key() {
        let providers = json!([{ "id": "custom", "name": "Mock", "apiKey": "sk-live-1234567890abcd" }]).to_string();
        let settings = HashMap::from([
            ("openai_api_key".to_string(), "sk-live-1234567890abcd".to_string()),
            ("pi_api_key".to_string(), "short".to_string()),
            ("ollama_host".to_string(), "http://localhost:11434".to_string()),
            (CUSTOM_PROVIDERS_KEY.to_string(), providers),
        ]);
        let masked = mask_settings(&settings);
        assert_eq!(masked["openai_api_key"], "••••abcd");
        assert_eq!(masked["pi_api_key"], "••••");
        assert_eq!(masked["ollama_host"], "http://localhost:11434");
        assert!(!format!("{masked:?}").contains("sk-live"));
        assert_eq!(parse_providers(&masked[CUSTOM_PROVIDERS_KEY]).unwrap()[0]["apiKey"], "••••abcd");
    }

    #[test]
    fn a_masked_secret_is_unchanged_and_new_or_cleared_ones_are_stored() {
        assert_eq!(resolve_write("openai_api_key", "••••abcd", Some("real")), None);
        assert_eq!(resolve_write("openai_api_key", "sk-new", Some("real")).as_deref(), Some("sk-new"));
        assert_eq!(resolve_write("openai_api_key", "", Some("real")).as_deref(), Some(""));
        assert_eq!(resolve_write("theme", "dark", None).as_deref(), Some("dark"));
    }

    #[test]
    fn masked_provider_keys_are_replaced_by_the_stored_ones() {
        let stored = json!([
            { "id": "custom", "name": "A", "apiKey": "key-for-a-123456" },
            { "id": "custom_2", "name": "B", "apiKey": "key-for-b-654321" },
        ])
        .to_string();
        let incoming = json!([
            { "id": "custom", "name": "A renamed", "apiKey": "••••3456" },
            { "id": "custom_2", "name": "B", "apiKey": "replaced-key" },
            { "id": "custom_3", "name": "C", "apiKey": "••••zzzz" },
        ])
        .to_string();
        let saved = resolve_write(CUSTOM_PROVIDERS_KEY, &incoming, Some(&stored)).unwrap();
        let keys: Vec<String> = parse_providers(&saved).unwrap().iter().map(|p| p["apiKey"].as_str().unwrap().to_string()).collect();
        assert_eq!(keys, vec!["key-for-a-123456", "replaced-key", ""]);
        assert_eq!(parse_providers(&saved).unwrap()[0]["name"], "A renamed");
    }

    #[test]
    fn validates_setting_names() {
        assert!(is_valid_key("pi_tool_policy"));
        assert!(!is_valid_key("Bad-Name"));
        assert!(!is_valid_key("../x"));
        assert!(!is_valid_key(""));
        assert!(!is_valid_key(&"a".repeat(65)));
    }
}
