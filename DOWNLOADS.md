# 📦 Vanaila Chat — Download & Distribution Guide

<div align="center">

[![GitHub Release](https://img.shields.io/github/v/release/coderaulia/vanailachat?style=for-the-badge&color=blue)](https://github.com/coderaulia/vanailachat/releases/latest)
[![Platform Linux](https://img.shields.io/badge/Platform-Linux%20(.deb%20%7C%20.rpm%20%7C%20AppImage)-orange?style=for-the-badge)](https://github.com/coderaulia/vanailachat/releases/latest)
[![Platform Cross](https://img.shields.io/badge/Web%20Launcher-Linux%20%7C%20macOS%20%7C%20Windows-brightgreen?style=for-the-badge)](https://github.com/coderaulia/vanailachat)

</div>

Welcome to the official download and installation guide for **Vanaila Chat**. Choose your preferred installation method below.

---

## 🚀 Quick Download Links (Latest Release: v0.3.0)

All standalone native Linux desktop installers and standalone bundles are hosted on our official [GitHub Releases Page](https://github.com/coderaulia/vanailachat/releases/latest).

| Distro / Platform | Package Format | Direct Download / Install | Recommended For |
| :--- | :--- | :--- | :--- |
| **Ubuntu / Debian / Mint / Pop!_OS** | `.deb` (x86_64) | [Download `.deb`](https://github.com/coderaulia/vanailachat/releases/latest) | Debian-based distributions with `apt` / `dpkg` |
| **Fedora / RHEL / openSUSE** | `.rpm` (x86_64) | [Download `.rpm`](https://github.com/coderaulia/vanailachat/releases/latest) | Red Hat / Fedora-based systems with `dnf` / `rpm` |
| **Universal Linux (Any Distro)** | `.AppImage` (x86_64) | [Download `.AppImage`](https://github.com/coderaulia/vanailachat/releases/latest) | Zero-install, portable single binary |
| **Arch Linux / Manjaro** | AUR (`PKGBUILD`) | `yay -S vanaila-chat-bin` | Arch User Repository |
| **Universal Flatpak** | Flathub (`.yml`) | `packaging/com.vanaila.chat.yml` | Sandboxed multi-distro deployment |
| **1-Click Web App (Cross-Platform)** | Shell / Batch | `start.sh` / `start.bat` | Linux, macOS, Windows (Browser UI) |

---

## 🐧 Linux Desktop Installation Instructions

### 1. Debian, Ubuntu, Linux Mint, Pop!_OS (`.deb`)

1. Download `vanaila-chat_0.3.0_amd64.deb` from [Releases](https://github.com/coderaulia/vanailachat/releases/latest).
2. Open your terminal in your download folder and install via `apt`:
   ```bash
   sudo apt update
   sudo apt install ./vanaila-chat_0.3.0_amd64.deb
   ```
   *(Alternatively, using `dpkg`:)*
   ```bash
   sudo dpkg -i vanaila-chat_0.3.0_amd64.deb
   sudo apt-get install -f # resolve any missing dependencies
   ```
3. Launch **Vanaila Chat** from your desktop application menu or run `vanaila-chat` in your terminal.

---

### 2. Fedora, RHEL, openSUSE (`.rpm`)

1. Download `vanaila-chat-0.3.0-1.x86_64.rpm` from [Releases](https://github.com/coderaulia/vanailachat/releases/latest).
2. Install via `dnf`:
   ```bash
   sudo dnf install ./vanaila-chat-0.3.0-1.x86_64.rpm
   ```
3. Launch **Vanaila Chat** from your desktop app menu or run `vanaila-chat`.

---

### 3. Universal Linux Portable AppImage (No Installation Needed)

AppImage runs on virtually all Linux distributions without root permissions or system installation.

1. Download `Vanaila-Chat_0.3.0_amd64.AppImage` from [Releases](https://github.com/coderaulia/vanailachat/releases/latest).
2. Make the file executable and launch:
   ```bash
   chmod +x Vanaila-Chat_0.3.0_amd64.AppImage
   ./Vanaila-Chat_0.3.0_amd64.AppImage
   ```

> **💡 Tip (Desktop Integration for AppImage)**: You can use [Geary / AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher) to automatically integrate the AppImage into your system's application launcher.

---

### 4. Arch Linux & Manjaro (via AUR / PKGBUILD)

If you are using an AUR helper such as `yay` or `paru`:

```bash
yay -S vanaila-chat-bin
# or
paru -S vanaila-chat-bin
```

Or build manually from the included `PKGBUILD`:
```bash
git clone https://github.com/coderaulia/vanailachat.git
cd vanailachat/packaging
makepkg -si
```

---

## 🌐 1-Click Automated Web Launcher (Linux / macOS / Windows)

If you prefer running the full-featured self-hosted Web UI inside your browser:

### 🐧 Linux & 🍎 macOS
```bash
git clone https://github.com/coderaulia/vanailachat.git
cd vanailachat
./start.sh
```
> Add `--desktop` (`./start.sh --desktop`) to create a double-clickable desktop shortcut!

### 🪟 Windows (10 / 11)
```cmd
git clone https://github.com/coderaulia/vanailachat.git
cd vanailachat
start.bat
```
*(Or right click `start.ps1` → **Run with PowerShell**)*

---

## 🔒 Verifying Download Checksums (SHA-256)

To verify the integrity and authenticity of your downloaded files, compare the SHA-256 checksum against `SHA256SUMS.txt` available on the [Release Page](https://github.com/coderaulia/vanailachat/releases/latest):

```bash
# On Linux / macOS
sha256sum -c SHA256SUMS.txt --ignore-missing

# Or calculate manually:
sha256sum vanaila-chat_0.3.0_amd64.deb
```

---

## 🛠️ System Requirements

### Linux Native Desktop App
- **OS**: Ubuntu 20.04+, Debian 11+, Fedora 36+, Arch Linux, openSUSE Tumbleweed / Leap 15.4+, or equivalent.
- **Display Server**: X11 or Wayland (Native Wayland supported).
- **Core Libraries**: `webkit2gtk-4.1`, `gtk3`, `libayatana-appindicator3` (automatically installed by `.deb` and `.rpm`).
- **RAM**: Minimum 2 GB RAM (4 GB+ recommended for heavy chat histories).

### Optional for Local AI Models (Ollama)
- **CPU**: Modern x86_64 or ARM64 processor (AVX2 supported).
- **GPU (Recommended for fast local inference)**:
  - NVIDIA GPU with CUDA compute capability 5.0+ (8 GB+ VRAM recommended).
  - AMD Radeon GPU with ROCm support.
  - Apple Silicon M1/M2/M3/M4 (unified memory).
