```text
  ██╗   ██╗ █████╗ ███╗   ██╗ █████╗ ██╗██╗      █████╗      ██████╗██╗  ██╗ █████╗ ████████╗
  ██║   ██║██╔══██╗████╗  ██║██╔══██╗██║██║     ██╔══██╗    ██╔════╝██║  ██║██╔══██╗╚══██╔══╝
  ██║   ██║███████║██╔██╗ ██║███████║██║██║     ███████║    ██║     ███████║███████║   ██║   
  ╚██╗ ██╔╝██╔══██║██║╚██╗██║██╔══██║██║██║     ██╔══██║    ██║     ██╔══██║██╔══██║   ██║   
   ╚████╔╝ ██║  ██║██║ ╚████║██║  ██║██║███████╗██║  ██║    ╚██████╗██║  ██║██║  ██║   ██║   
    ╚═══╝  ╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚═╝╚══════╝╚═╝  ╚═╝     ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   
```

<div align="center">

# VanailaChat

**Privacy-First AI Workspace & Native Desktop Client for Local and Cloud LLMs**

[![GitHub Release](https://img.shields.io/github/v/release/coderaulia/vanailachat?style=for-the-badge&color=blue)](https://github.com/coderaulia/vanailachat/releases/latest)
[![Linux Packages](https://img.shields.io/badge/Linux%20Packages-.deb%20%7C%20.rpm%20%7C%20AppImage-orange?style=for-the-badge)](DOWNLOADS.md)
[![Open Source](https://img.shields.io/badge/Open%20Source-100%25%20Free-brightgreen?style=for-the-badge)](https://github.com/coderaulia/vanailachat)
[![Local AI](https://img.shields.io/badge/Ollama-Local%20%26%20Private-purple?style=for-the-badge)](https://ollama.com)
[![Community](https://img.shields.io/badge/Community-Indonesian%20AI%20Community%20🇮🇩-red?style=for-the-badge)](https://github.com/coderaulia/vanailachat)

### 🇮🇩 *Made with love from Jakarta for Indonesian AI community!*

*An open-source, privacy-first AI workstation and native Linux desktop application that empowers everyone — from beginners to senior engineers — to chat, research, write code, manage workspaces, and build with AI locally or via cloud APIs.*

</div>

---

## 📦 Downloads & Distribution

Get started in seconds! Download the native Linux desktop installer for your distribution or launch the automated cross-platform web edition.

👉 **[View Full Download & Distribution Guide (DOWNLOADS.md)](DOWNLOADS.md)**

| Distro / Platform | Package Format | Direct Download Link | Quick Installation |
| :--- | :--- | :--- | :--- |
| **Ubuntu / Debian / Mint / Pop!_OS** | `.deb` (x86_64) | [**Download `.deb`**](https://github.com/coderaulia/vanailachat/releases/latest) | `sudo apt install ./vanaila-chat_0.3.0_amd64.deb` |
| **Fedora / RHEL / openSUSE** | `.rpm` (x86_64) | [**Download `.rpm`**](https://github.com/coderaulia/vanailachat/releases/latest) | `sudo dnf install ./vanaila-chat-0.3.0-1.x86_64.rpm` |
| **Universal Linux (Any Distro)** | `.AppImage` | [**Download `.AppImage`**](https://github.com/coderaulia/vanailachat/releases/latest) | `chmod +x *.AppImage && ./*.AppImage` |
| **Arch Linux / Manjaro** | AUR | [**AUR Package**](DOWNLOADS.md) | `yay -S vanaila-chat-bin` |
| **1-Click Web App (Linux/Mac/Win)** | Script | `start.sh` / `start.bat` | `./start.sh` (Linux/macOS) or `start.bat` (Win) |

---

## 🌟 What is VanailaChat?

**VanailaChat** brings the power of ChatGPT, Claude, and GitHub Copilot directly into your local machine and web browser with **complete privacy, local control, and developer tooling**:

- 🏠 **100% Free & Offline-Ready**: Connect to free local AI models via [Ollama](https://ollama.com/) (Llama 3.2, DeepSeek-R1, Qwen 2.5, Mistral, Phi-4) with zero subscription fees.
- 🆓 **Zero-Cost Cloud Models**: Free-tier cloud LLMs through OpenRouter Free Models (Gemini Flash, DeepSeek-R1 Free, Llama 3.3 70B Free) and Free Claude Code (FCC).
- ☁️ **Universal Cloud AI Support**: Plug in your API keys for OpenAI (GPT-4o, o1, o3-mini), 9Router, Anthropic Claude, DeepSeek, or any custom OpenAI-compatible server.
- 💻 **Live Coding Workspace Engines**: Swappable autonomous coding engines with live diff reviews, terminal execution, and Auto-Approve mode powered by **Claude Code** (via [Free Claude Code](https://github.com/alishahryar1/free-claude-code)) and **DeepSeek Harness** ([deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness.git)), selectable directly in Settings.
- ⚡ **Live Codebase Activity Panel**: Dedicated right drawer to inspect touched files, view line-by-line diffs, watch command feeds, and respond to tool approvals inline.
- 🌿 **Git Branch Status & Safety Creator**: Real-time branch monitoring in the workspace bar with warning badges on production branches and 1-click safety branch creation.
- 📁 **Automated Workspace Organization**: Selecting a workspace folder automatically groups chats into dedicated project workspaces to keep your chat history tidy.
- 🎨 **Custom Color Schemes & Dark Mode**: Personalize the entire interface with built-in theme schemes including **Vanaila Origin** and **Catppuccin** palettes (Teal, Rose, Blue, Green, Peach) in both light and dark modes.
- 🧩 **Agent Skills Integration**: Seamlessly inject custom and active Agent Skills into coding sessions.
- 📊 **Real-time Context Usage Tracking**: Accurate live token meters showing prompt and completion token usage across local and cloud models.
- 🧠 **Persistent Long-Term Memory**: Automatically remembers your coding style, preferences, and project background across all chat sessions.
- 📑 **Document Analysis & Generation**: Upload PDFs, DOCX, XLSX, and text files. Extract data locally and export formatted `.docx` Word documents.
- 🔍 **Deep Web Research**: Search the live web, fetch articles, and generate cited summaries.

---

## 🔌 Comprehensive AI Providers & Setup Guide

VanailaChat supports both **100% offline local AI** and **cloud LLM providers**. You can configure your keys directly in **Settings (⚙️) → AI Connection** or via the `.env` file.

### 1. 🏠 Ollama (100% Free, Private & Offline Local AI)

Ollama allows you to run state-of-the-art open-source LLMs directly on your own hardware without internet or API keys.

#### Step 1: Install Ollama
- **Linux**:
  ```bash
  curl -fsSL https://ollama.com/install.sh | sh
  ```
- **macOS**: Download from [ollama.com/download](https://ollama.com/download) or `brew install ollama`.
- **Windows**: Download the official installer from [ollama.com/download](https://ollama.com/download).

#### Step 2: Pull Recommended Models
Run these commands in your terminal to download models:

```bash
# 💬 General Chat & Fast Reasoning (Recommended for everyday use)
ollama pull llama3.2          # 3B parameters - lightweight & blazing fast
ollama pull qwen2.5:7b        # 7B parameters - excellent general intelligence

# 💻 Coding & Deep Logic (For Coding Workspace)
ollama pull qwen2.5-coder:7b  # High accuracy code generation & debugging
ollama pull deepseek-r1:7b    # Reasoning & step-by-step logic chain

# 🧠 Semantic Long-Term Memory (RAG Vector Embeddings)
ollama pull nomic-embed-text  # 768-dim embeddings for memory recall
```

#### Step 3: Verify Ollama Service
Ensure Ollama is running at `http://localhost:11434`:
```bash
# Verify running models
ollama list

# Linux systemd auto-start (optional)
sudo systemctl enable --now ollama
```
VanailaChat will automatically detect all installed Ollama models in the model selector!

---

### 2. 🆓 Free Cloud AI Models (Zero-Cost Setup)

Want high-end cloud models without paying for subscriptions? You can use free cloud tiers:

#### A. OpenRouter Free Tier
[OpenRouter](https://openrouter.ai/) provides completely free access to leading models with zero credit card required.

1. Go to [OpenRouter.ai](https://openrouter.ai/) and create a free account.
2. Navigate to **Keys** and click **Create Key**.
3. In VanailaChat, open **Settings (⚙️) → AI Connection**:
   - Paste your API key into **OpenRouter API Key**.
4. In the Model Selector dropdown, you can now use all free models (marked with `:free`), including:
   - `google/gemini-2.0-flash-exp:free` (Super fast & smart)
   - `meta-llama/llama-3.3-70b-instruct:free` (70B powerhouse)
   - `deepseek/deepseek-r1:free` (Full DeepSeek reasoning)
   - `qwen/qwen-2.5-72b-instruct:free` (Coding & math)

#### B. Free Claude Code (FCC) Integration
VanailaChat includes native integration with [Free Claude Code](https://github.com/alishahryar1/free-claude-code). Select **Claude Code (FCC)** as your engine in **Settings (⚙️) → Coding Engine** to run autonomous coding workflows.

---

### 3. 🔀 9Router Setup

[9Router](https://github.com/) is a high-speed multi-model router and proxy compatible with OpenAI endpoints.

1. Start your 9Router instance (defaults to `http://localhost:20128/v1`).
2. In VanailaChat, open **Settings (⚙️) → AI Connection**:
   - **9Router Base URL**: `http://localhost:20128/v1` (or your custom server URL)
   - **9Router API Key**: Enter your 9Router access token.
3. Alternatively, define them in your `.env` file:
   ```env
   NINE_ROUTER_BASE_URL=http://localhost:20128/v1
   NINE_ROUTER_API_KEY=your_token_here
   ```

---

### 4. 🤖 OpenAI Setup (Official)

Connect directly to official OpenAI GPT models:

1. Obtain your API key from [platform.openai.com/api-keys](https://platform.openai.com/api-keys).
2. In VanailaChat **Settings (⚙️)**, enter your key in **OpenAI API Key**.
3. Supported models include **GPT-4o**, **GPT-4o-mini**, **o1**, **o3-mini**, and **GPT-4-turbo**.
4. Alternatively, configure in `.env`:
   ```env
   OPENAI_API_KEY=sk-...
   OPENAI_BASE_URL=https://api.openai.com/v1
   ```

---

### 5. 🛠️ Custom OpenAI-Compatible Endpoints

VanailaChat can connect to **any server or cloud provider** that implements the OpenAI standard API format (`/v1/chat/completions` and `/v1/models`):

| Server / Provider | Typical Base URL | Notes |
| :--- | :--- | :--- |
| **LM Studio** | `http://localhost:1234/v1` | Enable local server in LM Studio app |
| **vLLM** | `http://localhost:8000/v1` | Production GPU server |
| **LocalAI** | `http://localhost:8080/v1` | Self-hosted OpenAI drop-in replacement |
| **Groq Cloud** | `https://api.groq.com/openai/v1` | Ultra-fast LPU inference (requires Groq key) |
| **DeepSeek Official API** | `https://api.deepseek.com/v1` | DeepSeek-V3 and DeepSeek-R1 direct API |
| **Together AI** | `https://api.together.xyz/v1` | Pay-as-you-go open-source cloud |

#### How to configure:
1. Open **Settings (⚙️) → AI Connection**.
2. Set **Custom OpenAI Base URL** (e.g. `http://localhost:1234/v1` or `https://api.groq.com/openai/v1`).
3. Set **Custom OpenAI API Key** (enter `not-needed` for local LM Studio / vLLM, or your actual provider key).

---

## 🚀 1-Click Automated Quick Start (Web Edition)

The automated launcher checks your environment, installs missing dependencies, creates your config file, and opens your browser.

### 🐧 Linux (Debian, Ubuntu, Fedora, Arch, openSUSE)
```bash
git clone https://github.com/coderaulia/vanailachat.git
cd vanailachat
./start.sh
```
> **💡 Desktop Shortcut**: Run `./start.sh --desktop` to create an application launcher icon and Desktop shortcut.

### 🍎 macOS (Apple Silicon M1/M2/M3/M4 & Intel)
```bash
git clone https://github.com/coderaulia/vanailachat.git
cd vanailachat
./start.sh
```

### 🪟 Windows (10 / 11)
```cmd
git clone https://github.com/coderaulia/vanailachat.git
cd vanailachat
start.bat
```
*(Or right-click `start.ps1` → **Run with PowerShell**)*

---

## 📖 Manual Developer Setup

```bash
# 1. Clone the repository
git clone https://github.com/coderaulia/vanailachat.git
cd vanailachat

# 2. Install dependencies (Node 20+ / 22+ recommended)
pnpm install

# 3. Initialize environment variables
cp .env.example .env

# 4. Start frontend and backend in development mode
pnpm dev

# 5. (Optional) Run the native Linux Desktop app in dev mode
pnpm desktop:dev
```

Open `http://localhost:5173` in your browser.

---

## ⌨️ CLI Developer & Packaging Commands

```bash
pnpm dev            # Start backend and frontend development servers
pnpm dev:backend    # Start backend only
pnpm dev:frontend   # Start frontend Vite server only
pnpm build          # Build production web bundle
pnpm test           # Run full Vitest test suite (240 tests)
pnpm type-check     # Run TypeScript type validation
pnpm lint           # Run ESLint validation (--max-warnings=0)
pnpm desktop:dev    # Launch native Tauri 2.0 Linux desktop client
pnpm desktop:build  # Compile .deb, .rpm, and .AppImage Linux bundles
pnpm backup         # Backup SQLite database to backups/
```

---

## 🤝 Open Source & Community Contribution

VanailaChat is an **open-source project built for the global community, with special love for the Indonesian AI & developer ecosystem**.

Everyone is welcome to contribute! You can:
- 💡 **Suggest Ideas & Features**: Open an issue or join discussions.
- 🐛 **Report Bugs**: Help us test on different Linux distributions and GPU configurations.
- 💻 **Submit Pull Requests**: Add new provider adapters, UI enhancements, or performance improvements.
- 🌐 **Documentation**: Help translate and improve guides.

To get in touch or collaborate, connect via GitHub or email [care@vanaila.com](mailto:care@vanaila.com).

---

## 📜 License & Credits

- **Free Claude Code (FCC)** integration powered by [@alishahryar1](https://github.com/alishahryar1/free-claude-code) (MIT License).
- **DeepSeek Harness** integration powered by [DeepSeek AI](https://github.com/deepseek-ai/deepseek-harness.git) (MIT License).
- Built with ❤️ using Tauri 2.0, Rust, React 19, TypeScript, Hono, Vite, and SQLite.

<div align="center">

**[⭐ Star this project on GitHub](https://github.com/coderaulia/vanailachat)** • **Made with ❤️ from Jakarta for Indonesian AI community! 🇮🇩**

</div>
