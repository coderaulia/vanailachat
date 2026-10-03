use super::read_file::resolve_path;
use crate::error::{AppError, AppResult};
use std::path::Path;

/// Never worth listing, whatever .gitignore says.
const ALWAYS_SKIPPED: &[&str] = &[".git", "node_modules", "target", "dist", "build", ".next"];
const MAX_ENTRIES: usize = 500;

/// Plain names from the project's .gitignore (`dist/`, `*.log`-style patterns are ignored here).
fn gitignored_names(root: &Path) -> Vec<String> {
    std::fs::read_to_string(root.join(".gitignore"))
        .map(|text| {
            text.lines()
                .map(str::trim)
                .filter(|l| !l.is_empty() && !l.starts_with('#') && !l.starts_with('!') && !l.contains(['*', '?', '[']))
                .map(|l| l.trim_matches('/').to_string())
                .filter(|l| !l.contains('/'))
                .collect()
        })
        .unwrap_or_default()
}

fn walk(dir: &Path, depth: usize, max_depth: usize, indent: &str, ignored: &[String], lines: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = entries.filter_map(Result::ok).collect();
    entries.sort_by_key(|e| e.file_name().to_string_lossy().to_lowercase());
    for entry in entries {
        if lines.len() >= MAX_ENTRIES {
            return;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if ALWAYS_SKIPPED.contains(&name.as_str()) || ignored.contains(&name) {
            continue;
        }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        lines.push(format!("{indent}- {name}{}", if is_dir { "/" } else { "" }));
        if is_dir && depth < max_depth {
            walk(&entry.path(), depth + 1, max_depth, &format!("{indent}  "), ignored, lines);
        }
    }
}

/// An indented tree of `dir_path` down to `max_depth` levels (default 2), skipping vendor and ignored folders.
pub async fn list_directory(dir_path: Option<&str>, max_depth: Option<usize>, project_root: Option<&str>) -> AppResult<String> {
    let target = dir_path.filter(|p| !p.trim().is_empty()).unwrap_or(".");
    let resolved = resolve_path(target, project_root)?;
    let root = resolve_path(".", project_root)?;
    if !resolved.is_dir() {
        return Err(AppError::InvalidRequest(format!("{target} is not a directory")));
    }
    let ignored = gitignored_names(&root);
    let mut lines = vec![format!("{}/", resolved.strip_prefix(&root).ok().filter(|p| !p.as_os_str().is_empty()).map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|| ".".into()))];
    walk(&resolved, 0, max_depth.unwrap_or(2).min(6), "", &ignored, &mut lines);
    if lines.len() >= MAX_ENTRIES {
        lines.push(format!("[stopped at {MAX_ENTRIES} entries; list a subfolder or lower maxDepth]"));
    }
    Ok(lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn lists_a_depth_limited_tree_without_vendor_or_ignored_folders() {
        let root = std::env::temp_dir().join(format!("vanaila-ls-{}", uuid::Uuid::new_v4()));
        for dir in ["src/deep/deeper", "node_modules/x", ".git", "secrets", "docs"] {
            std::fs::create_dir_all(root.join(dir)).unwrap();
        }
        std::fs::write(root.join("src/main.rs"), "").unwrap();
        std::fs::write(root.join(".gitignore"), "# c\nsecrets/\n*.log\n").unwrap();
        let r = root.to_str();

        let tree = list_directory(None, Some(1), r).await.unwrap();
        assert_eq!(tree, "./\n- .gitignore\n- docs/\n- src/\n  - deep/\n  - main.rs");

        let deep = list_directory(Some("src"), Some(3), r).await.unwrap();
        assert_eq!(deep, "src/\n- deep/\n  - deeper/\n- main.rs");

        assert!(list_directory(Some("src/main.rs"), None, r).await.is_err());
        assert!(list_directory(Some("../"), None, r).await.is_err());
        let _ = std::fs::remove_dir_all(root);
    }
}
