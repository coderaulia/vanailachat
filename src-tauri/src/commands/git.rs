use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::process::Command;

#[derive(Serialize)]
pub struct GitStatusResult {
    pub is_git: bool,
    pub branch: String,
    pub is_clean: bool,
    pub uncommitted_count: usize,
    pub files: Vec<String>,
    pub is_main_or_master: bool,
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

    let is_git = branch_output.status.success() && status_output.status.success();
    let branch = if branch.is_empty() { "main".to_string() } else { branch };
    Ok(GitStatusResult {
        is_git,
        branch: branch.clone(),
        is_clean: files.is_empty(),
        uncommitted_count: files.len(),
        files,
        is_main_or_master: matches!(branch.as_str(), "main" | "master" | "production" | "prod"),
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

#[tauri::command]
pub async fn create_git_branch(workspace_root: String, branch_name: String) -> AppResult<String> {
    let path = PathBuf::from(&workspace_root);
    if !path.is_dir() {
        return Err(AppError::InvalidRequest("Workspace path does not exist".to_string()));
    }
    let sanitized = branch_name.trim().replace(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '/' | '.')), "-");
    let sanitized = sanitized.trim_matches('-');
    if sanitized.is_empty() {
        return Err(AppError::InvalidRequest("Invalid or empty branch name".to_string()));
    }
    let output = Command::new("git").args(["checkout", "-b", sanitized]).current_dir(path).output().await.map_err(AppError::Io)?;
    if !output.status.success() {
        return Err(AppError::Provider(String::from_utf8_lossy(&output.stderr).trim().to_string()));
    }
    Ok(sanitized.to_string())
}
