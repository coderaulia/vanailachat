use crate::error::AppResult;
use crate::tools::read_url::read_url;
use crate::tools::search_web::search_web;
use serde_json::Value;

pub async fn execute_research(query: &str) -> AppResult<Vec<String>> {
    let search_results_json = search_web(query).await?;
    let items: Vec<Value> = serde_json::from_str(&search_results_json).unwrap_or_default();

    let mut extracted_texts = Vec::new();
    for item in items.iter().take(3) {
        if let Some(url) = item.get("url").and_then(|u| u.as_str()) {
            if let Ok(content) = read_url(url).await {
                if !content.is_empty() {
                    extracted_texts.push(content);
                }
            }
        }
    }

    Ok(extracted_texts)
}
