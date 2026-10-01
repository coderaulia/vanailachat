use crate::error::{AppError, AppResult};
use crate::services::documents::{extract_document_text, Extracted};
use tauri::ipc::{InvokeBody, Request};

/// Extracts text from an uploaded document. The file travels as the raw request
/// body (no JSON number arrays for a 25MB PDF); its name arrives in `x-file-name`.
#[tauri::command]
pub async fn extract_attachment(request: Request<'_>) -> AppResult<Extracted> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::InvalidRequest("file bytes required".into()));
    };
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|value| value.to_str().ok())
        .map(|value| urlencoding::decode(value).map(|s| s.into_owned()).unwrap_or_else(|_| value.to_string()))
        .unwrap_or_else(|| "attachment".to_string());
    let mime = request.headers().get("x-file-type").and_then(|value| value.to_str().ok()).filter(|m| !m.is_empty());
    extract_document_text(&name, bytes.clone(), mime).await
}
