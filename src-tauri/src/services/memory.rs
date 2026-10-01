//! Memory recall: similarity scoring and ranking.
//!
//! Mirrors `EmbeddingService` in the web backend (src/backend/services/embedding.ts)
//! so the same memories rank the same way on both editions.

use crate::db::models::StoredMemory;
use sha2::{Digest, Sha256};
use std::collections::HashSet;

const DECAY_HALFLIFE_DAYS: f64 = 30.0;
const POSITIVE_FEEDBACK_BOOST: f64 = 1.15;
const NEGATIVE_FEEDBACK_PENALTY: f64 = 0.5;
/// Only the newest entries are scored, keeping recall cheap however large the table grows.
pub const RECALL_WINDOW: usize = 1000;

#[derive(Debug, Clone, PartialEq)]
pub struct ScoredMemory {
    pub id: String,
    pub content: String,
    pub score: f64,
    pub metadata: Option<String>,
}

pub fn generate_memory_id(r#type: &str, content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(r#type.as_bytes());
    hasher.update(b":");
    hasher.update(content.trim().as_bytes());
    let result = hasher.finalize();
    format!("mem_{}", hex::encode(&result[..12]))
}

pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let len = a.len().min(b.len());
    if len == 0 {
        return 0.0;
    }
    let (mut dot, mut norm_a, mut norm_b) = (0.0f32, 0.0f32, 0.0f32);
    for i in 0..len {
        dot += a[i] * b[i];
        norm_a += a[i] * a[i];
        norm_b += b[i] * b[i];
    }
    let denominator = norm_a.sqrt() * norm_b.sqrt();
    if denominator == 0.0 {
        0.0
    } else {
        dot / denominator
    }
}

/// Older memories count for less (30-day half-life); thumbs-up boosts, thumbs-down halves.
pub fn apply_score_weights(raw: f64, created_at_ms: i64, rating: f64, now_ms: i64) -> f64 {
    let age_days = ((now_ms - created_at_ms) as f64 / 86_400_000.0).max(0.0);
    let mut weighted = raw * 0.5f64.powf(age_days / DECAY_HALFLIFE_DAYS);
    if rating > 0.0 {
        weighted *= POSITIVE_FEEDBACK_BOOST;
    } else if rating < 0.0 {
        weighted *= NEGATIVE_FEEDBACK_PENALTY;
    }
    weighted
}

fn rating_of(metadata: Option<&str>) -> f64 {
    metadata
        .and_then(|m| serde_json::from_str::<serde_json::Value>(m).ok())
        .and_then(|v| v["rating"].as_f64())
        .filter(|r| r.is_finite())
        .unwrap_or(0.0)
}

fn rank(mut scored: Vec<ScoredMemory>, top_k: usize, threshold: f64) -> Vec<ScoredMemory> {
    scored.retain(|m| m.score >= threshold);
    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(top_k);
    for memory in &mut scored {
        memory.score = (memory.score * 100.0).round() / 100.0;
    }
    scored
}

pub fn search_with_vector(entries: &[StoredMemory], query: &[f32], top_k: usize, threshold: f64, now_ms: i64) -> Vec<ScoredMemory> {
    let scored = entries
        .iter()
        .map(|entry| {
            let raw = cosine_similarity(query, &entry.vector) as f64;
            ScoredMemory {
                id: entry.id.clone(),
                content: entry.content.clone(),
                score: apply_score_weights(raw, entry.created_at, rating_of(entry.metadata.as_deref()), now_ms),
                metadata: entry.metadata.clone(),
            }
        })
        .collect();
    rank(scored, top_k, threshold)
}

const STOPWORDS: &[&str] = &[
    "the", "and", "for", "that", "this", "with", "from", "you", "your", "are", "was", "were", "what", "when", "where", "which",
    "who", "how", "why", "can", "could", "would", "should", "have", "has", "had", "not", "but", "all", "any", "our", "their",
    "about", "into", "than", "then", "them", "they", "there", "here", "his", "her", "its", "been", "being", "does", "did",
];

fn tokenize(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !(c.is_ascii_lowercase() || c.is_ascii_digit()))
        .filter(|t| t.len() > 2 && !STOPWORDS.contains(t))
        .map(String::from)
        .collect()
}

