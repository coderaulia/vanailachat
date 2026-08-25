use std::process::Stdio;
use tokio::process::Command;

pub struct OllamaManager {
    host: String,
    auto_start: bool,
}

impl OllamaManager {
    pub fn new(host: Option<String>, auto_start: bool) -> Self {
        Self {
            host: host.unwrap_or_else(|| "http://127.0.0.1:11434".to_string()),
            auto_start,
        }
    }

    pub async fn is_running(&self) -> bool {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(800))
            .build()
            .unwrap_or_default();

        let url = format!("{}/api/tags", self.host);
        client.get(&url).send().await.is_ok()
    }

    pub async fn ensure_running(&self) -> bool {
        if self.is_running().await {
            return true;
        }

        if !self.auto_start {
            return false;
        }

        // Attempt background start of `ollama serve`
        let spawn_res = Command::new("ollama")
            .arg("serve")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();

        if spawn_res.is_err() {
            return false;
        }

        // Poll for up to 10 seconds
        for _ in 0..20 {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            if self.is_running().await {
                return true;
            }
        }

        false
    }
}
