use super::read_file::resolve_path;
use crate::error::{AppError, AppResult};
use regex::Regex;
use std::path::Path;

/// Directories nobody wants search hits from.
const SKIPPED_DIRS: &[&str] = &[".git", "node_modules", "target", "dist", "build", ".next"];
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_LINE_CHARS: usize = 300;

pub struct SearchOptions<'a> {
    pub query: &'a str,
    pub path: &'a str,
    pub file_pattern: Option<&'a str>,
    pub case_sensitive: bool,
    pub max_results: usize,
}

/// `*.ts`, `src/**/*.tsx` → anchored regex. `*` stays inside a path segment, `**` crosses them.
fn glob_regex(pattern: &str) -> Option<Regex> {
    let mut out = String::from("^");
    let mut chars = pattern.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '*' if chars.peek() == Some(&'*') => {
                chars.next();
                // `**/` also matches zero directories.
                if chars.peek() == Some(&'/') {
                    chars.next();
                    out.push_str("(?:.*/)?");
                } else {
                    out.push_str(".*");
                }
            }
            '*' => out.push_str("[^/]*"),
            '?' => out.push_str("[^/]"),
            other => out.push_str(&regex::escape(&other.to_string())),
        }
    }
    out.push('$');
    Regex::new(&out).ok()
}

fn walk(dir: &Path, root: &Path, visit: &mut dyn FnMut(&Path) -> bool) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = entries.filter_map(Result::ok).collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else { continue };
        // Symlinks are not followed, so a link cannot lead the scan out of the workspace.
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            if !entry.file_name().to_str().is_some_and(|n| SKIPPED_DIRS.contains(&n)) {
                walk(&path, root, visit);
            }
        } else if kind.is_file() && !visit(&path) {
            return;
        }
    }
}

fn search_blocking(root: &Path, start: &Path, options: &SearchOptions<'_>) -> AppResult<String> {
    let matcher = options.file_pattern.filter(|p| !p.trim().is_empty()).map(|p| (p.contains('/'), glob_regex(p.trim())));
    if let Some((_, None)) = matcher {
        return Err(AppError::InvalidRequest("Invalid file_pattern".into()));
    }
    let needle = if options.case_sensitive { options.query.to_string() } else { options.query.to_lowercase() };
    let mut hits: Vec<String> = Vec::new();
    let limit = options.max_results.clamp(1, 200);

    let mut visit = |file: &Path| {
        let relative = file.strip_prefix(root).unwrap_or(file).to_string_lossy().replace('\\', "/");
        if let Some((by_path, Some(regex))) = &matcher {
            let subject = if *by_path { relative.as_str() } else { file.file_name().and_then(|n| n.to_str()).unwrap_or("") };
            if !regex.is_match(subject) {
                return true;
            }
        }
        if std::fs::metadata(file).map(|m| m.len() > MAX_FILE_BYTES).unwrap_or(true) {
            return true;
        }
        // Binary and non-UTF-8 files are skipped rather than searched as noise.
        let Ok(text) = std::fs::read_to_string(file) else { return true };
        for (number, line) in text.lines().enumerate() {
            let found = if options.case_sensitive { line.contains(&needle) } else { line.to_lowercase().contains(&needle) };
            if found {
                let shown: String = line.trim().chars().take(MAX_LINE_CHARS).collect();
                hits.push(format!("{relative}:{}: {shown}", number + 1));
                if hits.len() >= limit {
                    return false;
                }
            }
        }
        true
    };

    if start.is_file() {
        visit(start);
    } else {
        walk(start, root, &mut visit);
    }

    if hits.is_empty() {
        return Ok("No matches found.".into());
    }
    let truncated = hits.len() >= limit;
    let mut out = hits.join("\n");
    if truncated {
        out.push_str(&format!("\n[stopped at {limit} matches]"));
    }
    Ok(out)
}

/// Plain-text search inside the workspace, independent of grep/rg being installed.
pub async fn search_files(options: SearchOptions<'_>, project_root: Option<&str>) -> AppResult<String> {
    if options.query.is_empty() {
        return Err(AppError::InvalidRequest("missing query".into()));
    }
    let start = resolve_path(if options.path.trim().is_empty() { "." } else { options.path }, project_root)?;
    let root = resolve_path(".", project_root)?;
    let (query, pattern) = (options.query.to_string(), options.file_pattern.map(String::from));
    let (path, case_sensitive, max_results) = (options.path.to_string(), options.case_sensitive, options.max_results);
    tokio::task::spawn_blocking(move || {
        let options = SearchOptions { query: &query, path: &path, file_pattern: pattern.as_deref(), case_sensitive, max_results };
        search_blocking(&root, &start, &options)
    })
    .await
    .map_err(|_| AppError::InvalidRequest("Search was interrupted".into()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("vanaila-search-{}", uuid::Uuid::new_v4()));
        for (path, body) in [
            ("src/app.ts", "const Needle = 1;\nlet other = 2;\n"),
            ("src/deep/view.tsx", "// needle here\n"),
            ("README.md", "a needle in the docs\n"),
            ("node_modules/pkg/index.js", "needle\n"),
            (".git/config", "needle\n"),
        ] {
            let file = root.join(path);
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, body).unwrap();
        }
        std::fs::write(root.join("blob.bin"), [0xff, 0xfe, b'n', b'e', b'e', b'd', b'l', b'e']).unwrap();
        root
    }

    async fn run(root: &Path, query: &str, path: &str, pattern: Option<&str>, case: bool, max: usize) -> AppResult<String> {
        search_files(SearchOptions { query, path, file_pattern: pattern, case_sensitive: case, max_results: max }, root.to_str()).await
    }

    #[tokio::test]
    async fn finds_lines_skips_vendor_dirs_and_binaries() {
        let root = workspace();
        let out = run(&root, "needle", ".", None, false, 100).await.unwrap();
        assert_eq!(out, "README.md:1: a needle in the docs\nsrc/app.ts:1: const Needle = 1;\nsrc/deep/view.tsx:1: // needle here");

        assert!(run(&root, "needle", ".", None, true, 100).await.unwrap().lines().all(|l| !l.contains("Needle")));
        assert_eq!(run(&root, "nothing-like-this", ".", None, false, 100).await.unwrap(), "No matches found.");
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn filters_by_glob_path_and_caps_results() {
        let root = workspace();
        let by_name = run(&root, "needle", ".", Some("*.tsx"), false, 100).await.unwrap();
        assert_eq!(by_name, "src/deep/view.tsx:1: // needle here");
        let by_path = run(&root, "needle", ".", Some("src/**/*.ts*"), false, 100).await.unwrap();
        assert_eq!(by_path.lines().count(), 2, "{by_path}");
        assert_eq!(run(&root, "needle", "src", None, false, 100).await.unwrap().lines().count(), 2);
        assert_eq!(run(&root, "needle", "src/app.ts", None, false, 100).await.unwrap(), "src/app.ts:1: const Needle = 1;");

        let capped = run(&root, "needle", ".", None, false, 1).await.unwrap();
        assert!(capped.ends_with("[stopped at 1 matches]"), "{capped}");
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn stays_inside_the_workspace() {
        let root = workspace();
        assert!(run(&root, "x", "../", None, false, 10).await.is_err());
        assert!(run(&root, "x", "/etc", None, false, 10).await.is_err());
        assert!(run(&root, "", ".", None, false, 10).await.is_err());
        let _ = std::fs::remove_dir_all(root);
    }
}
