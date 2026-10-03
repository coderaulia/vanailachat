use super::read_file::resolve_path;
use crate::error::{AppError, AppResult};
use std::path::PathBuf;
use std::process::Stdio;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

/// npm builds and test runs can be slow; the child is killed at this limit.
const COMMAND_TIMEOUT_SECS: u64 = 180;

const READ_ONLY_GIT: &[&str] = &["status", "diff", "log", "show", "branch", "blame", "ls-files"];
/// Flags that write files, read outside the repository, or run programs named in repo config.
const UNSAFE_GIT_FLAGS: &[&str] = &["--output", "--no-index", "--ext-diff", "--textconv", "--contents"];
const PACKAGE_SCRIPTS: &[&str] = &["test", "build", "type-check", "lint"];
const UNSAFE_FIND_FLAGS: &[&str] = &[
    "-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprint", "-fprint0", "-fprintf", "-fls",
];

/// Mirrors `isAllowedCommand` in the web backend (src/backend/services/tools.ts).
pub fn is_allowed(program: &str, args: &[&str]) -> bool {
    match program {
        "git" => {
            let Some(sub) = args.first() else { return false };
            if !READ_ONLY_GIT.contains(sub) {
                return false;
            }
            if *sub == "branch" && args.iter().any(|a| a.starts_with('-') && *a != "-a" && *a != "-v") {
                return false;
            }
            !args.iter().any(|arg| {
                UNSAFE_GIT_FLAGS
                    .iter()
                    .any(|flag| arg == flag || arg.starts_with(&format!("{flag}=")))
            })
        }
        "npm" | "pnpm" | "yarn" | "bun" => match args {
            [script] => PACKAGE_SCRIPTS.contains(script),
            ["run", script] => PACKAGE_SCRIPTS.contains(script),
            _ => false,
        },
        "cargo" => matches!(args, ["test"] | ["check"]),
        "find" => !args.iter().any(|arg| UNSAFE_FIND_FLAGS.contains(arg)),
        "ls" | "cat" | "grep" | "head" | "tail" | "wc" | "pwd" => true,
        _ => false,
    }
}

/// Programs that must never be added to the allowlist: they run arbitrary code or escalate.
const NEVER_ALLOWED: &[&str] = &["sh", "bash", "zsh", "fish", "dash", "cmd", "powershell", "pwsh", "sudo", "su", "doas", "env", "eval", "exec", "xargs", "ssh", "rm"];
/// A command's output is cut here so a chatty build cannot flood the model's context.
const MAX_OUTPUT_CHARS: usize = 20_000;

/// Extra allowed commands from settings: one `program [subcommand…]` per entry, matched as a token prefix
/// (`cargo build` allows `cargo build --release`; `make` allows any `make` target).
pub fn extra_allows(program: &str, args: &[&str], extra: &[String]) -> bool {
    extra.iter().any(|entry| {
        let tokens: Vec<&str> = entry.split_whitespace().collect();
        let Some((head, rest)) = tokens.split_first() else { return false };
        !NEVER_ALLOWED.contains(head)
            && *head == program
            && rest.len() <= args.len()
            && rest.iter().zip(args).all(|(want, got)| want == got)
    })
}

/// Parses the `coding_extra_commands` setting (comma or newline separated), dropping entries that can never be allowed.
pub fn parse_extra_commands(raw: &str) -> Vec<String> {
    raw.split([',', '\n'])
        .map(|e| e.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|e| e.split(' ').next().is_some_and(|head| !head.is_empty() && !NEVER_ALLOWED.contains(&head)))
        .collect()
}

fn cap_output(text: String) -> String {
    if text.chars().count() <= MAX_OUTPUT_CHARS {
        return text;
    }
    let cut: String = text.chars().take(MAX_OUTPUT_CHARS).collect();
    format!("{cut}\n[output cut at {MAX_OUTPUT_CHARS} characters]")
}

/// File operands of the read-only file commands must stay inside the project.
fn check_operands(program: &str, args: &[&str], project_root: Option<&str>) -> AppResult<()> {
    if !matches!(program, "ls" | "cat" | "grep" | "find" | "head" | "tail" | "wc") {
        return Ok(());
    }
    let operands = args.iter().filter(|a| !a.starts_with('-'));
    // grep's first operand is the pattern, not a path.
    let skip = usize::from(program == "grep");
    for operand in operands.skip(skip) {
        resolve_path(operand, project_root)?;
    }
    Ok(())
}

/// Provider API keys held by the app are not passed to repository scripts.
fn child_env() -> impl Iterator<Item = (String, String)> {
    std::env::vars().filter(|(key, _)| {
        let upper = key.to_ascii_uppercase();
        !["_API_KEY", "_TOKEN", "_SECRET", "PASSWORD"].iter().any(|s| upper.ends_with(s))
    })
}

pub async fn run_command(command_str: &str, project_root: Option<&str>) -> AppResult<String> {
    run_command_with(command_str, project_root, &[]).await
}

