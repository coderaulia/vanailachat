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

---

## 🛠️ Developer Quickstart (Desktop Edition)

### 1. Prerequisites (Fedora / Debian / Arch)

- **Fedora**: `sudo dnf install gtk3-devel webkit2gtk4.1-devel libayatana-appindicator-gtk3-devel librsvg2-devel`
- **Debian/Ubuntu**: `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`
- **Arch Linux**: `sudo pacman -S webkit2gtk-4.1 gtk3 libayatana-appindicator`

### 2. Running in Desktop Dev Mode

```bash
# Start Vite frontend + Rust Tauri backend with hot-reload:
pnpm desktop:dev
```

### 3. Building Production Linux Packages (.deb, .rpm, .AppImage)

```bash
pnpm desktop:build
```
The compiled Linux bundles will be generated in `src-tauri/target/release/bundle/`.

