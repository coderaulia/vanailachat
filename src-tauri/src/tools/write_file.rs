use super::read_file::resolve_path;
use crate::error::{AppError, AppResult};
use tokio::fs;

pub async fn write_file(file_path: &str, content: &str, project_root: Option<&str>) -> AppResult<String> {
    let resolved = resolve_path(file_path, project_root)?;

    if let Some(parent) = resolved.parent() {
        fs::create_dir_all(parent).await.map_err(AppError::Io)?;
    }

    fs::write(&resolved, content).await.map_err(AppError::Io)?;
    Ok(format!("Successfully wrote {} bytes to {:?}", content.len(), resolved))
}
