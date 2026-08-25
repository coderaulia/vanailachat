use crate::db::models::SkillRecord;
use crate::error::AppResult;
use crate::services::skills::parse_skill_frontmatter;
use crate::state::AppState;
use serde::Deserialize;
use tauri::State;

#[tauri::command]
pub async fn get_skills(state: State<'_, AppState>) -> AppResult<Vec<SkillRecord>> {
    let db = state.db.lock();
    db.list_skills()
}

#[derive(Deserialize)]
pub struct InstallSkillPayload {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub content: String,
    pub source_url: Option<String>,
}

#[tauri::command]
pub async fn install_skill(
    state: State<'_, AppState>,
    payload: InstallSkillPayload,
) -> AppResult<SkillRecord> {
    // Validate frontmatter if raw SKILL.md content
    let (name, desc, body) = if payload.content.starts_with("---") {
        let (n, d, b) = parse_skill_frontmatter(&payload.content)?;
        (n, Some(d), b)
    } else {
        (payload.name, payload.description, payload.content)
    };

    let db = state.db.lock();
    db.upsert_skill(
        &payload.id,
        &name,
        desc.as_deref(),
        &body,
        payload.source_url.as_deref(),
    )
}
