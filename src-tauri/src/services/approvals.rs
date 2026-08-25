use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};

#[derive(Clone)]
pub struct ApprovalService {
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>,
}

impl ApprovalService {
    pub fn new() -> Self {
        Self {
            pending: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn register(&self, id: String, sender: oneshot::Sender<bool>) {
        let mut map = self.pending.lock().await;
        map.insert(id, sender);
    }

    pub async fn resolve(&self, id: &str, approved: bool) -> bool {
        let mut map = self.pending.lock().await;
        if let Some(sender) = map.remove(id) {
            let _ = sender.send(approved);
            true
        } else {
            false
        }
    }
}
