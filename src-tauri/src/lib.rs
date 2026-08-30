pub mod commands;
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

    // Load initial settings for providers from DB or environment
    let all_settings = db.get_all_settings().unwrap_or_default();
    let openai_key = all_settings
        .get("openai_api_key")
        .cloned()
        .or_else(|| std::env::var("OPENAI_API_KEY").ok());
    let openrouter_key = all_settings
        .get("openrouter_api_key")
        .cloned()
        .or_else(|| std::env::var("OPENROUTER_API_KEY").ok());

    let provider_registry = ProviderRegistry::new(None, openai_key, openrouter_key);
    let ollama_manager = OllamaManager::new(None, true);
    let approval_service = ApprovalService::new();

    let app_state = AppState {
        db: Arc::new(Mutex::new(db)),
        provider_registry: Arc::new(Mutex::new(provider_registry)),
        ollama_manager: Arc::new(ollama_manager),
        approval_service: Arc::new(approval_service),
        active_stream_abort: Arc::new(tokio::sync::Mutex::new(None)),
    };

    tauri::Builder::default()
        .manage(app_state)
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            ping,
            commands::chats::get_chats,
            commands::chats::create_chat,
            commands::chats::delete_chat,
            commands::messages::get_messages,
            commands::messages::save_message,
            commands::messages::search_messages,
            commands::messages::set_feedback,
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
            commands::skills::get_skills,
            commands::skills::install_skill,
            commands::research::start_research,
            commands::chat::start_chat,
            commands::chat::cancel_chat,
            commands::chat::approve_tool,
            commands::coding::get_coding_session,
            commands::coding::create_coding_session,
            commands::coding::update_coding_session,
            commands::coding::run_coding,
        ])
        .run(tauri::generate_context!())
        .expect("error while running vanaila chat tauri application");
}
