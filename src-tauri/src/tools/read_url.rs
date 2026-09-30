use super::net_guard::check_outbound_url;
use crate::error::{AppError, AppResult};
use futures::StreamExt;
use reqwest::Client;
use scraper::Html;

pub const DEFAULT_MAX_CHARS: usize = 8_000;
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;

pub async fn read_url(target_url: &str) -> AppResult<String> {
    read_url_limited(target_url, DEFAULT_MAX_CHARS).await
}

pub async fn read_url_limited(target_url: &str, max_chars: usize) -> AppResult<String> {
    let target = check_outbound_url(target_url).await?;

    let mut builder = Client::builder()
        .user_agent("Mozilla/5.0 (compatible; VanailaChat/1.0; +research-agent)")
        .redirect(reqwest::redirect::Policy::none()) // a redirect could lead somewhere internal
        .timeout(std::time::Duration::from_secs(15));
    if let Some(host) = &target.pinned_host {
        // Connect to the address that was vetted, not whatever DNS says next time.
        builder = builder.resolve(host, target.addrs[0]);
    }
    let client = builder.build().map_err(AppError::Network)?;

    let resp = client
        .get(target.url.clone())
        .header("Accept", "text/html,text/plain")
        .send()
        .await
        .map_err(AppError::Network)?;

    let status = resp.status();
    if status.is_redirection() {
        let location = resp.headers().get("location").and_then(|v| v.to_str().ok()).unwrap_or("unknown");
        return Err(AppError::Security(format!("Redirect to {location} not followed")));
    }
    if !status.is_success() {
        return Err(AppError::Provider(format!("HTTP {status}")));
    }

    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let readable = content_type.is_empty()
        || content_type.starts_with("text/")
        || content_type.contains("json")
        || content_type.contains("xml");
    if !readable {
        return Err(AppError::InvalidRequest(format!("Unsupported content type: {content_type}")));
    }

    let mut body = Vec::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        body.extend_from_slice(&chunk.map_err(AppError::Network)?);
        if body.len() >= MAX_BODY_BYTES {
            body.truncate(MAX_BODY_BYTES);
            break;
        }
    }
    let text = String::from_utf8_lossy(&body);

    let content = if content_type.contains("html") || content_type.is_empty() {
        visible_text(&text)
    } else {
        collapse_whitespace(&text)
    };
    Ok(truncate_chars(&content, max_chars))
}

/// Text a reader would see: no scripts, styles or head metadata.
pub fn visible_text(html: &str) -> String {
    let document = Html::parse_document(html);
    let mut out = String::new();
    for node in document.root_element().descendants() {
        let Some(text) = node.value().as_text() else { continue };
        let hidden = node.ancestors().any(|ancestor| {
            ancestor
                .value()
                .as_element()
                .is_some_and(|el| matches!(el.name(), "script" | "style" | "noscript" | "template" | "head"))
        });
        if !hidden {
            out.push_str(text);
            out.push(' ');
        }
    }
    collapse_whitespace(&out)
}

fn collapse_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Cuts at a character boundary; slicing by byte offset panics on non-ASCII text.
pub fn truncate_chars(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    format!("{}… [truncated]", text.chars().take(max_chars).collect::<String>())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_readable_text_without_scripts_styles_or_head() {
        let html = "<html><head><title>T</title><style>p{color:red}</style></head><body><h1>Hello</h1><script>var secret = 1;</script><p>World &amp; more</p><noscript>enable js</noscript></body></html>";
        assert_eq!(visible_text(html), "Hello World & more");
    }

    #[test]
    fn truncates_on_a_character_boundary() {
        // A byte slice at 5 would split the two-byte "é" characters and panic.
        let text = "ééééé ééééé";
        assert_eq!(truncate_chars(text, 5), "ééééé… [truncated]");
        assert_eq!(truncate_chars("short", 100), "short");
    }

    #[tokio::test]
    async fn refuses_internal_targets_before_connecting() {
        for url in ["http://127.0.0.1:11434/api/tags", "http://localhost/", "file:///etc/passwd", "http://169.254.169.254/"] {
            assert!(read_url(url).await.is_err(), "{url}");
        }
    }
}
