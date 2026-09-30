//! System tray and the global show/hide shortcut.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

/// Frontend event asking for a fresh chat (tray "New chat").
pub const NEW_CHAT_EVENT: &str = "vanaila://new-chat";

/// Ctrl+Shift+Space shows or hides the window from anywhere.
pub fn toggle_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space)
}

pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn toggle_main<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else { return };
    let visible_and_focused = window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false);
    if visible_and_focused {
        let _ = window.hide();
    } else {
        show_main(app);
    }
}

pub fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Vanaila Chat", true, Some("Ctrl+Shift+Space"))?;
    let new_chat = MenuItem::with_id(app, "new_chat", "New chat", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &new_chat, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Vanaila Chat")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "new_chat" => {
                show_main(app);
                let _ = app.emit(NEW_CHAT_EVENT, ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        // Linux trays only deliver menu events; the click toggle is for macOS/Windows.
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                toggle_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Registers the toggle shortcut. Some desktops (Wayland compositors, or
/// another app holding the combination) refuse it; that is logged, not fatal.
pub fn register_shortcut<R: Runtime>(app: &AppHandle<R>) {
    if let Err(error) = app.global_shortcut().register(toggle_shortcut()) {
        eprintln!("[warn] Global shortcut Ctrl+Shift+Space unavailable: {error}");
    }
}
