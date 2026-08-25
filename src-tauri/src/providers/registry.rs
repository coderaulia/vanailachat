use super::ollama::OllamaProvider;
use super::openai::OpenAiProvider;
use super::traits::*;
use crate::error::AppResult;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Clone)]
pub struct ProviderRegistry {
    providers: HashMap<&'static str, Arc<dyn LlmProvider>>,
}

impl ProviderRegistry {
    pub fn new(
        ollama_url: Option<String>,
        openai_key: Option<String>,
        openrouter_key: Option<String>,
    ) -> Self {
        let mut providers: HashMap<&'static str, Arc<dyn LlmProvider>> = HashMap::new();

        // 1. Ollama
        let ollama = Arc::new(OllamaProvider::new(ollama_url));
        providers.insert("ollama", ollama);

        // 2. OpenAI
        if let Some(key) = openai_key {
            if !key.is_empty() {
                let openai = Arc::new(OpenAiProvider::new(key, None, "openai"));
                providers.insert("openai", openai);
            }
        }

        // 3. OpenRouter
        if let Some(key) = openrouter_key {
            if !key.is_empty() {
                let openrouter = Arc::new(OpenAiProvider::new(
                    key,
                    Some("https://openrouter.ai/api/v1".to_string()),
                    "openrouter",
                ));
                providers.insert("openrouter", openrouter);
            }
        }

        Self { providers }
    }

    pub fn get_provider(&self, provider_id: &str) -> Option<Arc<dyn LlmProvider>> {
        self.providers.get(provider_id).cloned()
    }

    pub fn resolve_provider_for_model(&self, model: &str) -> Option<Arc<dyn LlmProvider>> {
        if let Some((prefix, _)) = model.split_once(':') {
            if let Some(p) = self.providers.get(prefix) {
                return Some(p.clone());
            }
        }
        // Fallback to Ollama as default
        self.providers.get("ollama").cloned()
    }

    pub async fn list_all_models(&self) -> AppResult<Vec<ModelInfo>> {
        let mut all_models = Vec::new();
        for provider in self.providers.values() {
            if let Ok(models) = provider.list_models().await {
                all_models.extend(models);
            }
        }
        Ok(all_models)
    }
}
