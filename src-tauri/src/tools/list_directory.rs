use super::read_file::resolve_path;
use crate::error::{AppError, AppResult};
use serde_json::json;
use tokio::fs;

pub async fn list_directory(dir_path: Option<&str>, project_root: Option<&str>) -> AppResult<String> {
    let target = dir_path.unwrap_or(".");
    let resolved = resolve_path(target, project_root)?;

    let mut entries = fs::read_dir(&resolved).await.map_err(AppError::Io)?;
    let mut items = Vec::new();

    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();
        // Ignore .git and node_modules
        if name == ".git" || name == "node_modules" || name == "target" {
            continue;
        }

        let is_dir = entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false);
        items.push(json!({
            "name": name,
            "is_directory": is_dir
        }));
    }

    Ok(serde_json::to_string_pretty(&items).unwrap_or_else(|_| "[]".to_string()))
}
