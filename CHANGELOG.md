# Changelog

All notable changes to Vanaila Chat are documented here.

## [Unreleased]

### Added

- Earlier answers stay available after Regenerate: step through them with the 1 / 2 switcher on the answer.
- Archive chats from the sidebar; archived chats sit behind an **Archived** toggle.
- Download Ollama models from **Settings → AI Connection** with a live progress bar (web and desktop).
- Chat header shows the chat's total tokens and, for priced models, estimated cost.
- Desktop: tray menu (Show, New chat, Quit), global `Ctrl+Shift+Space` show/hide, and a daily update notice from GitHub Releases.
- Optional `VANAILA_ACCESS_TOKEN` (and `HOST`) for using the web edition from other devices.
- Automatic database backup before migrations (`data/backups`, newest five kept).
- Shared API contract (`contracts/api-shapes.json`) tested against both backends.

### Fixed

- Regenerated or edited messages no longer reappear after reloading a chat.
- Databases created before the migration table existed now receive every migration after v4.
- Blockquotes, GitHub-style alerts and formatted link text render as markdown instead of raw text.
- Model output can no longer render forms, inputs or inline styles.
- `write_file` can no longer create files through a symlinked directory that leaves the project; `run_command` blocks git flags that write files or read outside the repo, kills children at its timeout, and does not pass API keys to them.
- Desktop: chat rename/pin/archive, search, ratings, tool approvals and auto-approve now work (they called the web API); desktop paths with missing parents are confined to the project; desktop records use the same field names as the web API, so exports move between editions.
- Training export now honours **Include distillation pairs**.

### Changed

- Settings modal split into one component per tab with a shared autosaving store.
- Backend database code split into per-domain modules behind `DatabaseService`.

## [0.3.2] - 2026-09-02

### Fixed

- Fixed native desktop message streaming by bridging `useSendMessage` directly through native Tauri IPC `start_chat` without web server dependency.
- Desktop IPC errors and streaming chunks are now surfaced in real-time.

### Added

- Added an in-app Application Log panel (`AppLogPanel`) in the desktop header for runtime diagnostics.
- Added a dedicated Dark/Light visual theme selector in **Settings → Appearance** and the frosted sidebar footer.
- Added Linux runtime-library and AppImage FUSE installation notes to the distribution documentation.

### Verified

- Frontend type-check and lint pass.
- Backend production build passes.
- 262 automated tests pass.
- Rust tests and checks pass.
- Debian, RPM, and AppImage Linux bundles build successfully.

### Linux runtime requirements

The native desktop packages require GTK/WebKitGTK and Ayatana AppIndicator libraries. The `.deb` and `.rpm` packages declare their core dependencies and should be installed with the distribution package manager. AppImage users must install the matching runtime libraries if they are missing.

On Fedora/RHEL:

```bash
sudo dnf install gtk3 webkit2gtk4.1 libayatana-appindicator-gtk3 fuse-libs
```

On Debian/Ubuntu:

```bash
sudo apt install libgtk-3-0 libwebkit2gtk-4.1-0 libayatana-appindicator3-1 libfuse2
```

Then make the AppImage executable:

```bash
chmod +x "Vanaila Chat_0.3.2_amd64.AppImage"
./"Vanaila Chat_0.3.2_amd64.AppImage"
```

## [0.3.1-fix] - 2026-08-30

- Startup hotfix for the native Linux desktop application.
- Added desktop parity improvements and native coding workspace support.
