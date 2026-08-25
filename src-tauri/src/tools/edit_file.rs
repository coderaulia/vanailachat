use super::read_file::resolve_path;
use crate::error::{AppError, AppResult};
use tokio::fs;

pub async fn edit_file(
    file_path: &str,
    old_string: &str,
    new_string: &str,
    project_root: Option<&str>,
) -> AppResult<String> {
    let resolved = resolve_path(file_path, project_root)?;

    let content = fs::read_to_string(&resolved).await.map_err(AppError::Io)?;

    let count = content.matches(old_string).count();
    if count == 0 {
        return Err(AppError::InvalidRequest(
            "old_string was not found in target file".to_string(),
        ));
    }
    if count > 1 {
        return Err(AppError::InvalidRequest(
            format!("old_string matched {} times in target file; provide a more unique snippet", count),
        ));
    }

    let updated = content.replacen(old_string, new_string, 1);
    fs::write(&resolved, updated).await.map_err(AppError::Io)?;

    Ok(format!("Successfully edited {:?}", resolved))
}
