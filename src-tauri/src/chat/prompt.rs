//! System prompt assembly. Mirrors `buildSystemPrompt` in src/backend/routes/chat.ts.

use super::personas;
use crate::db::models::{ChatRecord, ProjectRecord, SkillRecord};
use crate::services::memory::ScoredMemory;
use std::collections::HashMap;

pub struct PromptContext<'a> {
    pub settings: &'a HashMap<String, String>,
    pub project: Option<&'a ProjectRecord>,
    pub chat: Option<&'a ChatRecord>,
    pub search: bool,
    /// Enabled skills only.
    pub skills: &'a [SkillRecord],
    pub persona: Option<&'a str>,
    pub memories: &'a [ScoredMemory],
    /// Internal calls (title generation) get a bare prompt.
    pub skip_profile: bool,
}

pub struct BuiltPrompt {
    pub text: String,
    /// Tools the persona is limited to; empty means no limit.
    pub persona_tools: Vec<String>,
    pub skills_available: bool,
}

fn setting<'a>(settings: &'a HashMap<String, String>, key: &str) -> &'a str {
    settings.get(key).map(|v| v.trim()).unwrap_or("")
}

/// One line for the skill index: the stored description, else the first prose line.
pub fn summarize_skill(description: Option<&str>, content: &str) -> String {
    let cut = |text: &str| text.chars().take(200).collect::<String>();
    if let Some(description) = description.map(str::trim).filter(|d| !d.is_empty()) {
        return cut(description);
    }
    let lines: Vec<&str> = content.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    // A SKILL.md usually opens with a heading that just repeats the name.
    let prose = lines.iter().find(|l| !l.starts_with('#'));
    let heading = lines.first().map(|l| l.trim_start_matches('#').trim());
    cut(prose.copied().or(heading).unwrap_or("No description"))
}

