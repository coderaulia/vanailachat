// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        // Fix WebKitGTK Wayland Protocol Error 71 on Linux (Fedora/GNOME/NVIDIA/Intel)
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        if std::env::var_os("__NV_DISABLE_EXPLICIT_SYNC").is_none() {
            std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
        }
        if std::env::var_os("TAURI_LINUX_AYATANA_APPINDICATOR").is_none() {
            std::env::set_var("TAURI_LINUX_AYATANA_APPINDICATOR", "1");
        }
    }

    vanaila_chat_lib::run()
}

