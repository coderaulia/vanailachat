use crate::error::{AppError, AppResult};
use reqwest::Client;
use scraper::{Html, Selector};
use serde_json::json;

pub async fn search_web(query: &str) -> AppResult<String> {
    let client = Client::builder()
        .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(AppError::Network)?;

    let url = format!("https://html.duckduckgo.com/html/?q={}", urlencoding::encode(query));
    let resp = client.get(&url).send().await.map_err(AppError::Network)?;
    if !resp.status().is_success() {
        return Err(AppError::Provider(format!("Search returned HTTP {}", resp.status())));
    }
    let html_text = resp.text().await.map_err(AppError::Network)?;

    let results = parse_results(&html_text);
    Ok(serde_json::to_string(&results).unwrap_or_else(|_| "[]".to_string()))
}

/// DuckDuckGo wraps every result in a redirect (`//duckduckgo.com/l/?uddg=<real url>`).
/// The model needs the real address to read the page afterwards.
pub fn unwrap_redirect(href: &str) -> String {
    let href = href.trim();
    let absolute = if href.starts_with("//") { format!("https:{href}") } else { href.to_string() };
    if let Ok(parsed) = url::Url::parse(&absolute) {
        if parsed.host_str().is_some_and(|h| h.ends_with("duckduckgo.com")) && parsed.path().starts_with("/l/") {
            if let Some((_, target)) = parsed.query_pairs().find(|(key, _)| key == "uddg") {
                return target.into_owned();
            }
        }
    }
    absolute
}

/// Same shape as the web backend: `[{title, url, description}]`, at most five.
pub fn parse_results(html_text: &str) -> Vec<serde_json::Value> {
    let document = Html::parse_document(html_text);
    let result_selector = Selector::parse(".result").unwrap();
    let title_selector = Selector::parse(".result__title a, a.result__a").unwrap();
    let snippet_selector = Selector::parse(".result__snippet").unwrap();

    let mut results = Vec::new();
    for element in document.select(&result_selector) {
        let Some(link) = element.select(&title_selector).next() else { continue };
        let title = link.text().collect::<Vec<_>>().join("").trim().to_string();
        let href = link.value().attr("href").unwrap_or_default();
        if title.is_empty() || href.is_empty() {
            continue;
        }
        let description = element
            .select(&snippet_selector)
            .next()
            .map(|e| e.text().collect::<Vec<_>>().join("").trim().to_string())
            .unwrap_or_default();
        results.push(json!({ "title": title, "url": unwrap_redirect(href), "description": description }));
        if results.len() == 5 {
            break;
        }
    }
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unwraps_duckduckgo_redirects_to_the_real_url() {
        assert_eq!(
            unwrap_redirect("//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.rust-lang.org%2Flearn&rut=abc"),
            "https://www.rust-lang.org/learn"
        );
        assert_eq!(unwrap_redirect("https://example.com/page"), "https://example.com/page");
    }

    #[test]
    fn parses_results_into_title_url_description() {
        let html = r#"
          <div class="result"><h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.example%2F">First</a></h2>
            <a class="result__snippet">About the first.</a></div>
          <div class="result"><h2 class="result__title"><a class="result__a" href="https://b.example/">Second</a></h2></div>
          <div class="result"><h2 class="result__title"><a class="result__a" href=""></a></h2></div>"#;
        let results = parse_results(html);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0], json!({"title": "First", "url": "https://a.example/", "description": "About the first."}));
        assert_eq!(results[1]["url"], "https://b.example/");
    }
}
