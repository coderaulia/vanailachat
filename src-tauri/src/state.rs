use crate::db::Database;
use crate::providers::ProviderRegistry;
use crate::services::{ApprovalService, OllamaManager};
use parking_lot::Mutex;
use std::sync::Arc;

pub struct AppState {
    pub db: Arc<Mutex<Database>>,
    pub provider_registry: Arc<Mutex<ProviderRegistry>>,
    pub ollama_manager: Arc<OllamaManager>,
    pub approval_service: Arc<ApprovalService>,
    pub active_stream_abort: Arc<tokio::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>>,
}
