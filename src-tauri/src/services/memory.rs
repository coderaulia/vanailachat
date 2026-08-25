use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemorySearchResult {
    pub id: String,
    pub content: String,
    pub similarity: f32,
    pub r#type: String,
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
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }

    let mut dot = 0.0;
    let mut norm_a = 0.0;
    let mut norm_b = 0.0;

    for (x, y) in a.iter().zip(b.iter()) {
        dot += x * y;
        norm_a += x * x;
        norm_b += y * y;
    }

    if norm_a <= 0.0 || norm_b <= 0.0 {
        return 0.0;
    }

    dot / (norm_a.sqrt() * norm_b.sqrt())
}

pub fn search_memories(
    query_vector: &[f32],
    stored_memories: &[(String, String, Vec<f32>, String)], // (id, content, vec, type)
    top_k: usize,
    threshold: f32,
) -> Vec<MemorySearchResult> {
    let mut scored: Vec<MemorySearchResult> = stored_memories
        .iter()
        .map(|(id, content, vec, r#type)| {
            let sim = cosine_similarity(query_vector, vec);
            MemorySearchResult {
                id: id.clone(),
                content: content.clone(),
                similarity: sim,
                r#type: r#type.clone(),
            }
        })
        .filter(|m| m.similarity >= threshold)
        .collect();

    scored.sort_by(|a, b| b.similarity.partial_cmp(&a.similarity).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(top_k);
    scored
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cosine_similarity() {
        let v1 = vec![1.0, 0.0, 0.0];
        let v2 = vec![1.0, 0.0, 0.0];
        assert!((cosine_similarity(&v1, &v2) - 1.0).abs() < 1e-5);

        let v3 = vec![0.0, 1.0, 0.0];
        assert_eq!(cosine_similarity(&v1, &v3), 0.0);
    }

    #[test]
    fn test_memory_id_generation() {
        let id1 = generate_memory_id("chat", "Hello world");
        let id2 = generate_memory_id("chat", "Hello world");
        let id3 = generate_memory_id("chat", "Different content");
        assert_eq!(id1, id2);
        assert_ne!(id1, id3);
        assert!(id1.starts_with("mem_"));
    }
}
