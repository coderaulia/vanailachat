use crate::db::models::{ChatRecord, MessageRecord, ProjectRecord, TrainingExample};
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

#[derive(Serialize)]
pub struct TrainingStats {
    pub pairs: usize,
    pub explicit: usize,
    pub edited: usize,
    pub implicit: usize,
    pub distillation: usize,
    pub top_chats: usize,
    pub oldest: Option<i64>,
    pub newest: Option<i64>,
}

#[derive(Deserialize)]
pub struct TrainingExportRequest {
    pub format: Option<String>,
    pub selected_ids: Option<Vec<String>>,
}

#[derive(Serialize)]
pub struct TrainingExportResult {
    pub path: String,
    pub pairs: usize,
    pub explicit: usize,
    pub distilled: usize,
    pub format: String,
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

#[tauri::command]
pub async fn get_training_examples(state: State<'_, AppState>) -> AppResult<Vec<TrainingExample>> {
    let db = state.db.lock();
    db.list_training_examples()
}

#[tauri::command]
pub async fn get_training_stats(state: State<'_, AppState>) -> AppResult<TrainingStats> {
    let db = state.db.lock();
    let examples = db.list_training_examples()?;
    Ok(TrainingStats {
        pairs: examples.len(),
        explicit: examples.iter().filter(|e| !e.edited).count(),
        edited: examples.iter().filter(|e| e.edited).count(),
        implicit: 0,
        distillation: 0,
        top_chats: 0,
        oldest: examples.first().map(|e| e.created_at),
        newest: examples.last().map(|e| e.created_at),
    })
}
