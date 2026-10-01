use crate::db::models::SkillRecord;
use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::services::skills::{parse_skill_md, CATALOG};
use crate::state::AppState;
use serde::Serialize;
use tauri::State;

#[tauri::command]
pub async fn get_skills(state: State<'_, AppState>) -> AppResult<Vec<SkillRecord>> {
    state.db.lock().list_skills()
}

/// One row of the skills catalog merged with what is installed; same shape as the web `/api/skills/catalog`.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogRow {
    pub name: String,
    pub raw_url: String,
    pub installed: bool,
    pub enabled: bool,
    pub id: Option<String>,
    pub description: Option<String>,
}

pub fn catalog_rows(db: &Database) -> AppResult<Vec<CatalogRow>> {
    let installed = db.list_skills()?;
    Ok(CATALOG
        .iter()
        .map(|entry| {
            let local = installed.iter().find(|s| s.name == entry.name);
            CatalogRow {
                name: entry.name.clone(),
                raw_url: entry.raw_url.clone(),
                installed: local.is_some(),
                enabled: local.is_some_and(|s| s.enabled),
                id: local.map(|s| s.id.clone()),
                description: local.and_then(|s| s.description.clone()),
            }
        })
        .collect())
}

#[tauri::command]
pub async fn get_skill_catalog(state: State<'_, AppState>) -> AppResult<Vec<CatalogRow>> {
    catalog_rows(&state.db.lock())
}

/// Saves a SKILL.md fetched from the catalog.
pub fn install_catalog_text(db: &Database, catalog_name: &str, source_url: &str, raw: &str) -> AppResult<SkillRecord> {
    let parsed = parse_skill_md(raw);
    let name = if parsed.name.is_empty() { catalog_name.to_string() } else { parsed.name };
    let description = if parsed.description.is_empty() { format!("Skill: {name}") } else { parsed.description };
    db.upsert_skill(&format!("skill_{}", uuid::Uuid::new_v4()), &name, Some(&description), &parsed.body, Some(source_url), true)
}

/// Saves a SKILL.md the user pasted in; it must name itself in its frontmatter.
pub fn install_custom_text(db: &Database, raw: &str) -> AppResult<SkillRecord> {
    if raw.trim().is_empty() {
        return Err(AppError::InvalidRequest("content is required".into()));
    }
    let parsed = parse_skill_md(raw);
    if parsed.name.is_empty() {
        return Err(AppError::InvalidRequest("SKILL.md must have a `name` in YAML frontmatter".into()));
    }
    let description = if parsed.description.is_empty() { format!("Custom skill: {}", parsed.name) } else { parsed.description };
    db.upsert_skill(&format!("skill_{}", uuid::Uuid::new_v4()), &parsed.name, Some(&description), &parsed.body, None, true)
}

#[tauri::command]
pub async fn install_catalog_skill(state: State<'_, AppState>, name: String) -> AppResult<SkillRecord> {
    // Only addresses from the catalog are fetched, never one the UI supplies.
    let entry = CATALOG.iter().find(|e| e.name == name).ok_or_else(|| AppError::NotFound(format!("Unknown skill: {name}")))?;
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(AppError::Network)?
        .get(&entry.raw_url)
        .send()
        .await
        .map_err(AppError::Network)?;
    if !response.status().is_success() {
        return Err(AppError::Provider(format!("Failed to fetch skill: HTTP {}", response.status().as_u16())));
    }
    let raw = response.text().await.map_err(AppError::Network)?;
    install_catalog_text(&state.db.lock(), &entry.name, &entry.raw_url, &raw)
}

#[tauri::command]
pub async fn install_custom_skill(state: State<'_, AppState>, content: String) -> AppResult<SkillRecord> {
    install_custom_text(&state.db.lock(), &content)
}

#[tauri::command]
pub async fn set_skill_enabled(state: State<'_, AppState>, id: String, enabled: bool) -> AppResult<()> {
    if state.db.lock().set_skill_enabled(&id, enabled)? {
        Ok(())
    } else {
        Err(AppError::NotFound("Skill not found".into()))
    }
}

#[tauri::command]
pub async fn delete_skill(state: State<'_, AppState>, id: String) -> AppResult<()> {
    if state.db.lock().delete_skill(&id)? {
        Ok(())
    } else {
        Err(AppError::NotFound("Skill not found".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_catalog_marks_installed_skills() {
        let db = Database::in_memory().unwrap();
        let rows = catalog_rows(&db).unwrap();
        assert!(rows.iter().all(|r| !r.installed && r.id.is_none()));

        let raw = "---\nname: frontend-design\ndescription: Builds UIs\n---\nBe bold.";
        let entry = &CATALOG[CATALOG.iter().position(|e| e.name == "frontend-design").unwrap()];
        let skill = install_catalog_text(&db, &entry.name, &entry.raw_url, raw).unwrap();
        assert!(skill.enabled);

        let after = catalog_rows(&db).unwrap();
        let row = after.iter().find(|r| r.name == "frontend-design").unwrap();
        assert_eq!((row.installed, row.enabled, row.description.as_deref()), (true, true, Some("Builds UIs")));
        assert_eq!(row.id.as_deref(), Some(skill.id.as_str()));
    }

    #[test]
    fn a_catalog_skill_without_frontmatter_falls_back_to_its_catalog_name() {
        let db = Database::in_memory().unwrap();
        let skill = install_catalog_text(&db, "theme-factory", "https://raw.githubusercontent.com/x", "Just instructions").unwrap();
        assert_eq!((skill.name.as_str(), skill.description.as_deref()), ("theme-factory", Some("Skill: theme-factory")));
        assert_eq!(skill.content, "Just instructions");
    }

    #[test]
    fn custom_skills_need_a_name() {
        let db = Database::in_memory().unwrap();
        assert!(install_custom_text(&db, "  ").is_err());
        assert!(install_custom_text(&db, "no frontmatter at all").is_err());
        let skill = install_custom_text(&db, "---\nname: mine\n---\nDo the thing.").unwrap();
        assert_eq!(skill.description.as_deref(), Some("Custom skill: mine"));
        assert!(skill.source_url.is_none());
    }
}
