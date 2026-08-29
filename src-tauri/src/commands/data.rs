use crate::db::models::{ChatRecord, MessageRecord, ProjectRecord};
use crate::error::AppResult;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

#[derive(Serialize, Deserialize)]
pub struct ExportBundle {
    pub exported_at: i64,
    pub projects: Vec<ProjectRecord>,
    pub chats: Vec<ChatRecord>,
    pub messages: Vec<MessageRecord>,
    pub settings: HashMap<String, String>,
}

#[derive(Deserialize)]
pub struct ImportPayload {
    pub projects: Option<Vec<ProjectRecord>>,
    pub chats: Option<Vec<ChatRecord>>,
    pub messages: Option<Vec<MessageRecord>>,
}

#[derive(Serialize)]
pub struct ImportResult {
    pub imported_projects: usize,
    pub imported_chats: usize,
    pub skipped_chats: usize,
    pub imported_messages: usize,
}

#[tauri::command]
pub async fn export_data(state: State<'_, AppState>) -> AppResult<ExportBundle> {
    let db = state.db.lock();
    let projects = db.list_projects()?;
    let chats = db.list_chats(None, None)?;
    
    let mut messages = Vec::new();
    for chat in &chats {
        let chat_msgs = db.list_messages(&chat.id, None)?;
        messages.extend(chat_msgs);
    }

    let settings = db.get_all_settings()?;

    Ok(ExportBundle {
        exported_at: chrono::Utc::now().timestamp_millis(),
        projects,
        chats,
        messages,
        settings,
    })
}

#[tauri::command]
pub async fn import_data(
    state: State<'_, AppState>,
    payload: ImportPayload,
) -> AppResult<ImportResult> {
    let db = state.db.lock();
    let mut imported_projects = 0;
    let mut imported_chats = 0;
    let mut skipped_chats = 0;
    let mut imported_messages = 0;

    let existing_projects = db.list_projects()?;
    let existing_project_ids: std::collections::HashSet<String> =
        existing_projects.into_iter().map(|p| p.id).collect();

    if let Some(projects) = payload.projects {
        for p in projects {
            if !existing_project_ids.contains(&p.id) {
                let _ = db.create_project(
                    &p.id,
                    &p.name,
                    p.description.as_deref(),
                    p.instructions.as_deref(),
                );
                imported_projects += 1;
            }
        }
    }

    let existing_chats = db.list_chats(None, None)?;
    let existing_chat_ids: std::collections::HashSet<String> =
        existing_chats.into_iter().map(|c| c.id).collect();

    let mut imported_chat_ids = std::collections::HashSet::new();

    if let Some(chats) = payload.chats {
        for c in chats {
            if existing_chat_ids.contains(&c.id) {
                skipped_chats += 1;
                continue;
            }

            let _ = db.upsert_chat(
                &c.id,
                &c.title,
                c.project_id.as_deref(),
                c.project_root.as_deref(),
                c.system_prompt.as_deref(),
                c.model.as_deref(),
                c.role.as_deref(),
            );
            imported_chats += 1;
            imported_chat_ids.insert(c.id);
        }
    }

    if let Some(messages) = payload.messages {
        for m in messages {
            if imported_chat_ids.contains(&m.chat_id) {
                let _ = db.save_message(&m.id, &m.chat_id, &m.role, &m.content);
                imported_messages += 1;
            }
        }
    }

    Ok(ImportResult {
        imported_projects,
        imported_chats,
        skipped_chats,
        imported_messages,
    })
}
