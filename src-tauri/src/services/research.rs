//! Deep research: search, read the pages, then stream a cited report. The Rust
//! counterpart of src/backend/routes/research.ts; it emits the same stage events.

use crate::chat::agent::{cancelled, EventSink};
use crate::error::{AppError, AppResult};
use crate::providers::traits::{ChatMessage, ChatRequest, LlmProvider};
use crate::tools::{read_url::read_url_limited, search_web::search_web};
use async_trait::async_trait;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::watch;

const SYSTEM_PROMPT: &str = "You are a research analyst. Your task is to synthesize information from multiple web sources into a clear, well-structured report.

Structure your report as:
1. **Executive Summary** (2-3 sentences)
2. **Key Findings** (bullet points with citations [1], [2], etc.)
3. **Detailed Analysis** (paragraphs with citations)
4. **Sources** (numbered list of URLs)

Always cite sources using [N] notation. Be factual and objective.";

#[derive(Debug, Clone, Deserialize)]
pub struct ResearchRequest {
    pub query: String,
    #[serde(default)]
    pub model: String,
    #[serde(default, alias = "maxSources")]
    pub max_sources: Option<usize>,
    #[serde(default)]
    pub depth: Option<String>,
    /// Lets the UI cancel this run; events carry it as `chat_id`.
    #[serde(default, alias = "researchId")]
    pub research_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Source {
    pub title: String,
    pub url: String,
    pub summary: String,
    pub fetched: bool,
}

/// What research needs from the outside world, so tests do not touch the network.
#[async_trait]
pub trait Web: Send + Sync {
    /// Raw JSON array of `{title, url, description}`.
    async fn search(&self, query: &str) -> AppResult<String>;
    async fn read(&self, url: &str, max_chars: usize) -> AppResult<String>;
}

pub struct LiveWeb;

#[async_trait]
impl Web for LiveWeb {
    async fn search(&self, query: &str) -> AppResult<String> {
        search_web(query).await
    }
    async fn read(&self, url: &str, max_chars: usize) -> AppResult<String> {
        read_url_limited(url, max_chars).await
    }
}

pub fn chars_per_source(depth: Option<&str>) -> usize {
    match depth {
        Some("deep") => 10_000,
        Some("quick") => 3_000,
        _ => 6_000,
    }
}

fn first_chars(text: &str, count: usize) -> String {
    text.chars().take(count).collect()
}

pub fn sources_text(sources: &[Source]) -> String {
    sources
        .iter()
        .enumerate()
        .map(|(i, s)| format!("[Source {}] {}\nURL: {}\n{}", i + 1, s.title, s.url, s.summary))
        .collect::<Vec<_>>()
        .join("\n\n---\n\n")
}

pub fn user_prompt(query: &str, sources: &str) -> String {
    format!("Research question: \"{query}\"\n\nSources:\n\n{sources}\n\nWrite a comprehensive research report based on these sources.")
}

/// Runs one research turn. Progress and the report stream to `sink` as stage
/// events; `Err` is reported by the caller as an `error` stage.
pub async fn run_research(
    web: &dyn Web,
    provider: &dyn LlmProvider,
    model: &str,
    request: &ResearchRequest,
    sink: &dyn EventSink,
    mut cancel: watch::Receiver<bool>,
) -> AppResult<()> {
    let query = request.query.trim();
    if query.is_empty() {
        return Err(AppError::InvalidRequest("query required".into()));
    }

    sink.emit(json!({ "stage": "searching", "message": format!("Searching for: \"{query}\"") }));
    let found = tokio::select! {
        biased;
        _ = cancelled(&mut cancel) => return Ok(()),
        found = web.search(query) => found?,
    };
    let results: Vec<Value> = serde_json::from_str(&found).map_err(|_| AppError::Provider("Search returned no parseable results".into()))?;
    let results: Vec<&Value> = results.iter().take(request.max_sources.unwrap_or(5)).collect();

    let text_of = |value: &Value, key: &str| value[key].as_str().unwrap_or("").to_string();
    sink.emit(json!({
        "stage": "found",
        "message": format!("Found {} sources", results.len()),
        "sources": results.iter().map(|r| json!({ "title": text_of(r, "title"), "url": text_of(r, "url") })).collect::<Vec<_>>(),
    }));

    let limit = chars_per_source(request.depth.as_deref());
    for (i, result) in results.iter().enumerate() {
        sink.emit(json!({ "stage": "reading", "message": format!("Reading source {}/{}: {}", i + 1, results.len(), text_of(result, "title")), "url": text_of(result, "url") }));
    }

    // Pages are fetched at once, so this step costs the slowest source rather than
    // the sum of all of them; results stay in search order.
    let reads = futures::future::join_all(results.iter().map(|result| {
        let url = text_of(result, "url");
        async move { web.read(&url, limit).await }
    }));
    let pages = tokio::select! {
        biased;
        _ = cancelled(&mut cancel) => return Ok(()),
        pages = reads => pages,
    };
    let sources: Vec<Source> = results
        .iter()
        .zip(pages)
        .map(|(result, page)| {
            let (fetched, summary) = match page {
                Ok(text) if !text.trim().is_empty() => (true, first_chars(&text, 2000)),
                _ => (false, text_of(result, "description")),
            };
            Source { title: text_of(result, "title"), url: text_of(result, "url"), summary, fetched }
        })
        .collect();

    sink.emit(json!({ "stage": "synthesizing", "message": "Synthesizing research report…" }));
    let chat = ChatRequest {
        model: model.to_string(),
        messages: vec![ChatMessage::new("user", user_prompt(query, &sources_text(&sources)))],
        system_prompt: Some(SYSTEM_PROMPT.to_string()),
        skip_memory: true,
        ..Default::default()
    };
    let mut stream = tokio::select! {
        biased;
        _ = cancelled(&mut cancel) => return Ok(()),
        started = provider.chat(chat) => started?,
    };
    sink.emit(json!({ "stage": "streaming", "message": "Generating report…" }));

    loop {
        let item = tokio::select! {
            biased;
            _ = cancelled(&mut cancel) => return Ok(()),
            item = stream.next() => item,
        };
        let Some(item) = item else { break };
        let chunk = item?;
        if let Some(message) = chunk.message.filter(|m| !m.content.is_empty()) {
            sink.emit(json!({ "stage": "chunk", "content": message.content }));
        }
        if chunk.done {
            break;
        }
    }

    sink.emit(json!({
        "stage": "done",
        "message": "Research complete",
        "sourceCount": sources.len(),
        "sources": sources.iter().map(|s| json!({ "title": s.title, "url": s.url, "fetched": s.fetched })).collect::<Vec<_>>(),
    }));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::test_support::{MockResponse, MockServer};
    use crate::providers::ProviderRegistry;
    use std::collections::HashMap;
    use std::sync::Mutex;

    struct Collect(Mutex<Vec<Value>>);
    impl EventSink for Collect {
        fn emit(&self, event: Value) {
            self.0.lock().unwrap().push(event);
        }
    }

    struct FakeWeb {
        search: Result<String, String>,
    }
    #[async_trait]
    impl Web for FakeWeb {
        async fn search(&self, _: &str) -> AppResult<String> {
            self.search.clone().map_err(AppError::Provider)
        }
        async fn read(&self, url: &str, max_chars: usize) -> AppResult<String> {
            if url.contains("down") {
                Err(AppError::Provider("HTTP 503".into()))
            } else {
                Ok(format!("page of {url} (limit {max_chars}) {}", "x".repeat(3000)))
            }
        }
    }

    fn results() -> String {
        json!([
            { "title": "One", "url": "https://one.test/a", "description": "first" },
            { "title": "Two", "url": "https://down.test/b", "description": "second described" },
            { "title": "Three", "url": "https://three.test/c", "description": "third" },
        ])
        .to_string()
    }

    fn request(depth: Option<&str>, max: Option<usize>) -> ResearchRequest {
        ResearchRequest { query: "why is the sky blue".into(), model: "m".into(), max_sources: max, depth: depth.map(String::from), research_id: None }
    }

    async fn provider(server: &MockServer) -> std::sync::Arc<crate::providers::ollama::OllamaProvider> {
        ProviderRegistry::from_settings(&HashMap::from([("ollama_host".to_string(), server.url())]), &|_| None).ollama()
    }

    fn report_server() -> impl std::future::Future<Output = MockServer> {
        MockServer::start(|_, _, _| {
            MockResponse::ok(
                "application/x-ndjson",
                vec![
                    "{\"message\":{\"role\":\"assistant\",\"content\":\"Rayleigh \"},\"done\":false}\n",
                    "{\"message\":{\"role\":\"assistant\",\"content\":\"scattering [1]\"},\"done\":false}\n{\"done\":true}\n",
                ],
            )
        })
    }

    #[tokio::test]
    async fn emits_the_web_stage_sequence_and_a_cited_report() {
        let server = report_server().await;
        let ollama = provider(&server).await;
        let sink = Collect(Mutex::new(vec![]));
        let (_tx, rx) = watch::channel(false);

        run_research(&FakeWeb { search: Ok(results()) }, ollama.as_ref(), "m", &request(Some("quick"), Some(2)), &sink, rx).await.unwrap();

        let events = sink.0.lock().unwrap().clone();
        let stages: Vec<&str> = events.iter().map(|e| e["stage"].as_str().unwrap()).collect();
        assert_eq!(stages, vec!["searching", "found", "reading", "reading", "synthesizing", "streaming", "chunk", "chunk", "done"]);
        assert_eq!(events[0]["message"], "Searching for: \"why is the sky blue\"");
        assert_eq!(events[1]["message"], "Found 2 sources", "maxSources caps the list");
        assert_eq!(events[3]["message"], "Reading source 2/2: Two");

        let done = events.last().unwrap();
        assert_eq!(done["sourceCount"], 2);
        assert_eq!(done["sources"], json!([
            { "title": "One", "url": "https://one.test/a", "fetched": true },
            { "title": "Two", "url": "https://down.test/b", "fetched": false },
        ]));

        // The model saw the page text (cut to 2000 chars) and, for the failed page, the search snippet.
        let (_, _, body) = server.recorded().remove(0);
        let body: Value = serde_json::from_str(&body).unwrap();
        let prompt = body["messages"][1]["content"].as_str().unwrap();
        assert!(prompt.starts_with("Research question: \"why is the sky blue\""));
        assert!(prompt.contains("[Source 1] One\nURL: https://one.test/a\npage of https://one.test/a (limit 3000)"), "{prompt}");
        assert!(prompt.contains("[Source 2] Two\nURL: https://down.test/b\nsecond described"), "{prompt}");
        assert!(body["messages"][0]["content"].as_str().unwrap().contains("research analyst"));
    }

    #[test]
    fn depth_sets_how_much_of_each_page_is_read() {
        assert_eq!((chars_per_source(Some("quick")), chars_per_source(None), chars_per_source(Some("deep"))), (3_000, 6_000, 10_000));
    }

    #[tokio::test]
    async fn a_failed_search_and_an_empty_query_are_errors() {
        let server = report_server().await;
        let ollama = provider(&server).await;
        let sink = Collect(Mutex::new(vec![]));
        let (_tx, rx) = watch::channel(false);

        let bad = run_research(&FakeWeb { search: Ok("not json".into()) }, ollama.as_ref(), "m", &request(None, None), &sink, rx.clone()).await;
        assert!(bad.unwrap_err().to_string().contains("no parseable results"));

        let down = run_research(&FakeWeb { search: Err("Search returned HTTP 429".into()) }, ollama.as_ref(), "m", &request(None, None), &sink, rx.clone()).await;
        assert!(down.unwrap_err().to_string().contains("429"));

        let mut empty = request(None, None);
        empty.query = "   ".into();
        assert!(run_research(&FakeWeb { search: Ok("[]".into()) }, ollama.as_ref(), "m", &empty, &sink, rx).await.is_err());
    }

    #[tokio::test]
    async fn cancelling_stops_quietly_without_a_done_event() {
        let server = report_server().await;
        let ollama = provider(&server).await;
        let sink = Collect(Mutex::new(vec![]));
        let (tx, rx) = watch::channel(false);
        tx.send(true).unwrap();

        run_research(&FakeWeb { search: Ok(results()) }, ollama.as_ref(), "m", &request(None, None), &sink, rx).await.unwrap();
        assert!(sink.0.lock().unwrap().iter().all(|e| e["stage"] != "done"));
        assert!(server.recorded().is_empty(), "no model call after cancelling");
    }
}
