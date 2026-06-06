# VanailaChat

A modern, production-grade local AI chat interface built with **React 19**, **Hono**, and **SQLite**. Supports local models via Ollama and cloud providers (OpenAI, OpenRouter) — all from a single self-hosted UI with a premium glassmorphic design.

---

## Features

### 🧠 AI & Multi-Provider
- **Ollama** (local) — auto-starts the daemon, lists installed models
- **OpenAI** — GPT-4o, GPT-4, o1, etc. via API key
- **OpenRouter** — 100+ models (Claude, Gemini, Mixtral, Llama…) via API key
- **Provider badges** — model picker shows which provider each model is from
- **LLM Provider Abstraction** — unified `LLMProvider` interface; swap backends without touching chat logic

### 🤖 Assistant Personas
| Persona | Icon | Best For |
|---------|------|----------|
| General | 🤖 | Everyday tasks, questions, writing |
| Coder | 💻 | Code gen, debugging, architecture, refactoring |
| Creator | ✨ | Social media content, blog posts, content calendars, marketing copy |

Each persona injects a specialized system prompt and restricts the tool set accordingly.

### 🛠 Agentic Tool System
- **Agent loop** — iterative tool execution mid-stream with deduplication and max-iteration cap
- **Web Search** (`search_web`) — DuckDuckGo integration, toggle per-session
- **Read URL** (`read_url`) — fetch and extract text from any web page
- **Read File** (`read_file`) — read local project files, path-traversal safe
- **List Directory** (`list_directory`) — browse project trees up to configurable depth
- **Run Command** (`run_command`) — sandboxed shell commands (git log/status, npm test/lint)
- All tools: 30s timeout, dedup, rich `tool_event` stream events to frontend

### 🔬 Deep Research Pipeline
POST `/api/research` streams a multi-stage research workflow:
1. **Search** — DuckDuckGo search for your query
2. **Read** — Fetches and extracts text from each result page
3. **Synthesize** — LLM writes a structured report with citations [1], [2]…

Supports `depth`: `quick` / `standard` / `deep` and configurable source count.

### 🧬 Semantic Memory
- **Vector memory** — embeddings via Ollama `nomic-embed-text`, stored in SQLite
- **Auto-injection** — relevant memories injected into every system prompt automatically
- **API** — `/api/memory` for search, store, delete, and index past chats

### 📁 Projects & Workspaces
- **Multi-project** — organize chats into named projects with custom instructions and shared memory
- **Project root** — bind a filesystem path for Coder mode (auto-lists directory structure)
- **System prompt** — per-chat popover, saved to SQLite and restored on reload
- **Skills** — reusable prompt templates and tool sequences

### 💬 Conversation
- **Streaming** — NDJSON token-by-token rendering with typing cursor
- **Abort** — cancel any generation; previous prompt auto-restored
- **Copy** — copies raw Markdown source (not rendered HTML)
- **Token badges** — toggle per-message prompt/completion counts
- **Multi-modal** — attach images (base64 to vision models) and text files

### 🎨 UI & UX
- **Glassmorphic design** — layered blur surfaces, gradient accents, micro-animations
- **Dark/Light mode** — full theme toggle persisted across sessions
- **Mobile responsive** — slide-out sidebar (≤860px overlay), stacked composer, full-width dropdowns
- **First-run onboarding** — guided wizard for LLM setup, profile, and base instructions
- **Keyboard shortcuts**:

  | Shortcut | Action |
  |----------|--------|
  | `Ctrl+N` | New chat |
  | `Ctrl+/` | Toggle sidebar |
  | `Ctrl+Shift+S` | Toggle web search |
  | `Escape` | Abort generation |

### 🗄 Backend & Data
- **Rate limiting** — 20 req/min on `/api/chat`, 60 req/min on `/api/models`
- **Versioned migrations** — SQLite schema via `schema_migrations` (v1–v6), safe upgrades from any state
- **Export/Import** — full workspace backup and restore as JSON
- **Settings API** — `/api/settings` key-value store for user preferences and onboarding state

---

## Architecture

| Layer | Technology |
|-------|------------|
| Frontend | React 19, Vite, TypeScript, Vanilla CSS |
| Backend | Hono (Node.js), TypeScript |
| Database | SQLite (`better-sqlite3`), 6 versioned migrations |
| Local AI | Ollama daemon (auto-started) |
| Cloud AI | OpenAI-compatible API (OpenAI, OpenRouter) |
| Search | DuckDuckGo (`duck-duck-scrape`) |
| Embeddings | Ollama `nomic-embed-text` (768-dim, cosine similarity) |

<details>
<summary>Directory structure</summary>

