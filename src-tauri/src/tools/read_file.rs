use crate::error::{AppError, AppResult};
use std::path::{Component, Path, PathBuf};
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

/// Resolves `target` inside the project root, rejecting anything that leaves it
/// lexically (`..`, absolute paths) or through a symlink. For paths that do not
/// exist yet, the nearest existing ancestor is canonicalized and checked, so a
/// new file cannot be created through a symlinked directory.
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

    let outside = || AppError::Security("Access denied: path is outside workspace directory".to_string());

    let mut normalized = PathBuf::new();
    for component in joined.components() {
        match component {
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err(outside());
                }
            }
            Component::CurDir => {}
            other => normalized.push(other.as_os_str()),
        }
    }
    if !normalized.starts_with(&canonical_root) {
        return Err(outside());
    }

    // symlink_metadata so a dangling link counts as existing and is then
    // rejected by canonicalize, instead of being written through.
    let mut existing = normalized.clone();
    let mut missing: Vec<std::ffi::OsString> = Vec::new();
    while std::fs::symlink_metadata(&existing).is_err() {
        match existing.file_name() {
            Some(name) => missing.push(name.to_owned()),
            None => return Err(outside()),
        }
        if !existing.pop() {
            return Err(outside());
        }
    }

    let mut resolved = existing
        .canonicalize()
        .map_err(|e| AppError::InvalidRequest(format!("Invalid path: {}", e)))?;
    if !resolved.starts_with(&canonical_root) {
        return Err(outside());
    }
    for name in missing.iter().rev() {
        resolved.push(name);
    }
    Ok(resolved)
}
