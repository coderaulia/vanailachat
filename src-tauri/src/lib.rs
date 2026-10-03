pub mod chat;
pub mod commands;
mod contract;
pub mod db;
pub mod desktop;
pub mod error;
pub mod providers;
pub mod services;
pub mod state;
pub mod tools;

use db::Database;
use desktop::xdg::DesktopPaths;
use parking_lot::Mutex;
use providers::ProviderRegistry;
use services::{ApprovalService, OllamaManager};
use state::AppState;
use std::sync::Arc;

#[tauri::command]
fn ping() -> &'static str {
    "pong"
}

#[tauri::command]
async fn check_for_update(app: tauri::AppHandle) -> error::AppResult<desktop::update::UpdateInfo> {
    desktop::update::check_for_update(&app.package_info().version.to_string()).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let desktop_paths = DesktopPaths::new();
    if let Err(e) = desktop_paths.ensure_directories() {
        eprintln!("[warn] Failed to create XDG directories: {}", e);
    }

    let db_path = desktop_paths.database_file();
    let db = match Database::new(&db_path) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[error] Failed to initialize SQLite at {:?}: {}. Falling back to in-memory.", db_path, e);
            Database::in_memory().expect("In-memory SQLite failed")
        }
    };

    let _ = db.reset_running_coding_sessions();

    // Providers come from the saved settings, falling back to the environment.
    let all_settings = db.get_all_settings().unwrap_or_default();
    let provider_registry = ProviderRegistry::from_settings(&all_settings, &|key| std::env::var(key).ok());
    let ollama_manager = OllamaManager::new(Some(provider_registry.ollama().base_url()), true);
    let approval_service = ApprovalService::new();

    let app_state = AppState {
        db: Arc::new(Mutex::new(db)),
        provider_registry: Arc::new(Mutex::new(provider_registry)),
        ollama_manager: Arc::new(ollama_manager),
        approval_service: Arc::new(approval_service),
        active_streams: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
    };

    tauri::Builder::default()
        .manage(app_state)
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if shortcut == &desktop::shell::toggle_shortcut()
                        && event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed
                    {
                        desktop::shell::toggle_main(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            if let Err(error) = desktop::shell::setup_tray(app.handle()) {
                eprintln!("[warn] System tray unavailable: {error}");
            }
            desktop::shell::register_shortcut(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ping,
            check_for_update,
            commands::chats::get_chats,
            commands::chats::create_chat,
            commands::chats::delete_chat,
            commands::chats::update_chat,
            commands::messages::get_messages,
            commands::messages::save_message,
            commands::messages::supersede_messages,
            commands::messages::get_message_versions,
            commands::messages::search_messages,
            commands::messages::set_feedback,
            commands::messages::get_feedback,
            commands::models::get_models,
            commands::models::pull_model,
            commands::projects::get_projects,
            commands::projects::get_project,
            commands::projects::create_project,
            commands::projects::update_project,
            commands::projects::delete_project,
            commands::settings::get_settings,
            commands::settings::update_setting,
            commands::data::export_data,
            commands::data::import_data,
            commands::data::get_training_examples,
            commands::data::get_training_stats,
            commands::git::get_git_status,
            commands::git::get_git_diff,
            commands::git::create_git_branch,
            commands::skills::get_skills,
            commands::skills::get_skill_catalog,
            commands::skills::install_catalog_skill,
            commands::skills::install_custom_skill,
            commands::skills::set_skill_enabled,
            commands::skills::delete_skill,
            commands::memory::get_memories,
            commands::memory::add_memory,
            commands::memory::delete_memory,
            commands::memory::clear_memories,
            commands::research::start_research,
            commands::ab::run_ab,
            commands::ab::pick_ab,
            commands::attachments::extract_attachment,
            commands::fs::browse_directory,
            commands::chat::start_chat,
            commands::chat::chat_once,
            commands::chat::cancel_chat,
            commands::chat::approve_tool,
            commands::coding::get_coding_session,
            commands::coding::create_coding_session,
            commands::coding::update_coding_session,
            commands::coding::run_coding,
            commands::coding::undo_coding_turn,
        ])
        .run(tauri::generate_context!())
        .expect("error while running vanaila chat tauri application");
}
