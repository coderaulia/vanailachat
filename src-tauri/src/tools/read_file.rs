use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};
use tokio::fs;

pub async fn read_file(file_path: &str, project_root: Option<&str>) -> AppResult<String> {
    let resolved = resolve_path(file_path, project_root)?;

    let metadata = fs::metadata(&resolved).await.map_err(AppError::Io)?;
    if metadata.len() > 10 * 1024 * 1024 {
        return Err(AppError::InvalidRequest("File is larger than 10MB limit".to_string()));
    }

    let content = fs::read_to_string(&resolved).await.map_err(AppError::Io)?;
    Ok(content)
}

pub fn resolve_path(target: &str, project_root: Option<&str>) -> AppResult<PathBuf> {
    let root = match project_root {
        Some(r) if !r.is_empty() => PathBuf::from(r),
        _ => std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
    };

    let canonical_root = root
        .canonicalize()
        .map_err(|e| AppError::InvalidRequest(format!("Invalid project root: {}", e)))?;

    let joined = if Path::new(target).is_absolute() {
        PathBuf::from(target)
    } else {
        canonical_root.join(target)
    };

    // If target exists, canonicalize and verify containment
    if joined.exists() {
        let canonical_target = joined
            .canonicalize()
            .map_err(|e| AppError::InvalidRequest(format!("Invalid path: {}", e)))?;

        if !canonical_target.starts_with(&canonical_root) {
            return Err(AppError::Security(
                "Access denied: path is outside workspace directory".to_string(),
            ));
        }
        Ok(canonical_target)
    } else {
        // If file doesn't exist yet (for write_file), verify parent directory
        if let Some(parent) = joined.parent() {
            if parent.exists() {
                let canonical_parent = parent
                    .canonicalize()
                    .map_err(|e| AppError::InvalidRequest(format!("Invalid path: {}", e)))?;
                if !canonical_parent.starts_with(&canonical_root) {
                    return Err(AppError::Security(
                        "Access denied: parent directory is outside workspace".to_string(),
                    ));
                }
            }
        }
        Ok(joined)
    }
}
