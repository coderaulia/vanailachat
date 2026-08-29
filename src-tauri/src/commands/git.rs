use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::process::Command;

#[derive(Serialize)]
pub struct GitStatusResult {
    pub branch: String,
    pub is_clean: bool,
    pub files: Vec<String>,
}

#[tauri::command]
pub async fn get_git_status(workspace_root: String) -> AppResult<GitStatusResult> {
    let path = PathBuf::from(&workspace_root);
    if !path.exists() {
        return Err(AppError::InvalidRequest("Workspace path does not exist".to_string()));
    }

    let branch_output = Command::new("git")
        .args(["branch", "--show-current"])
        .current_dir(&path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(AppError::Io)?;

    let branch = String::from_utf8_lossy(&branch_output.stdout).trim().to_string();

    let status_output = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(AppError::Io)?;

    let status_text = String::from_utf8_lossy(&status_output.stdout);
    let files: Vec<String> = status_text
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    Ok(GitStatusResult {
        branch: if branch.is_empty() { "main".to_string() } else { branch },
        is_clean: files.is_empty(),
        files,
    })
}

#[tauri::command]
pub async fn get_git_diff(workspace_root: String) -> AppResult<String> {
    let path = PathBuf::from(&workspace_root);
    if !path.exists() {
        return Err(AppError::InvalidRequest("Workspace path does not exist".to_string()));
    }

    let diff_output = Command::new("git")
        .args(["diff"])
        .current_dir(&path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(AppError::Io)?;

    Ok(String::from_utf8_lossy(&diff_output.stdout).to_string())
}
