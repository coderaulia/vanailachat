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

**Self-Hosted AI Workspace for Local and Cloud Models**

[![Open Source](https://img.shields.io/badge/Open%20Source-100%25%20Free-brightgreen?style=for-the-badge)](https://github.com/coderaulia/vanailachat)
[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20macOS%20%7C%20Windows-blue?style=for-the-badge)](https://github.com/coderaulia/vanailachat)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green?style=for-the-badge)](https://nodejs.org)
[![Local AI](https://img.shields.io/badge/Ollama-Local%20%26%20Private-purple?style=for-the-badge)](https://ollama.com)
[![Community](https://img.shields.io/badge/Community-Indonesian%20AI%20Community%20🇮🇩-red?style=for-the-badge)](https://github.com/coderaulia/vanailachat)

### 🇮🇩 *Made with love from Jakarta for Indonesian AI community!*

*An open-source, privacy-first AI platform that empowers everyone — from beginners to senior developers — to run, chat, research, write code, and build with AI locally or through cloud APIs.*

</div>

---

## 🌟 What is VanailaChat?

**VanailaChat** brings the power of ChatGPT, Claude, and GitHub Copilot directly into your local machine and web browser with **complete privacy, control, and developer tooling**:

- 🏠 **100% Free & Offline-Ready**: Connect to free local AI models via [Ollama](https://ollama.com/) (Llama 3.2, DeepSeek-R1, Mistral, Qwen, Phi-4) with zero subscription fees.
- ☁️ **Universal Cloud AI Support**: Plug in your API keys for OpenAI, OpenRouter, 9Router, DeepSeek, Anthropic, or any custom OpenAI-compatible server.
- 💻 **Live Coding Workspace**: Edit and create project files with live diff reviews, run terminal commands, and use Auto-Approve mode powered by Claude Code & Free Claude Code (FCC).
- ⚡ **Live Codebase Activity Panel**: Dedicated right drawer to inspect touched files, view line-by-line diffs, watch command feeds, and respond to tool approvals inline.
- 🌿 **Git Branch Status & Safety Creator**: Real-time branch monitoring in the workspace bar with warning badges on production branches and 1-click safety branch creation.
- 📁 **Automated Workspace Organization**: Selecting a workspace folder automatically groups chats into dedicated project workspaces to keep your chat history tidy.
- 🧩 **Agent Skills Integration**: Seamlessly inject custom and active Agent Skills into coding sessions.
- 📊 **Real-time Context Usage Tracking**: Accurate live token meters showing prompt and completion token usage across local and cloud models.
- 🧠 **Persistent Long-Term Memory**: Automatically remembers your coding style, preferences, and project background across all chat sessions.
- 📑 **Document Analysis & Generation**: Upload PDFs, DOCX, XLSX, and text files. Extract data locally and export formatted `.docx` Word documents.
- 🔍 **Deep Web Research**: Search the live web, fetch articles, and generate cited summaries.

---

## 🚀 1-Click Automated Quick Start

No complicated setup or terminal commands required. The automated launcher checks your system, installs missing dependencies, creates your environment file, starts the services, and opens your browser.

### 🐧 Linux (Debian, Ubuntu, Fedora, Arch Linux, openSUSE, etc.)

Open your terminal and run:

```bash
git clone https://github.com/coderaulia/vanailachat.git
cd vanailachat
./start.sh
```

> **💡 Create Desktop Shortcut**: Run `./start.sh --desktop` to create an icon in your application launcher menu and Desktop.

---

### 🍎 macOS (Apple Silicon M1/M2/M3/M4 & Intel)

1. Open **Terminal** (`Cmd + Space` → type `Terminal` → press `Enter`).
2. Run:

```bash
git clone https://github.com/coderaulia/vanailachat.git
cd vanailachat
./start.sh
```

**What `./start.sh` does automatically on Mac:**
- Detects Homebrew and installs Node.js 20+ if not installed.
- Prepares `pnpm` and installs all project packages.
- Starts local Ollama (if installed) in the background.
- Automatically opens your default browser at `http://localhost:5173`.

> **💡 Create Desktop Launcher on Mac**: Run `./start.sh --desktop` to place a double-clickable `VanailaChat.command` icon directly on your Mac Desktop.

---

### 🪟 Windows (10 / 11)

1. Clone or download the repository:
   ```cmd
   git clone https://github.com/coderaulia/vanailachat.git
   ```
2. Open the `vanailachat` folder in **File Explorer**.
3. **Double-click `start.bat`** *(or right-click `start.ps1` → Run with PowerShell)*.

> **💡 Create Desktop Shortcut on Windows**: Run `start.bat --shortcut` to create a `VanailaChat` shortcut on your Windows Desktop.

---

## 📖 Manual Setup (for Developers)

If you prefer to run commands manually from your terminal:

```bash
# 1. Clone the repository
git clone https://github.com/coderaulia/vanailachat.git
cd vanailachat

# 2. Install dependencies (Node 20+ required)
pnpm install

# 3. Initialize environment variables
cp .env.example .env

# 4. Start frontend and backend
pnpm dev
```

Open `http://localhost:5173` in your browser.

### Optional: Setting up Free Local Models with Ollama

To run AI 100% locally on your device without internet or API keys:

1. Download & install [Ollama](https://ollama.com/).
2. Pull your desired models:
   ```bash
   ollama pull llama3.2          # Fast, general chat & reasoning
   ollama pull deepseek-r1:7b    # Coding and deep logic
   ollama pull nomic-embed-text  # Enables semantic long-term memory
   ```

---

## 🔌 Supported Providers & Setup

You can configure provider keys directly inside the UI in **Settings (⚙️) → AI Connection** or via `.env`:

| Provider | Description | Recommended For |
| :--- | :--- | :--- |
| **Ollama** | 100% local, private, no internet needed | Daily chat, privacy, offline work |
| **OpenRouter** | 200+ models (Claude 3.5, GPT-4o, DeepSeek, Gemini) | Wide variety, low cost, pay-as-you-go |
| **OpenAI** | Official GPT-4o, o1, o3-mini | Enterprise and standard OpenAI accounts |
| **9Router** | Multi-model routing engine | Developer flexibility |
| **Custom API** | Any OpenAI-compatible endpoint (vLLM, LM Studio, LocalAI) | Self-hosted servers & custom rigs |
| **Claude Code (FCC)** | Powered by Free Claude Code integration | Live coding, file edits, bash terminal |

---

## 🛠️ Key Features Walkthrough

### 1. ⚡ Live Coding Workspace & Auto-Approve Mode
- Select **Coding** mode in the chat composer to give the model access to your local workspace.
- The model can read, write, edit files, and execute terminal commands.
- **Rich Approval Dialog & Live Side Panel**: Inspect full commands, target files, and side-by-side diff previews before anything touches your disk.
- **Auto-Approve Toggle**: Switch on `⚡ Auto-Approve` from the chat header or popup to let coding tasks run continuously without manual confirmation.

### 2. 🌿 Git Branch Protection & Safety Creation
- Live working branch display in the workspace bar (`🌿 feat/new-feature (2 modified)`).
- Warning indicator when operating directly on `main` or `master` with an instant **`+ Create Branch`** button to safely isolate AI edits.

### 3. 📁 Workspace Auto-Project Organization
- Selecting or typing a workspace folder automatically organizes your chats into a dedicated project named after the folder, keeping your general chat history clean and organized.

### 4. 🧠 Persistent Long-Term Memory
- Automatically indexes past conversations using vector embeddings (via `nomic-embed-text`) or keyword search.
- When you ask a question or start a coding task, relevant historical context and your past preferences are automatically recalled.

### 5. 📄 Local Document Reader & Word Generator
- Drag-and-drop PDF, DOCX, XLSX, and text files into the chat composer. Content is processed locally on your machine.
- Generate downloadable formatted `.docx` Word documents directly from AI conversations.

---

## ⌨️ CLI Developer Scripts

```bash
pnpm dev           # Start both backend and frontend development servers
pnpm dev:backend   # Start backend only
pnpm dev:frontend  # Start frontend Vite server only
pnpm build         # Build production bundle
pnpm test          # Run full Vitest test suite (234 tests)
pnpm type-check    # Run TypeScript validation
pnpm lint          # Run ESLint validation
pnpm backup        # Backup SQLite database to backups/
```

---

## 🤝 Open Source & Community Contribution

VanailaChat is an **open-source project built for the global community, with special love for the Indonesian AI & developer ecosystem**.

Everyone is welcome to contribute! You can:
- 💡 **Suggest Ideas & Features**: Open an issue or join discussions.
- 🐛 **Report Bugs**: Help us test and refine on different operating systems and hardware.
- 💻 **Submit Pull Requests**: Add new provider adapters, UI enhancements, or performance improvements.
- 🌐 **Localization & Docs**: Help improve documentation and guides.

To get in touch or collaborate, connect via GitHub or email [care@vanaila.com](mailto:care@vanaila.com).

---

## 📜 License & Credits

- **Free Claude Code (FCC)** integration powered by [@alishahryar1](https://github.com/alishahryar1/free-claude-code) (MIT License).
- Built with ❤️ using React 19, TypeScript, Hono, Vite, and SQLite.

<div align="center">

**[⭐ Star this project on GitHub](https://github.com/coderaulia/vanailachat)** • **Made with ❤️ from Jakarta for Indonesian AI community! 🇮🇩**

</div>
