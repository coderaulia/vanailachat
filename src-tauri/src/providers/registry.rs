use super::ollama::{OllamaProvider, DEFAULT_OLLAMA_HOST};
use super::openai_compat::{CompatConfig, OpenAiCompatProvider};
use super::traits::*;
use crate::error::AppResult;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Clone)]
pub struct ProviderRegistry {
    providers: Vec<Arc<dyn LlmProvider>>,
    ollama: Arc<OllamaProvider>,
}

#[derive(Deserialize)]
struct CustomEntry {
    id: String,
    name: String,
    #[serde(default, rename = "baseUrl")]
    base_url: String,
    #[serde(default, rename = "apiKey")]
    api_key: String,
    #[serde(default)]
    models: String,
}

/// Saved setting first, then the environment (like the web backend's `.env` fallbacks).
struct Lookup<'a> {
    settings: &'a HashMap<String, String>,
    env: &'a dyn Fn(&str) -> Option<String>,
}

impl Lookup<'_> {
    fn setting(&self, key: &str) -> String {
        self.settings.get(key).map(|v| v.trim().to_string()).unwrap_or_default()
    }

    fn setting_or_env(&self, key: &str, env_key: &str) -> String {
        let saved = self.setting(key);
        if !saved.is_empty() {
            return saved;
        }
        (self.env)(env_key).map(|v| v.trim().to_string()).unwrap_or_default()
    }
}

fn split_models(raw: &str) -> Vec<String> {
    raw.split([',', '\n']).map(str::trim).filter(|m| !m.is_empty()).map(String::from).collect()
}

fn custom_providers(lookup: &Lookup) -> Vec<CustomEntry> {
    let raw = lookup.setting("custom_openai_providers");
    if let Ok(list) = serde_json::from_str::<Vec<CustomEntry>>(&raw) {
        if !list.is_empty() {
            return list;
        }
    }
    // Single-provider settings from before the list existed.
    vec![CustomEntry {
        id: "custom".into(),
        name: "Custom".into(),
        base_url: lookup.setting_or_env("custom_openai_base_url", "CUSTOM_OPENAI_BASE_URL"),
        api_key: lookup.setting_or_env("custom_openai_api_key", "CUSTOM_OPENAI_API_KEY"),
        models: lookup.setting_or_env("custom_openai_models", "CUSTOM_OPENAI_MODELS"),
    }]
}

impl ProviderRegistry {
    pub fn from_settings(settings: &HashMap<String, String>, env: &dyn Fn(&str) -> Option<String>) -> Self {
        let lookup = Lookup { settings, env };

        let host = lookup.setting("ollama_host");
        let ollama = Arc::new(OllamaProvider::new(Some(if host.is_empty() { DEFAULT_OLLAMA_HOST.into() } else { host })));
        let mut providers: Vec<Arc<dyn LlmProvider>> = vec![ollama.clone()];

        // User-defined OpenAI-compatible endpoints come right after Ollama.
        for entry in custom_providers(&lookup) {
            let models = split_models(&entry.models);
            if entry.base_url.trim().is_empty() && models.is_empty() {
                continue;
            }
            providers.push(Arc::new(OpenAiCompatProvider::new(CompatConfig {
                id: entry.id,
                label: entry.name,
                kind: "custom".into(),
                base_url: entry.base_url,
                api_key: entry.api_key,
                extra_models: models,
            })));
        }

        // A key saved for OpenRouter under the OpenAI slot (older setups) stays with OpenRouter.
        let openai_saved_base = lookup.setting("openai_base_url");
        let openai_key_setting = lookup.setting("openai_api_key");
        let openai_key_is_openrouter = openai_saved_base.contains("openrouter") || openai_key_setting.starts_with("sk-or-");

        let openai_key = if !openai_key_setting.is_empty() && !openai_key_is_openrouter {
            openai_key_setting.clone()
        } else {
            (env)("OPENAI_API_KEY").map(|k| k.trim().to_string()).filter(|k| !k.starts_with("sk-or-")).unwrap_or_default()
        };
        if !openai_key.is_empty() {
            let base = lookup.setting_or_env("openai_base_url", "OPENAI_BASE_URL");
            let base = if base.is_empty() || base.contains("openrouter.ai") { "https://api.openai.com/v1".to_string() } else { base };
            providers.push(Arc::new(OpenAiCompatProvider::new(CompatConfig {
                id: "openai".into(),
                label: "OpenAI".into(),
                kind: "openai".into(),
                base_url: base,
                api_key: openai_key,
                extra_models: vec![],
            })));
        }

        let mut openrouter_key = lookup.setting("openrouter_api_key");
        if openrouter_key.is_empty() && openai_key_is_openrouter {
            openrouter_key = openai_key_setting;
        }
        if openrouter_key.is_empty() {
            openrouter_key = (env)("OPENROUTER_API_KEY").map(|k| k.trim().to_string()).unwrap_or_default();
        }
        if !openrouter_key.is_empty() {
            let base = lookup.setting_or_env("openrouter_base_url", "OPENROUTER_BASE_URL");
            providers.push(Arc::new(OpenAiCompatProvider::new(CompatConfig {
                id: "openrouter".into(),
                label: "OpenRouter".into(),
                kind: "openrouter".into(),
                base_url: if base.is_empty() { "https://openrouter.ai/api/v1".into() } else { base },
                api_key: openrouter_key,
                extra_models: vec![],
            })));
        }

        let nine_key = lookup.setting_or_env("nine_router_api_key", "NINE_ROUTER_API_KEY");
        if !nine_key.is_empty() {
            let base = lookup.setting_or_env("nine_router_host", "NINE_ROUTER_BASE_URL");
            providers.push(Arc::new(OpenAiCompatProvider::new(CompatConfig {
                id: "9router".into(),
                label: "9Router".into(),
                kind: "9router".into(),
                base_url: if base.is_empty() { "http://localhost:20128/v1".into() } else { base },
                api_key: nine_key,
                extra_models: vec![],
            })));
        }

        Self { providers, ollama }
    }

