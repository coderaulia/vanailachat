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
    // Detached HEAD has no branch name; calling it "main" would hide the production-branch warning logic.
    let branch = if branch.is_empty() { "(detached HEAD)".to_string() } else { branch };
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

#[cfg(test)]
mod tests {
    use super::*;

    fn git(dir: &std::path::Path, args: &[&str]) {
        let ok = std::process::Command::new("git")
            .args(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"])
            .args(args)
            .current_dir(dir)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        assert!(ok, "git {args:?} failed");
    }

    #[tokio::test]
    async fn reports_the_branch_dirty_files_and_a_detached_head() {
        let dir = std::env::temp_dir().join(format!("vanaila-git-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        git(&dir, &["init", "-q", "-b", "feature/x"]);
        std::fs::write(dir.join("a.txt"), "1").unwrap();
        git(&dir, &["add", "."]);
        git(&dir, &["commit", "-q", "-m", "first"]);
        let root = dir.to_string_lossy().into_owned();

        let clean = get_git_status(root.clone()).await.unwrap();
        assert_eq!((clean.is_git, clean.branch.as_str(), clean.is_clean, clean.is_main_or_master), (true, "feature/x", true, false));

        std::fs::write(dir.join("b.txt"), "2").unwrap();
        assert_eq!(get_git_status(root.clone()).await.unwrap().uncommitted_count, 1);

        git(&dir, &["checkout", "-q", "--detach"]);
        let detached = get_git_status(root).await.unwrap();
        assert_eq!(detached.branch, "(detached HEAD)");
        assert!(!detached.is_main_or_master, "a detached HEAD is not 'main'");

        let plain = std::env::temp_dir().join(format!("vanaila-nogit-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&plain).unwrap();
        assert!(!get_git_status(plain.to_string_lossy().into_owned()).await.unwrap().is_git);
        let _ = std::fs::remove_dir_all(dir);
        let _ = std::fs::remove_dir_all(plain);
    }
}
