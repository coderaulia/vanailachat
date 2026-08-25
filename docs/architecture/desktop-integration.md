# Linux Desktop Integration Specifications

This document defines the system integration specifications for Vanaila Chat on Linux distributions (Debian/Ubuntu, Arch Linux, and Fedora).

---

## 1. XDG Base Directory Compliance

The desktop application strictly follows the **Freedesktop XDG Base Directory Specification**:

| Directory Type | XDG Variable | Resolved Path | Purpose |
| :--- | :--- | :--- | :--- |
| **Config** | `$XDG_CONFIG_HOME` | `~/.config/vanaila-chat/` | User preferences, custom provider configs |
| **Data** | `$XDG_DATA_HOME` | `~/.local/share/vanaila-chat/` | SQLite database (`vanaila.sqlite`), generated docs |
| **Cache** | `$XDG_CACHE_HOME` | `~/.cache/vanaila-chat/` | Downloaded model metadata, temporary export files |
| **Runtime** | `$XDG_RUNTIME_DIR` | `/run/user/$UID/vanaila-chat/` | Ephemeral sockets / IPC lock files |

### Rust Path Resolver (`src-tauri/src/desktop/xdg.rs`)
```rust
use std::path::PathBuf;
use dirs;

pub struct DesktopPaths {
    pub config_dir: PathBuf,
    pub data_dir: PathBuf,
    pub cache_dir: PathBuf,
}

impl DesktopPaths {
    pub fn new() -> Self {
        let app_name = "vanaila-chat";
        Self {
            config_dir: dirs::config_dir().unwrap_or_else(|| PathBuf::from("~/.config")).join(app_name),
            data_dir: dirs::data_dir().unwrap_or_else(|| PathBuf::from("~/.local/share")).join(app_name),
            cache_dir: dirs::cache_dir().unwrap_or_else(|| PathBuf::from("~/.cache")).join(app_name),
        }
    }

    pub fn ensure_directories(&self) -> std::io::Result<()> {
        std::fs::create_dir_all(&self.config_dir)?;
        std::fs::create_dir_all(&self.data_dir)?;
        std::fs::create_dir_all(&self.cache_dir)?;
        Ok(())
    }

    pub fn database_file(&self) -> PathBuf {
        self.data_dir.join("vanaila.sqlite")
    }
}
```

---

## 2. System Tray & Background Keepalive

Vanaila Chat provides a native system tray icon powered by `libayatana-appindicator3`.

### 2.1 Behavior
- **Close Window Action**: When the user clicks the window close button (`X`), the window hides to the system tray instead of terminating the process (configurable in Settings).
- **Background Ollama Keepalive**: If Ollama daemon was auto-started by Vanaila Chat, it stays running while minimized in the tray to avoid cold-start delays.
- **Tray Menu Actions**:
  - **Show Vanaila Chat**: Restores and focuses the main application window.
  - **New Chat**: Restores the window and automatically starts a new conversation.
  - **Ollama Status**: Indicates whether local Ollama is active / idle.
  - **Quit**: Fully shuts down the application and cleanly terminates auto-started background processes.

### 2.2 System Dependency
- **Debian / Ubuntu**: `libayatana-appindicator3-1` (or `libappindicator3-1`)
- **Fedora**: `libayatana-appindicator-gtk3`
- **Arch Linux**: `libayatana-appindicator`

---

## 3. Freedesktop Desktop Entry (`.desktop`)

File location: `/usr/share/applications/com.vanaila.chat.desktop` (or `~/.local/share/applications/com.vanaila.chat.desktop`)

```ini
[Desktop Entry]
Version=1.5
Type=Application
Name=Vanaila Chat
GenericName=AI Chat Client
Comment=Privacy-first, high-performance local AI chat client with multi-provider LLM support
Exec=vanaila-chat %U
Icon=com.vanaila.chat
Terminal=false
Categories=Utility;Development;Network;Chat;
Keywords=AI;Chat;LLM;Ollama;GPT;Claude;Anthropic;LocalAI;
StartupWMClass=vanaila-chat
MimeType=application/x-vanaila-export;
Actions=new-chat;open-settings;

[Desktop Action new-chat]
Name=New Chat
Exec=vanaila-chat --new-chat

[Desktop Action open-settings]
Name=Settings
Exec=vanaila-chat --settings
```

---

## 4. Icon Packaging & Brand Identity

Scalable vector icons and standard freedesktop raster icon resolutions:

```
packaging/linux/icons/
├── 16x16/apps/com.vanaila.chat.png
├── 24x24/apps/com.vanaila.chat.png
├── 32x32/apps/com.vanaila.chat.png
├── 48x48/apps/com.vanaila.chat.png
├── 64x64/apps/com.vanaila.chat.png
├── 128x128/apps/com.vanaila.chat.png
├── 256x256/apps/com.vanaila.chat.png
├── 512x512/apps/com.vanaila.chat.png
└── scalable/apps/com.vanaila.chat.svg
```

Installed to `/usr/share/icons/hicolor/<size>/apps/com.vanaila.chat.png`.

---

## 5. Wayland & X11 Compatibility

Vanaila Chat runs on both **Wayland** (GNOME, KDE Plasma 6, Hyprland, Sway) and **X11**:
- **WebKitGTK Compositing**: Uses Wayland-native EGL compositing by default with fallback to X11.
- **Fractional Scaling**: Automatically scales crisp fonts and UI tokens under Wayland fractional scaling (125%, 150%, 175%).
- **Window Decorations**: Native client-side decorations (CSD) match the user's active GTK theme or system dark/light preference.

---

## 6. Future Keyring Integration Roadmap (`libsecret`)

While the MVP stores encrypted API tokens in the SQLite `settings` table, the architecture provides a clean upgrade path to native Linux Keyring integration:

### 6.1 Target Providers
- **GNOME / XFCE / MATE**: GNOME Keyring (`libsecret-1`)
- **KDE Plasma**: KWallet (via Secret Service D-Bus interface)
- **Headless / KeePassXC**: Secret Service D-Bus API

### 6.2 Implementation Architecture
```rust
// Future: src-tauri/src/services/keyring.rs
// Uses `secret-service` or `keyring` crate

pub struct SecureKeyringService;

impl SecureKeyringService {
    pub fn store_api_key(provider: &str, key: &str) -> Result<(), KeyringError> {
        let entry = keyring::Entry::new("com.vanaila.chat", provider)?;
        entry.set_password(key)?;
        Ok(())
    }

    pub fn get_api_key(provider: &str) -> Result<Option<String>, KeyringError> {
        let entry = keyring::Entry::new("com.vanaila.chat", provider)?;
        match entry.get_password() {
            Ok(pwd) => Ok(Some(pwd)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
}
```
*When activated, the SQLite `settings` table will store a reference pointer `[SECURE_KEYRING]` while actual secrets reside exclusively in the system vault.*