pub fn build_system_prompt(ctx: &PromptContext) -> BuiltPrompt {
    let mut prompt = String::from("You are a helpful assistant.");

    if !ctx.skip_profile {
        let name = setting(ctx.settings, "user_name");
        let role = setting(ctx.settings, "user_role");
        let instructions = setting(ctx.settings, "base_instructions");

        let mut profile = Vec::new();
        if !name.is_empty() {
            profile.push(format!("Name: {name}"));
        }
        if !role.is_empty() {
            profile.push(format!("Role: {role}"));
        }
        if !profile.is_empty() {
            prompt.push_str(&format!("\n\n[User Profile]\nYou are talking to:\n{}", profile.join("\n")));
        }
        if !instructions.is_empty() {
            prompt.push_str(&format!("\n\n[User Preferences]\n{instructions}"));
        }
    }

    if let Some(project) = ctx.project {
        if let Some(instructions) = project.instructions.as_deref().filter(|i| !i.trim().is_empty()) {
            prompt.push_str(&format!("\n\n[Project Instructions]\n{instructions}"));
        }
        if let Some(memory) = project.memory.as_deref().filter(|m| !m.trim().is_empty()) {
            prompt.push_str(&format!("\n\n[Shared Project Memory]\n{memory}"));
        }
    }

    let chat_prompt = ctx.chat.and_then(|c| c.system_prompt.as_deref()).filter(|p| !p.trim().is_empty());
    if let Some(chat_prompt) = chat_prompt {
        prompt.push_str(&format!("\n\n[Chat-Specific Instructions]\n{chat_prompt}"));
    }

    if ctx.search {
        prompt.push_str(
            "\n\nWeb search is enabled. ALWAYS use search_web if the user asks for real-time information, news, or facts you are unsure about.",
        );
    }

    // Progressive disclosure: only names and summaries go in, and the model
    // pulls a skill's full text with load_skill when it is relevant. Setting
    // skills_inline restores pasting every skill in full.
    let skills_available = !ctx.skills.is_empty();
    if skills_available {
        if setting(ctx.settings, "skills_inline") == "true" {
            for skill in ctx.skills {
                prompt.push_str(&format!("\n\n[Skill: {}]\n{}", skill.name, skill.content));
            }
        } else {
            let index = ctx
                .skills
                .iter()
                .map(|s| format!("- {}: {}", s.name, summarize_skill(s.description.as_deref(), &s.content)))
                .collect::<Vec<_>>()
                .join("\n");
            prompt.push_str(&format!(
                "\n\n[Available Skills]\n{index}\n\nThese are titles only — you have not been shown their contents. When one is \
                 relevant to the request, call load_skill with the exact name to read its instructions before answering. \
                 Never guess what a skill contains, and ignore skills unrelated to the current question."
            ));
        }
    }

    // A saved chat prompt replaces the persona's.
    if chat_prompt.is_none() {
        if let Some(persona) = personas::system_prompt(ctx.persona) {
            prompt.push_str(&format!("\n\n{persona}"));
        }
    }

    if !ctx.memories.is_empty() {
        let block = ctx
            .memories
            .iter()
            .enumerate()
            .map(|(i, m)| format!("[Memory {} (relevance: {})] {}", i + 1, m.score, m.content))
            .collect::<Vec<_>>()
            .join("\n\n");
        prompt.push_str(&format!("\n\n[Relevant Memories]\n{block}"));
    }

    BuiltPrompt { text: prompt, persona_tools: personas::tool_allowlist(ctx.persona), skills_available }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    fn skill(name: &str, description: Option<&str>, content: &str) -> SkillRecord {
        SkillRecord {
            id: name.into(),
            name: name.into(),
            description: description.map(String::from),
            content: content.into(),
            source_url: None,
            enabled: true,
            installed_at: 0,
        }
    }

    fn project(instructions: &str, memory: &str) -> ProjectRecord {
        ProjectRecord {
            id: "p".into(), name: "P".into(), description: None,
            instructions: Some(instructions.into()), memory: Some(memory.into()),
            pinned: false, created_at: 0, updated_at: 0, project_root: None,
        }
    }

    fn chat(system_prompt: Option<&str>) -> ChatRecord {
        ChatRecord {
            id: "c".into(), title: "T".into(), project_id: None, project_root: None,
            system_prompt: system_prompt.map(String::from), pinned: false, model: None, role: None,
            created_at: 0, updated_at: 0, archived: false,
        }
    }

    fn ctx<'a>(settings: &'a HashMap<String, String>) -> PromptContext<'a> {
        PromptContext { settings, project: None, chat: None, search: false, skills: &[], persona: None, memories: &[], skip_profile: false }
    }

    #[test]
    fn a_bare_prompt_is_just_the_default() {
        let s = settings(&[]);
        assert_eq!(build_system_prompt(&ctx(&s)).text, "You are a helpful assistant.");
    }

    #[test]
    fn includes_profile_preferences_project_and_search_hint_in_order() {
        let s = settings(&[("user_name", "Alex"), ("user_role", "Engineer"), ("base_instructions", "Be terse.")]);
        let p = project("Use TypeScript.", "Ships on Fridays.");
        let built = build_system_prompt(&PromptContext { project: Some(&p), search: true, ..ctx(&s) });
        let t = &built.text;
        let order = ["[User Profile]", "Name: Alex", "Role: Engineer", "[User Preferences]", "Be terse.", "[Project Instructions]", "Use TypeScript.", "[Shared Project Memory]", "Web search is enabled"];
        let positions: Vec<usize> = order.iter().map(|needle| t.find(needle).unwrap_or_else(|| panic!("missing {needle}"))).collect();
        assert!(positions.windows(2).all(|w| w[0] < w[1]), "sections out of order: {t}");
    }

    #[test]
    fn skip_profile_leaves_out_the_user_but_not_the_project() {
        let s = settings(&[("user_name", "Alex")]);
        let p = project("Use TypeScript.", "");
        let built = build_system_prompt(&PromptContext { project: Some(&p), skip_profile: true, ..ctx(&s) });
        assert!(!built.text.contains("Alex") && built.text.contains("Use TypeScript."));
    }

    #[test]
    fn a_saved_chat_prompt_replaces_the_persona() {
        let s = settings(&[]);
        let with_persona = build_system_prompt(&PromptContext { persona: Some("coder"), ..ctx(&s) });
        assert!(with_persona.text.contains("software engineer"));

        let c = chat(Some("Answer in French."));
        let replaced = build_system_prompt(&PromptContext { persona: Some("coder"), chat: Some(&c), ..ctx(&s) });
        assert!(replaced.text.contains("[Chat-Specific Instructions]\nAnswer in French."));
        assert!(!replaced.text.contains("software engineer"));

        let blank = chat(Some("   "));
        assert!(build_system_prompt(&PromptContext { persona: Some("coder"), chat: Some(&blank), ..ctx(&s) }).text.contains("software engineer"));
    }

    #[test]
    fn skills_are_listed_by_name_unless_inlined() {
        let s = settings(&[]);
        let skills = vec![skill("writer", Some("Drafts posts"), "FULL TEXT"), skill("ops", None, "# Ops\nRuns deploys safely.")];
        let built = build_system_prompt(&PromptContext { skills: &skills, ..ctx(&s) });
        assert!(built.skills_available);
        assert!(built.text.contains("- writer: Drafts posts") && built.text.contains("- ops: Runs deploys safely."));
        assert!(built.text.contains("call load_skill") && !built.text.contains("FULL TEXT"));

        let inline = settings(&[("skills_inline", "true")]);
        let built = build_system_prompt(&PromptContext { skills: &skills, ..ctx(&inline) });
        assert!(built.text.contains("[Skill: writer]\nFULL TEXT") && !built.text.contains("[Available Skills]"));

        assert!(!build_system_prompt(&ctx(&s)).skills_available);
    }

    #[test]
    fn summaries_fall_back_to_the_first_prose_line_then_the_heading() {
        assert_eq!(summarize_skill(None, "# Title\n\nFirst real line.\nMore."), "First real line.");
        assert_eq!(summarize_skill(Some("  "), "# Only A Heading"), "Only A Heading");
        assert_eq!(summarize_skill(None, ""), "No description");
        assert_eq!(summarize_skill(Some(&"x".repeat(300)), "").chars().count(), 200);
    }

    #[test]
    fn memories_come_last_with_their_relevance() {
        let s = settings(&[]);
        let memories = vec![
            ScoredMemory { id: "1".into(), content: "Prefers tabs".into(), score: 0.85, metadata: None },
            ScoredMemory { id: "2".into(), content: "Uses Linux".into(), score: 1.0, metadata: None },
        ];
        let built = build_system_prompt(&PromptContext { memories: &memories, persona: Some("coder"), ..ctx(&s) });
        let memory_at = built.text.find("[Relevant Memories]").unwrap();
        assert!(memory_at > built.text.find("software engineer").unwrap());
        assert!(built.text.contains("[Memory 1 (relevance: 0.85)] Prefers tabs\n\n[Memory 2 (relevance: 1)] Uses Linux"));
    }

    #[test]
    fn reports_the_persona_tool_limits() {
        let s = settings(&[]);
        assert_eq!(build_system_prompt(&PromptContext { persona: Some("creator"), ..ctx(&s) }).persona_tools, vec!["search_web"]);
        assert!(build_system_prompt(&ctx(&s)).persona_tools.is_empty());
    }
}