```
src/
├── backend/
│   ├── app.ts                    # createApp() — middleware + routes
│   ├── index.ts                  # Server entry, dynamic port, .port file
│   ├── middleware/
│   │   └── rateLimiter.ts        # Sliding-window rate limiter
│   ├── routes/
│   │   ├── chat.ts               # POST /api/chat — agent loop + tool execution
│   │   ├── research.ts           # POST /api/research — deep research pipeline
│   │   ├── memory.ts             # /api/memory — vector memory CRUD + search
│   │   ├── personas.ts           # /api/personas — list + get personas
│   │   ├── settings.ts           # /api/settings — key-value settings store
│   │   ├── skills.ts             # /api/skills — reusable prompt templates
│   │   ├── models.ts             # /api/models — multi-provider model list
│   │   ├── projects.ts           # /api/projects CRUD
│   │   ├── chats.ts              # /api/chats CRUD
│   │   ├── messages.ts           # /api/messages
│   │   └── data.ts               # /api/export, /api/import, /api/pick-directory
│   └── services/
│       ├── provider.ts           # LLMProvider interface + types
│       ├── ollamaProvider.ts     # Ollama implementation
│       ├── openaiProvider.ts     # OpenAI-compatible implementation
│       ├── providerRegistry.ts   # Provider routing by model prefix
│       ├── streamAdapter.ts      # OpenAI SSE → Ollama NDJSON converter
│       ├── embedding.ts          # EmbeddingService (nomic-embed-text)
│       ├── personas.ts           # Persona definitions + system prompts
│       ├── tools.ts              # Tool registry + execution (4 built-in + read_url)
│       ├── toolInterface.ts      # Tool / ToolSchema interfaces
│       ├── database.ts           # SQLite + all table CRUD
│       ├── migrations.ts         # Schema migrations v1–v6
│       └── ollama.ts             # Ollama daemon management
└── frontend/
    ├── App.tsx                   # Shell + onboarding wizard mount
    ├── context/ChatContext.tsx   # Single React Context
    ├── components/
    │   ├── OnboardingWizard      # First-run setup wizard
    │   ├── Sidebar               # Chat history, projects, skills
    │   ├── ChatHeader            # Model info, thinking timer, tokens
    │   ├── ChatLog               # Message renderer + tool events
    │   ├── Composer              # Input, persona selector, model selector
    │   ├── ModelSelector         # Provider-grouped model dropdown
    │   └── ProjectDetail         # Project settings panel
    └── hooks/
        ├── useChatApp.ts         # Root hook — assembles all sub-hooks
        ├── useChatSession.ts     # Streaming, abort, send, conversation state
        ├── useModelManager.ts    # Model list + provider data
        ├── usePersistence.ts     # API calls to SQLite backend
        ├── useUIState.ts         # Sidebar, theme, status
        └── useKeyboardShortcuts.ts
```
</details>

---

## Setup

### Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | ≥ 18 | [nodejs.org](https://nodejs.org) |
| npm | ≥ 9 | Included with Node.js |
| Ollama | latest | [ollama.com](https://ollama.com) — for local models |

> **Cloud-only users**: If you only use OpenAI or OpenRouter, Ollama is optional. The app will start without it.

---

### 🐧 Linux

```bash
# 1. Install Node.js (if not installed)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# 3. Pull a model (e.g. llama3.2)
ollama pull llama3.2

# 4. Clone and install
git clone https://github.com/your-org/vanaila-chat.git
cd vanaila-chat
npm install

# 5. (Optional) Set cloud API keys
export OPENAI_API_KEY=sk-...           # OpenAI
# OR for OpenRouter:
export OPENAI_API_KEY=sk-or-...
export OPENAI_BASE_URL=https://openrouter.ai/api/v1

# 6. Start
npm run dev
# → Frontend: http://localhost:5173
# → Backend:  random ephemeral port (written to .port)
```

**Optional: For semantic memory** (requires `nomic-embed-text`):
```bash
ollama pull nomic-embed-text
```

**Optional: For the folder picker dialog** (Coder mode):
```bash
# GNOME / GTK:
sudo apt install zenity
# KDE:
sudo apt install kdialog
```

---

### 🍎 macOS

```bash
# 1. Install Node.js via Homebrew
brew install node

# 2. Install Ollama
# Download from https://ollama.com/download/mac
# Or via Homebrew:
brew install ollama

# 3. Start Ollama (first time)
ollama serve &
ollama pull llama3.2

# 4. Clone and install
git clone https://github.com/your-org/vanaila-chat.git
cd vanaila-chat
npm install

# 5. (Optional) Set cloud API keys
export OPENAI_API_KEY=sk-...

# 6. Start
npm run dev
# → Frontend: http://localhost:5173
```

> **Note**: macOS has a native folder picker. The `/api/pick-directory` endpoint works automatically without extra dependencies.

---

### 🪟 Windows

#### Option A — WSL2 (Recommended)

Running inside WSL2 gives the best compatibility.

```powershell
# In PowerShell (admin) — enable WSL2
wsl --install
# Restart, then open Ubuntu terminal

# Inside WSL2 Ubuntu:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.2
git clone https://github.com/your-org/vanaila-chat.git
cd vanaila-chat
npm install
npm run dev
# → Open http://localhost:5173 in your Windows browser
```

#### Option B — Native Windows

1. **Install Node.js**
   - Download the LTS installer from [nodejs.org](https://nodejs.org/en/download)
   - Run the installer (includes npm)

2. **Install Ollama**
   - Download from [ollama.com/download/windows](https://ollama.com/download/windows)
   - Run the installer — Ollama runs as a system tray app

3. **Install Git** (if not installed)
   - Download from [git-scm.com](https://git-scm.com/download/win)

4. **Clone and run** (in PowerShell or Command Prompt):
   ```powershell
   git clone https://github.com/your-org/vanaila-chat.git
   cd vanaila-chat
   npm install

   # Optional: set cloud API keys
   $env:OPENAI_API_KEY = "sk-..."

   npm run dev
   ```

5. **Open** `http://localhost:5173` in your browser.

> **Note**: The folder picker (`/api/pick-directory`) uses `zenity`/`kdialog` which aren't available on Windows. You can still type the path manually in Coder mode.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | random (49152–65535) | Force a specific backend port |
| `OPENAI_API_KEY` | — | API key for OpenAI or OpenRouter |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Override for OpenRouter or other OpenAI-compatible APIs |

> You can also configure these in the **first-run onboarding wizard** — no env vars needed for basic use.

**OpenRouter example:**
```bash
export OPENAI_API_KEY=sk-or-v1-...
export OPENAI_BASE_URL=https://openrouter.ai/api/v1
```

---

## First-Run Onboarding

On first launch, a setup wizard guides you through:

1. **LLM Setup** — choose Ollama (local), OpenAI, or OpenRouter and enter credentials
2. **Profile** — optional name and role (personalizes AI responses)
3. **Memory & Instructions** — base instructions injected into every conversation
4. **Done** — tips on using personas, web search, and memory

Settings are saved to the SQLite `settings` table and cached in `localStorage`. To re-run the wizard, clear `localStorage` key `vanaila_onboarding_done` in browser DevTools.

---

## Using Cloud Models

Once your API key is configured (via onboarding or env var), cloud models appear in the model picker with a provider badge:

- **OpenAI models** — prefixed as `openai:gpt-4o`, `openai:o1`, etc.
- **OpenRouter models** — same prefix convention, routed to `openrouter.ai`

The provider registry automatically routes requests based on the model prefix.

---

## Deep Research

Trigger a multi-step research report from the `/api/research` endpoint or ask the AI to research a topic (with web search enabled):

```json
POST /api/research
{
  "query": "latest advances in fusion energy 2025",
  "model": "openai:gpt-4o",
  "maxSources": 5,
  "depth": "standard"
}
```

**Depth options:**
| Level | Chars/page | Best for |
|-------|-----------|---------|
| `quick` | 3,000 | Fast overview |
| `standard` | 6,000 | Balanced (default) |
| `deep` | 10,000 | Thorough analysis |

The endpoint streams NDJSON events: `searching → found → reading → synthesizing → chunk → done`.

---

## Scripts

```bash
npm run dev           # Start backend + frontend concurrently
npm run dev:backend   # Backend only (tsx watch, auto-reloads)
npm run dev:frontend  # Frontend only (Vite HMR)
npm run build         # Production build (tsc + vite build)
npm run test          # Vitest unit + integration tests
npm run type-check    # TypeScript validation (no emit)
npm run lint          # ESLint (zero warnings policy)
```

---

## Troubleshooting

**Ollama not connecting**
```bash
# Check if Ollama is running
ollama list
# Start manually if needed
ollama serve
```

**Port conflicts**
The backend picks a random ephemeral port automatically and writes it to `.port`. If Vite can't find the backend, restart both processes with `npm run dev`.

**`nomic-embed-text` not found (memory errors)**
```bash
ollama pull nomic-embed-text
```
Memory features degrade gracefully — chat still works without it.

**Models not appearing after adding API key**
Click the refresh button (↺) in the model picker, or restart the backend.

**Windows: folder picker not working**
Type the path manually in the "Project Root" field in Coder mode. The native picker requires `zenity`/`kdialog` (Linux/macOS only).

---

Made with ❤️ by **Vanaila** for the local AI community.