    pub fn ollama(&self) -> Arc<OllamaProvider> {
        self.ollama.clone()
    }

    pub fn provider_ids(&self) -> Vec<String> {
        self.providers.iter().map(|p| p.id().to_string()).collect()
    }

    /// `openai:gpt-4o` → (OpenAI, `gpt-4o`). Anything without a known provider
    /// prefix — including Ollama tags like `llama3:latest` — goes to Ollama unchanged.
    pub fn resolve_model(&self, model: &str) -> Option<(Arc<dyn LlmProvider>, String)> {
        if let Some((prefix, rest)) = model.split_once(':') {
            if let Some(provider) = self.providers.iter().find(|p| p.id() == prefix) {
                return Some((provider.clone(), rest.to_string()));
            }
        }
        self.providers.first().cloned().map(|p| (p, model.to_string()))
    }

    /// Every provider is asked at once; one that is down or slow is skipped.
    pub async fn list_all_models(&self) -> AppResult<Vec<ModelInfo>> {
        let lists = futures::future::join_all(self.providers.iter().map(|p| async move { p.list_models().await.unwrap_or_default() })).await;
        Ok(lists.into_iter().flatten().collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    fn no_env(_: &str) -> Option<String> {
        None
    }

    fn ids(registry: &ProviderRegistry) -> Vec<String> {
        registry.provider_ids()
    }

    #[test]
    fn a_fresh_install_has_only_ollama() {
        assert_eq!(ids(&ProviderRegistry::from_settings(&HashMap::new(), &no_env)), vec!["ollama"]);
    }

    #[test]
    fn registers_cloud_providers_that_have_keys_with_customs_right_after_ollama() {
        let s = settings(&[
            ("openai_api_key", "sk-real"),
            ("openrouter_api_key", "sk-or-x"),
            ("nine_router_api_key", "nr"),
            ("custom_openai_providers", r#"[{"id":"custom","name":"Groq","baseUrl":"https://api.groq.com/openai/v1","apiKey":"g","models":"a, b"},{"id":"custom_2","name":"Empty","baseUrl":"","models":""}]"#),
        ]);
        assert_eq!(ids(&ProviderRegistry::from_settings(&s, &no_env)), vec!["ollama", "custom", "openai", "openrouter", "9router"]);
    }

    #[test]
    fn an_openrouter_key_saved_in_the_openai_slot_goes_to_openrouter() {
        let s = settings(&[("openai_api_key", "sk-or-legacy"), ("openai_base_url", "https://openrouter.ai/api/v1")]);
        assert_eq!(ids(&ProviderRegistry::from_settings(&s, &no_env)), vec!["ollama", "openrouter"]);
    }

    #[test]
    fn falls_back_to_the_environment_and_the_legacy_custom_settings() {
        let env = |key: &str| match key {
            "OPENAI_API_KEY" => Some("sk-env".to_string()),
            "OPENROUTER_API_KEY" => Some("sk-or-env".to_string()),
            _ => None,
        };
        let s = settings(&[("custom_openai_base_url", "http://localhost:1234/v1")]);
        assert_eq!(ids(&ProviderRegistry::from_settings(&s, &env)), vec!["ollama", "custom", "openai", "openrouter"]);
    }

    #[test]
    fn an_env_openai_key_that_is_really_openrouter_is_ignored() {
        let env = |key: &str| (key == "OPENAI_API_KEY").then(|| "sk-or-env".to_string());
        assert_eq!(ids(&ProviderRegistry::from_settings(&HashMap::new(), &env)), vec!["ollama"]);
    }

    #[test]
    fn resolves_prefixed_models_and_leaves_ollama_tags_alone() {
        let s = settings(&[("openai_api_key", "sk-real")]);
        let registry = ProviderRegistry::from_settings(&s, &no_env);

        let (provider, model) = registry.resolve_model("openai:gpt-4o").unwrap();
        assert_eq!((provider.id(), model.as_str()), ("openai", "gpt-4o"));

        let (provider, model) = registry.resolve_model("llama3:latest").unwrap();
        assert_eq!((provider.id(), model.as_str()), ("ollama", "llama3:latest"));

        let (provider, model) = registry.resolve_model("ollama:qwen3:8b").unwrap();
        assert_eq!((provider.id(), model.as_str()), ("ollama", "qwen3:8b"));
    }

    #[test]
    fn the_configured_ollama_host_is_used() {
        let s = settings(&[("ollama_host", "gpu-box:11434")]);
        assert_eq!(ProviderRegistry::from_settings(&s, &no_env).ollama().base_url(), "http://gpu-box:11434");
    }
}
