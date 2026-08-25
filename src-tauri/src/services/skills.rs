use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillCatalogItem {
    pub id: String,
    pub name: String,
    pub description: String,
    pub author: String,
    pub category: String,
    pub source_url: String,
    pub installed: bool,
}

pub fn parse_skill_frontmatter(raw_content: &str) -> AppResult<(String, String, String)> {
    let lines: Vec<&str> = raw_content.lines().collect();
    if lines.is_empty() || lines[0].trim() != "---" {
        return Err(AppError::InvalidRequest("Missing YAML frontmatter start (---)".to_string()));
    }

    let mut end_index = None;
    for (i, line) in lines.iter().enumerate().skip(1) {
        if line.trim() == "---" {
            end_index = Some(i);
            break;
        }
    }

    let end_idx = end_index.ok_or_else(|| {
        AppError::InvalidRequest("Missing YAML frontmatter closing (---)".to_string())
    })?;

    let mut name = String::new();
    let mut description = String::new();

    for line in &lines[1..end_idx] {
        if let Some((k, v)) = line.split_once(':') {
            let key = k.trim().to_lowercase();
            let val = v.trim().trim_matches('"').trim_matches('\'');
            if key == "name" {
                name = val.to_string();
            } else if key == "description" {
                description = val.to_string();
            }
        }
    }

    if name.is_empty() {
        return Err(AppError::InvalidRequest("Frontmatter missing 'name' property".to_string()));
    }

    let body = lines[end_idx + 1..].join("\n");
    Ok((name, description, body.trim().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_skill_frontmatter() {
        let content = r#"---
name: "Web Researcher"
description: "Advanced internet search and synthesis"
---

# Instructions
Perform search queries and synthesize findings."#;

        let (name, desc, body) = parse_skill_frontmatter(content).unwrap();
        assert_eq!(name, "Web Researcher");
        assert_eq!(desc, "Advanced internet search and synthesis");
        assert!(body.starts_with("# Instructions"));
    }
}
