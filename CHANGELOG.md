# Changelog

All notable changes to Vanaila Chat are documented here.

## [0.3.2] - 2026-08-31

### Fixed

- Fixed native desktop message sending by normalizing the frontend chat payload for Rust Tauri IPC.
- Desktop IPC errors are now surfaced instead of silently falling back to the web-only HTTP endpoint.

### Added

- Added an in-app Application Log panel in the desktop header.
- The log captures console output, runtime errors, and unhandled promise failures for desktop sessions launched without a terminal.
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
