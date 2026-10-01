use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, PartialEq)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct Browse {
    pub path: String,
    /// `None` at a filesystem root: there is nowhere further up.
    pub parent: Option<String>,
    pub directories: Vec<DirEntry>,
    pub drives: Vec<String>,
    pub home: String,
}

fn drives() -> Vec<String> {
    if cfg!(windows) {
        ('A'..='Z').map(|letter| format!("{letter}:\\")).filter(|drive| Path::new(drive).exists()).collect()
    } else {
        vec!["/".to_string()]
    }
}

/// Lists the sub-directories of `requested` (the home folder by default), for the
/// in-app folder picker. Names only: file contents are never read.
pub fn browse(requested: Option<&str>) -> AppResult<Browse> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    let target = match requested.map(str::trim).filter(|p| !p.is_empty()) {
        Some(path) => PathBuf::from(path),
        None => home.clone(),
    };
    let target = std::fs::canonicalize(&target).map_err(|e| AppError::InvalidRequest(format!("Unable to read that folder: {e}")))?;

    let mut directories: Vec<DirEntry> = std::fs::read_dir(&target)
        .map_err(|e| AppError::InvalidRequest(format!("Unable to read that folder: {e}")))?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().map(|t| t.is_dir()).unwrap_or(false) || entry.path().is_dir())
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            // Dot-directories and node_modules are noise when picking a workspace.
            (!name.starts_with('.') && name != "node_modules").then(|| DirEntry { path: entry.path().to_string_lossy().into_owned(), name })
        })
        .collect();
    directories.sort_by_key(|entry| entry.name.to_lowercase());

    Ok(Browse {
        path: target.to_string_lossy().into_owned(),
        parent: target.parent().map(|p| p.to_string_lossy().into_owned()),
        directories,
        drives: drives(),
        home: home.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn browse_directory(path: Option<String>) -> AppResult<Browse> {
    browse(path.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_visible_directories_sorted_and_reports_the_parent() {
        let root = std::env::temp_dir().join(format!("vanaila-browse-{}", uuid::Uuid::new_v4()));
        for dir in ["beta", "Alpha", ".hidden", "node_modules"] {
            std::fs::create_dir_all(root.join(dir)).unwrap();
        }
        std::fs::write(root.join("file.txt"), "x").unwrap();

        let listing = browse(Some(root.to_str().unwrap())).unwrap();
        let names: Vec<&str> = listing.directories.iter().map(|d| d.name.as_str()).collect();
        assert_eq!(names, vec!["Alpha", "beta"]);
        assert_eq!(listing.parent.as_deref(), root.canonicalize().unwrap().parent().unwrap().to_str());

        assert!(browse(Some(root.join("missing").to_str().unwrap())).is_err());
        assert!(browse(None).is_ok(), "defaults to the home folder");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn the_root_has_no_parent() {
        assert_eq!(browse(Some("/")).unwrap().parent, None);
    }
}
