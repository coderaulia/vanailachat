use crate::error::{AppError, AppResult};
use std::path::PathBuf;
use std::process::Stdio;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

pub async fn run_command(command_str: &str, project_root: Option<&str>) -> AppResult<String> {
    let parts: Vec<&str> = command_str.split_whitespace().collect();
    if parts.is_empty() {
        return Err(AppError::InvalidRequest("Empty command".to_string()));
    }

    let program = parts[0];
    let args = &parts[1..];

    // Allowed command list (matches backend security allowlist)
    let is_allowed = match program {
        "git" => {
            if let Some(sub) = args.first() {
                matches!(*sub, "status" | "diff" | "log" | "show" | "branch" | "blame" | "ls-files")
            } else {
                false
            }
        }
        "npm" | "pnpm" | "cargo" => {
            if let Some(sub) = args.first() {
                matches!(*sub, "test" | "check" | "lint" | "run")
            } else {
                false
            }
        }
        "ls" | "cat" | "grep" | "find" | "head" | "tail" | "wc" | "echo" | "pwd" => true,
        _ => false,
    };

    if !is_allowed {
        return Err(AppError::Security(format!(
            "Command '{}' is not in the security allowlist",
            program
        )));
    }

    let cwd = match project_root {
        Some(r) if !r.is_empty() => PathBuf::from(r),
        _ => std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
    };

    let child = Command::new(program)
        .args(args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(AppError::Io)?;

    // 15-second execution timeout
    let output_res = timeout(Duration::from_secs(15), child.wait_with_output())
        .await
        .map_err(|_| AppError::Agent("Command timed out after 15 seconds".to_string()))?
        .map_err(AppError::Io)?;

    let stdout = String::from_utf8_lossy(&output_res.stdout);
    let stderr = String::from_utf8_lossy(&output_res.stderr);

    if !output_res.status.success() {
        Ok(format!(
            "Exit code {}:\nSTDOUT:\n{}\nSTDERR:\n{}",
            output_res.status.code().unwrap_or(-1),
            stdout,
            stderr
        ))
    } else if !stderr.is_empty() {
        Ok(format!("{}\n{}", stdout, stderr))
    } else {
        Ok(stdout.to_string())
    }
}
