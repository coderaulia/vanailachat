# Vanaila Chat Documentation

Welcome to the technical architecture and development documentation for **Vanaila Chat**.

---

## 📚 Linux Desktop Architecture (Tauri 2.0 & Rust)

The native Linux desktop edition (`com.vanaila.chat`) runs as a dedicated, high-performance desktop application coexisting with the web application.

- 🏗️ **[Desktop Architecture Overview](architecture/desktop-app.md)**: Dual-target web/desktop strategy, runtime detection, Tauri IPC bridge, and state management.
- 🦀 **[Rust Backend Implementation Mapping](architecture/rust-backend-mapping.md)**: 1:1 mapping of Node.js services/routes to Rust modules, traits, schema migrations, and tools.
- 🐧 **[Linux Desktop Integration](architecture/desktop-integration.md)**: XDG Base Directory compliance, System Tray (`libayatana-appindicator`), `.desktop` entry, and Keyring roadmap.
- 📦 **[Multi-Distro Packaging Guide](architecture/linux-packaging.md)**: Packaging for Debian/Ubuntu (`.deb`), Fedora (`.rpm`), Arch Linux (`PKGBUILD` for AUR), AppImage, Flatpak, and automated CI/CD.
- 🎨 **[UI & Brand Identity Enhancements](architecture/ui-desktop-enhancements.md)**: Splash screen, brand identity, desktop multi-column responsiveness, window drag regions, and keyboard accelerators.

---

## 🌐 Web Edition Architecture

- `src/frontend/`: React 19 + Vite 6 client application.
- `src/backend/`: Node.js 20 + Hono + `better-sqlite3` web server.
- `start.sh`: 1-click Linux/macOS bootstrap script.
