use crate::db::Database;
use crate::providers::ProviderRegistry;
use crate::services::{ApprovalService, OllamaManager};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;

pub struct AppState {
    pub db: Arc<Mutex<Database>>,
    pub provider_registry: Arc<Mutex<ProviderRegistry>>,
    pub ollama_manager: Arc<OllamaManager>,
    pub approval_service: Arc<ApprovalService>,
    /// Cancel handles of the streams in flight, by chat id.
    pub active_streams: Arc<tokio::sync::Mutex<HashMap<String, tokio::sync::watch::Sender<bool>>>>,
}

/// Settings that change which providers exist or where they live.
const PROVIDER_SETTINGS: &[&str] = &[
    "ollama_host",
    "openai_api_key",
    "openai_base_url",
    "openrouter_api_key",
    "openrouter_base_url",
    "nine_router_host",
    "nine_router_api_key",
    "custom_openai_providers",
    "custom_openai_base_url",
    "custom_openai_api_key",
    "custom_openai_models",
];

pub fn affects_providers(key: &str) -> bool {
    PROVIDER_SETTINGS.contains(&key)
}

impl AppState {
    /// Rebuilds the provider list from the saved settings, so a key or host
    /// entered in Settings takes effect without restarting the app.
    pub fn refresh_providers(&self) {
        let settings = self.db.lock().get_all_settings().unwrap_or_default();
        let registry = ProviderRegistry::from_settings(&settings, &|key| std::env::var(key).ok());
        self.ollama_manager.set_host(&registry.ollama().base_url());
        *self.provider_registry.lock() = registry;
    }
}
