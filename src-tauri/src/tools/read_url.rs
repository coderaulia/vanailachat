use crate::error::{AppError, AppResult};
use reqwest::Client;
use scraper::{Html, Selector};
use std::net::IpAddr;

pub async fn read_url(target_url: &str) -> AppResult<String> {
    let parsed = url::Url::parse(target_url)
        .map_err(|e| AppError::InvalidRequest(format!("Invalid URL: {}", e)))?;

    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(AppError::Security("Only HTTP/HTTPS URLs are allowed".to_string()));
    }

    if let Some(host) = parsed.host_str() {
        if host == "localhost" || host.ends_with(".localhost") || host.contains("metadata") {
            return Err(AppError::Security("Access to localhost/metadata is blocked".to_string()));
        }

        // Check if host resolves to private IP
        if let Ok(ip) = host.parse::<IpAddr>() {
            if is_blocked_ip(&ip) {
                return Err(AppError::Security("Access to private/local IP range is blocked".to_string()));
            }
        }
    }

    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::none()) // Prevent redirect-based SSRF
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(AppError::Network)?;

    let resp = client.get(target_url).send().await.map_err(AppError::Network)?;
    let body = resp.text().await.map_err(AppError::Network)?;

    let document = Html::parse_document(&body);
    let body_selector = Selector::parse("body").unwrap();

    let text = if let Some(body_el) = document.select(&body_selector).next() {
        body_el.text().collect::<Vec<_>>().join(" ")
    } else {
        body
    };

    // Clean whitespace and cap at 100,000 characters
    let cleaned = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let capped = if cleaned.len() > 100_000 {
        format!("{}... [Truncated]", &cleaned[..100_000])
    } else {
        cleaned
    };

    Ok(capped)
}

fn is_blocked_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_documentation()
        }
        IpAddr::V6(v6) => v6.is_loopback(),
    }
}
