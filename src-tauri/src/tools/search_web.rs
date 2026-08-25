use crate::error::{AppError, AppResult};
use reqwest::Client;
use scraper::{Html, Selector};
use serde_json::json;

pub async fn search_web(query: &str) -> AppResult<String> {
    let client = Client::builder()
        .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(AppError::Network)?;

    let url = format!("https://html.duckduckgo.com/html/?q={}", urlencoding::encode(query));
    let resp = client.get(&url).send().await.map_err(AppError::Network)?;
    let html_text = resp.text().await.map_err(AppError::Network)?;

    let document = Html::parse_document(&html_text);
    let result_selector = Selector::parse(".result").unwrap();
    let title_selector = Selector::parse(".result__title a").unwrap();
    let snippet_selector = Selector::parse(".result__snippet").unwrap();

    let mut results = Vec::new();

    for element in document.select(&result_selector).take(5) {
        let title = element
            .select(&title_selector)
            .next()
            .map(|e| e.text().collect::<Vec<_>>().join(""))
            .unwrap_or_default();

        let link = element
            .select(&title_selector)
            .next()
            .and_then(|e| e.value().attr("href"))
            .unwrap_or_default();

        let snippet = element
            .select(&snippet_selector)
            .next()
            .map(|e| e.text().collect::<Vec<_>>().join(""))
            .unwrap_or_default();

        if !title.is_empty() && !link.is_empty() {
            results.push(json!({
                "title": title.trim(),
                "url": link.trim(),
                "snippet": snippet.trim(),
            }));
        }
    }

    Ok(serde_json::to_string_pretty(&results).unwrap_or_else(|_| "[]".to_string()))
}
