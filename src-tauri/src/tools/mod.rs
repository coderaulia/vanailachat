pub mod edit_file;
pub mod list_directory;
pub mod read_file;
pub mod read_url;
pub mod run_command;
pub mod search_web;
pub mod write_file;

use crate::error::{AppError, AppResult};
use serde_json::Value;

pub async fn execute_tool(
    name: &str,
    args: Value,
    project_root: Option<&str>,
) -> AppResult<String> {
    match name {
        "search_web" => {
            let query = args
                .get("query")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InvalidRequest("Missing query argument".to_string()))?;
            search_web::search_web(query).await
        }
        "read_url" => {
            let url = args
                .get("url")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InvalidRequest("Missing url argument".to_string()))?;
            read_url::read_url(url).await
        }
        "read_file" => {
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InvalidRequest("Missing path argument".to_string()))?;
            read_file::read_file(path, project_root).await
        }
        "list_directory" => {
            let path = args.get("path").and_then(|v| v.as_str());
            list_directory::list_directory(path, project_root).await
        }
        "write_file" => {
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InvalidRequest("Missing path argument".to_string()))?;
            let content = args
                .get("content")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InvalidRequest("Missing content argument".to_string()))?;
            write_file::write_file(path, content, project_root).await
        }
        "edit_file" => {
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InvalidRequest("Missing path argument".to_string()))?;
            let old_str = args
                .get("old_string")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InvalidRequest("Missing old_string argument".to_string()))?;
            let new_str = args
                .get("new_string")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InvalidRequest("Missing new_string argument".to_string()))?;
            edit_file::edit_file(path, old_str, new_str, project_root).await
        }
        "run_command" => {
            let command = args
                .get("command")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InvalidRequest("Missing command argument".to_string()))?;
            run_command::run_command(command, project_root).await
        }
        _ => Err(AppError::NotFound(format!("Tool '{}' not found", name))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_file_operations_and_security() {
        let temp_dir = std::env::temp_dir().join("vanaila_tool_test");
        tokio::fs::create_dir_all(&temp_dir).await.unwrap();
        let root_str = temp_dir.to_str().unwrap();

        // 1. Write file
        let write_res = write_file::write_file("test.txt", "Hello World!", Some(root_str)).await;
        assert!(write_res.is_ok());

        // 2. Read file
        let read_res = read_file::read_file("test.txt", Some(root_str)).await;
        assert_eq!(read_res.unwrap(), "Hello World!");

        // 3. Edit file (single match replacement)
        let edit_res = edit_file::edit_file("test.txt", "World", "Rust", Some(root_str)).await;
        assert!(edit_res.is_ok());

        let read_after_edit = read_file::read_file("test.txt", Some(root_str)).await;
        assert_eq!(read_after_edit.unwrap(), "Hello Rust!");

        // 4. Path traversal defense
        let traversal_res = read_file::read_file("../../etc/shadow", Some(root_str)).await;
        assert!(traversal_res.is_err());

        // Cleanup
        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }

    #[tokio::test]
    async fn test_command_allowlist() {
        // Disallowed command must be rejected
        let blocked = run_command::run_command("rm -rf /", None).await;
        assert!(blocked.is_err());

        // Allowed command executes
        let allowed = run_command::run_command("echo hello", None).await;
        assert!(allowed.is_ok());
        assert!(allowed.unwrap().contains("hello"));
    }
}