/// Like `run_command`, with extra commands the user allowed in settings.
pub async fn run_command_with(command_str: &str, project_root: Option<&str>, extra: &[String]) -> AppResult<String> {
    let parts: Vec<&str> = command_str.split_whitespace().collect();
    if parts.is_empty() {
        return Err(AppError::InvalidRequest("Empty command".to_string()));
    }

    let program = parts[0];
    let args = &parts[1..];

    if !is_allowed(program, args) && !extra_allows(program, args, extra) {
        return Err(AppError::Security(format!(
            "Command '{}' is not in the security allowlist",
            program
        )));
    }
    check_operands(program, args, project_root)?;

    let cwd = match project_root {
        Some(r) if !r.is_empty() => PathBuf::from(r),
        _ => std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
    };

    let child = Command::new(program)
        .args(args)
        .current_dir(cwd)
        .env_clear()
        .envs(child_env())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Dropping the future on timeout must also stop the process.
        .kill_on_drop(true)
        .spawn()
        .map_err(AppError::Io)?;

    let output_res = timeout(Duration::from_secs(COMMAND_TIMEOUT_SECS), child.wait_with_output())
        .await
        .map_err(|_| AppError::Agent(format!("Command timed out after {COMMAND_TIMEOUT_SECS} seconds")))?
        .map_err(AppError::Io)?;

    let stdout = String::from_utf8_lossy(&output_res.stdout);
    let stderr = String::from_utf8_lossy(&output_res.stderr);

    let text = if !output_res.status.success() {
        format!(
            "Exit code {}:\nSTDOUT:\n{}\nSTDERR:\n{}",
            output_res.status.code().unwrap_or(-1),
            stdout,
            stderr
        )
    } else if !stderr.is_empty() {
        format!("{}\n{}", stdout, stderr)
    } else {
        stdout.to_string()
    };
    Ok(cap_output(text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_matches_web_backend() {
        assert!(is_allowed("git", &["diff", "--stat"]));
        assert!(is_allowed("git", &["log", "-C", "--oneline"]));
        assert!(!is_allowed("git", &["diff", "--output=/tmp/x"]));
        assert!(!is_allowed("git", &["diff", "--no-index", "/etc/passwd", "/dev/null"]));
        assert!(!is_allowed("git", &["blame", "--contents", "/etc/passwd", "a"]));
        assert!(!is_allowed("git", &["branch", "-D", "main"]));
        assert!(!is_allowed("git", &["push"]));

        assert!(is_allowed("pnpm", &["test"]));
        assert!(is_allowed("npm", &["run", "lint"]));
        assert!(!is_allowed("npm", &["run", "postinstall"]));
        assert!(!is_allowed("npm", &["install"]));

        assert!(is_allowed("find", &[".", "-name", "*.rs"]));
        assert!(!is_allowed("find", &[".", "-delete"]));
        assert!(!is_allowed("find", &[".", "-exec", "rm", "{}", ";"]));
        assert!(!is_allowed("echo", &["hi"]));
    }

    #[test]
    fn file_operands_stay_inside_root() {
        let root = std::env::temp_dir();
        let root = root.to_str().unwrap();
        assert!(check_operands("cat", &["/etc/passwd"], Some(root)).is_err());
        assert!(check_operands("head", &["-n", "../../etc/passwd"], Some(root)).is_err());
        assert!(check_operands("grep", &["/api/", "."], Some(root)).is_ok());
        assert!(check_operands("grep", &["x", "/etc"], Some(root)).is_err());
    }

    #[test]
    fn child_env_drops_secrets() {
        std::env::set_var("VANAILA_TEST_API_KEY", "sk-x");
        assert!(!child_env().any(|(key, _)| key == "VANAILA_TEST_API_KEY"));
        assert!(child_env().any(|(key, _)| key == "PATH"));
        std::env::remove_var("VANAILA_TEST_API_KEY");
    }

    #[test]
    fn extra_commands_extend_the_allowlist_but_never_to_shells() {
        let extra = parse_extra_commands("cargo build, make\n bash , sudo ls ,  pnpm   install");
        assert_eq!(extra, vec!["cargo build", "make", "pnpm install"]);
        assert!(extra_allows("cargo", &["build", "--release"], &extra));
        assert!(!extra_allows("cargo", &["publish"], &extra));
        assert!(extra_allows("make", &["test"], &extra));
        assert!(extra_allows("pnpm", &["install"], &extra));
        assert!(!extra_allows("pnpm", &["add", "x"], &extra));
        assert!(!extra_allows("bash", &["-c", "id"], &["bash".to_string()]), "shells are refused even if listed");
    }

    #[tokio::test]
    async fn long_output_is_cut() {
        let out = cap_output("x".repeat(MAX_OUTPUT_CHARS + 5));
        assert!(out.ends_with("characters]") && out.chars().count() < MAX_OUTPUT_CHARS + 60);
        assert_eq!(cap_output("short".into()), "short");
    }
}