/// Word-overlap recall for when no embedding backend is reachable.
pub fn search_by_keyword(entries: &[StoredMemory], query: &str, top_k: usize, threshold: f64, now_ms: i64) -> Vec<ScoredMemory> {
    let mut seen = HashSet::new();
    let tokens: Vec<String> = tokenize(query).into_iter().filter(|t| seen.insert(t.clone())).collect();
    if tokens.is_empty() {
        return vec![];
    }
    let scored = entries
        .iter()
        .map(|entry| {
            let haystack = entry.content.to_lowercase();
            let hits = tokens.iter().filter(|t| haystack.contains(t.as_str())).count();
            let raw = hits as f64 / tokens.len() as f64;
            ScoredMemory {
                id: entry.id.clone(),
                content: entry.content.clone(),
                score: apply_score_weights(raw, entry.created_at, rating_of(entry.metadata.as_deref()), now_ms),
                metadata: entry.metadata.clone(),
            }
        })
        .collect();
    rank(scored, top_k, threshold)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: i64 = 86_400_000;

    fn entry(id: &str, content: &str, vector: Vec<f32>, age_days: i64, metadata: Option<&str>, now: i64) -> StoredMemory {
        StoredMemory { id: id.into(), content: content.into(), metadata: metadata.map(String::from), created_at: now - age_days * DAY, vector }
    }

    #[test]
    fn test_cosine_similarity() {
        assert!((cosine_similarity(&[1.0, 0.0, 0.0], &[1.0, 0.0, 0.0]) - 1.0).abs() < 1e-5);
        assert_eq!(cosine_similarity(&[1.0, 0.0, 0.0], &[0.0, 1.0, 0.0]), 0.0);
        assert_eq!(cosine_similarity(&[], &[1.0]), 0.0);
    }

    #[test]
    fn test_memory_id_generation() {
        let id1 = generate_memory_id("chat", "Hello world");
        assert_eq!(id1, generate_memory_id("chat", "  Hello world "));
        assert_ne!(id1, generate_memory_id("chat", "Different content"));
        assert_ne!(id1, generate_memory_id("manual", "Hello world"));
        assert!(id1.starts_with("mem_"));
    }

    #[test]
    fn decay_halves_every_thirty_days_and_feedback_reweights() {
        let now = 100 * DAY;
        assert!((apply_score_weights(1.0, now, 0.0, now) - 1.0).abs() < 1e-9);
        assert!((apply_score_weights(1.0, now - 30 * DAY, 0.0, now) - 0.5).abs() < 1e-9);
        assert!((apply_score_weights(1.0, now, 1.0, now) - 1.15).abs() < 1e-9);
        assert!((apply_score_weights(1.0, now, -1.0, now) - 0.5).abs() < 1e-9);
        // A clock slightly behind the stored time does not amplify the score.
        assert!((apply_score_weights(1.0, now + DAY, 0.0, now) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn vector_search_ranks_by_similarity_recency_and_rating() {
        let now = 200 * DAY;
        let entries = vec![
            entry("close_old", "a", vec![1.0, 0.0], 60, None, now),
            entry("close_new", "b", vec![1.0, 0.0], 0, None, now),
            entry("liked", "c", vec![0.9, 0.1], 0, Some("{\"rating\":1}"), now),
            entry("disliked", "d", vec![1.0, 0.0], 0, Some("{\"rating\":-1}"), now),
            entry("orthogonal", "e", vec![0.0, 1.0], 0, None, now),
            entry("no_vector", "f", vec![], 0, None, now),
        ];
        let hits = search_with_vector(&entries, &[1.0, 0.0], 3, 0.3, now);
        let ids: Vec<&str> = hits.iter().map(|h| h.id.as_str()).collect();
        assert_eq!(ids[0], "liked");
        assert!(ids.contains(&"close_new") && !ids.contains(&"orthogonal") && !ids.contains(&"no_vector"));
        assert_eq!(hits.len(), 3);
        assert_eq!(hits[0].score, (hits[0].score * 100.0).round() / 100.0, "scores are rounded to two places");
    }

    #[test]
    fn keyword_search_scores_the_share_of_matching_words() {
        let now = 50 * DAY;
        let entries = vec![
            entry("tabs", "I prefer tabs over spaces in Rust code", vec![], 0, None, now),
            entry("deploy", "Deploys happen on Fridays", vec![], 0, None, now),
        ];
        let hits = search_by_keyword(&entries, "Do you remember my Rust tabs preference?", 3, 0.2, now);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, "tabs");
        // Only stopwords and short words: nothing to match on.
        assert!(search_by_keyword(&entries, "what is it", 3, 0.2, now).is_empty());
    }
}
