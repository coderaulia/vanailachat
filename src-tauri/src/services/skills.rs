use serde::Deserialize;
use std::sync::LazyLock;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    pub name: String,
    pub raw_url: String,
}

#[derive(Deserialize)]
struct CatalogFile {
    skills: Vec<CatalogEntry>,
}

/// Skills offered in the catalog, shared with the web backend through
/// `contracts/skills-catalog.json` (generated from src/backend/routes/skills.ts).
pub static CATALOG: LazyLock<Vec<CatalogEntry>> = LazyLock::new(|| {
    serde_json::from_str::<CatalogFile>(include_str!("../../../contracts/skills-catalog.json"))
        .map(|file| file.skills)
        .unwrap_or_default()
});

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ParsedSkill {
    pub name: String,
    pub description: String,
    pub body: String,
}

fn unquote(value: &str) -> String {
    let v = value.trim();
    for quote in ['"', '\''] {
        if v.len() >= 2 && v.starts_with(quote) && v.ends_with(quote) {
            return v[1..v.len() - 1].to_string();
        }
    }
    v.to_string()
}

/// Reads the `---` frontmatter of a SKILL.md. A folded or multi-line
/// `description:` is joined into one line. Without frontmatter the whole text
/// is the body and the name is empty.
pub fn parse_skill_md(raw: &str) -> ParsedSkill {
    let text = raw.replace("\r\n", "\n");
    let Some(rest) = text.strip_prefix("---\n").or_else(|| text.strip_prefix("---\r\n")) else {
        return ParsedSkill { body: text.trim().to_string(), ..Default::default() };
    };
    let Some(end) = rest.find("\n---") else {
        return ParsedSkill { body: text.trim().to_string(), ..Default::default() };
    };
    let front = &rest[..end];
    let after = &rest[end + 4..];
    let body = after.strip_prefix('\n').unwrap_or(after).trim().to_string();

    let mut name = String::new();
    let mut description = String::new();
    let lines: Vec<&str> = front.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        if let Some(value) = line.strip_prefix("name:") {
            name = unquote(value);
        } else if let Some(value) = line.strip_prefix("description:") {
            let mut parts = vec![value.trim().to_string()];
            // Continuation lines are indented.
            while i + 1 < lines.len() && lines[i + 1].starts_with([' ', '\t']) {
                i += 1;
                parts.push(lines[i].trim().to_string());
            }
            // `>` / `|` only mark a block scalar; they are not the text.
            let joined = parts.into_iter().filter(|p| !matches!(p.as_str(), ">" | "|" | ">-" | "|-" | "")).collect::<Vec<_>>().join(" ");
            description = unquote(&joined);
        }
        i += 1;
    }
    ParsedSkill { name, description, body }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_name_description_and_body() {
        let parsed = parse_skill_md("---\nname: \"Web Researcher\"\ndescription: Advanced internet search\n---\n\n# Instructions\nSearch well.");
        assert_eq!(parsed.name, "Web Researcher");
        assert_eq!(parsed.description, "Advanced internet search");
        assert_eq!(parsed.body, "# Instructions\nSearch well.");
    }

    #[test]
    fn joins_folded_and_multiline_descriptions() {
        let folded = parse_skill_md("---\nname: a\ndescription: >\n  First part\n  second part.\nlicense: MIT\n---\nBody");
        assert_eq!(folded.description, "First part second part.");
        let plain = parse_skill_md("---\nname: b\ndescription: One line\n  continued here\n---\nBody");
        assert_eq!(plain.description, "One line continued here");
    }

    #[test]
    fn handles_windows_line_endings_and_missing_frontmatter() {
        let crlf = parse_skill_md("---\r\nname: win\r\ndescription: d\r\n---\r\nText");
        assert_eq!((crlf.name.as_str(), crlf.body.as_str()), ("win", "Text"));
        let none = parse_skill_md("# Just text\nNo frontmatter.");
        assert!(none.name.is_empty());
        assert_eq!(none.body, "# Just text\nNo frontmatter.");
        assert!(parse_skill_md("---\nname: unclosed\nbody").name.is_empty());
    }

    #[test]
    fn the_shared_catalog_loads() {
        assert!(CATALOG.len() >= 10);
        assert!(CATALOG.iter().all(|e| e.raw_url.starts_with("https://raw.githubusercontent.com/")));
        assert!(CATALOG.iter().any(|e| e.name == "frontend-design"));
    }
}
