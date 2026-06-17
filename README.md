# VanailaChat

A modern, production-grade local AI chat interface built with **React 19**, **Hono**, and **SQLite**. Supports local models via Ollama and cloud providers (OpenAI, OpenRouter, 9Router) — all from a single self-hosted UI with a premium glassmorphic design.

---

## Features

### 🧠 AI & Multi-Provider
- **Ollama** (local) — auto-starts the daemon, lists installed models
- **OpenAI** — GPT-4o, GPT-4, o1, etc. via API key
- **OpenRouter** — 100+ models (Claude, Gemini, Mixtral, Llama…) via API key
- **9Router** — OpenAI-compatible proxy routing to 40+ AI providers; configurable host + API key stored in settings DB
- **Provider badges** — model picker shows which provider each model is from
- **LLM Provider Abstraction** — unified `LLMProvider` interface; swap backends without touching chat logic
- **Fully injectable** — `ProviderRegistry` built fresh per `createApp()` call with injected `fetchFn`/`getBaseUrl`; enables clean unit tests without a live Ollama instance

### 🤖 Assistant Personas
| Persona | Icon | Best For |
|---------|------|----------|
| General | 🤖 | Everyday tasks, questions, writing |
| Coder | 💻 | Code gen, debugging, architecture, refactoring |
| Creator | ✨ | Social media content, blog posts, content calendars, marketing copy |

Each persona injects a specialized system prompt and restricts the tool set accordingly.

### 🛠 Agentic Tool System
- **Agent loop** — iterative tool execution mid-stream with deduplication and max-iteration cap (7)
- **Web Search** (`search_web`) — DuckDuckGo integration, toggle per-session
- **Read URL** (`read_url`) — fetch and extract text from any web page
- **Read File** (`read_file`) — read local project files, path-traversal safe
- **List Directory** (`list_directory`) — browse project trees up to configurable depth
- **Run Command** (`run_command`) — sandboxed shell commands (git log/status, npm test/lint)
- All tools: 30s timeout, dedup, rich `tool_event` stream events to frontend

### 🎓 Agent Skills
- **Skill catalog** — curated list from `anthropics/skills` GitHub repo (frontend-design, canvas-design, algorithmic-art, brand-guidelines, claude-api, skill-creator, and more)
- **Install/uninstall** — fetches `SKILL.md` from GitHub, parses YAML frontmatter, caches content in SQLite
- **Custom skills** — paste raw `SKILL.md` content to install any custom skill
- **Enable/disable** — toggle per skill without uninstalling
- **System prompt injection** — all enabled skills are injected as `[Skill: name]` blocks into every chat system prompt automatically
- **Sidebar panel** — manage installed skills from the left sidebar

### 🔬 Deep Research Pipeline
POST `/api/research` streams a multi-stage research workflow:
1. **Search** — DuckDuckGo search for your query
2. **Read** — Fetches and extracts text from each result page
3. **Synthesize** — LLM writes a structured report with citations [1], [2]…

Supports `depth`: `quick` / `standard` / `deep` and configurable source count.

### 🧬 Semantic Memory
- **Vector memory** — embeddings via Ollama `nomic-embed-text`, stored as BLOB (binary Float32Array) in SQLite — ~4× smaller and faster than JSON text
- **Search cap** — vector search scans latest 1,000 entries for consistent sub-ms latency
- **Auto-injection** — relevant memories injected into every system prompt automatically
- **LRU eviction** — memory table capped at 5,000 rows (configurable via `MEMORY_TABLE_CAP` env var); oldest entries pruned automatically on insert
- **Memories tab** — manage stored memories from the Settings modal
- **API** — `/api/memory` for search, store, delete, and index past chats

### 🔁 Self-Learning Harness
The app improves itself from your feedback in three phases:

**Phase 1 — Feedback capture**
- **Thumbs-up / thumbs-down** buttons on every assistant message
- Click 👍 to approve; optionally edit the message text before rating to train the corrected version
- Click again to clear; ratings stored in `message_feedback` table (SQLite migration v9)
- API: `GET /api/messages/:id/feedback`, `POST /api/messages/:id/feedback`

**Phase 2 — Decay-weighted RAG**
- Approved (+1) answers are auto-embedded and stored as `assistant_positive` memories
- RAG retrieval boosts +1 memories by **×1.15** and penalises −1 memories by **×0.5**
- Score formula: `cosine_similarity × decay(age, 30-day half-life) × feedback_weight`
- Effect is immediate — better answers surface after your first thumbs-up

**Phase 3 — LoRA fine-tune pipeline** (`scripts/finetune/`)
- **Settings → Training tab** — shows pair count, oldest/newest dates, format selector, export button
- **Export endpoint** — `POST /api/training/export` → `data/training/train-sharegpt-<stamp>.jsonl`
- **`train_lora.py`** — Unsloth-based LoRA trainer (4-bit, rank 16, auto-detects sharegpt/alpaca)
- **`build-modelfile.js`** — generates an Ollama `Modelfile` wiring your GGUF adapter to a base model
- **Full runbook** — see `scripts/finetune/README.md`

**End-to-end loop:**
```
👍 in chat UI → message_feedback → RAG boost (instant)
                                 → Export JSONL → train_lora.py → GGUF
                                                               → build-modelfile.js
                                                               → ollama create vanaila:v1
                                                               → appears in model picker
```

### 📁 Projects & Workspaces
- **Multi-project** — organize chats into named projects with custom instructions and shared memory
- **Project root** — bind a filesystem path for Coder mode (auto-lists directory structure)
- **System prompt** — per-chat popover, saved to SQLite and restored on reload

### 💬 Conversation
- **Streaming** — NDJSON token-by-token rendering with typing cursor
- **Abort** — cancel any generation; previous prompt auto-restored
- **Auto-title** — AI generates a short chat title in the background after the first reply
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
  | `Alt+S` | Toggle web search |
  | `Escape` | Abort generation |

### 🔒 Security
- **SSRF protection** — `read_url` tool resolves DNS and blocks all private/RFC1918/loopback/link-local/CGNAT/multicast IPs and GCP metadata endpoint; redirects blocked (`redirect: 'manual'`)
- **Symlink traversal protection** — `read_file` and `run_command` resolve paths via `fs.realpath` before allowing access, preventing escape from project root
- **Rate limiter hardening** — `trustProxy: false` default collapses all requests to a single anonymous bucket; no X-Forwarded-For spoofing possible in single-user mode

### 🗄 Backend & Data
- **Rate limiting** — 20 req/min on `/api/chat`, 60 req/min on `/api/models`, 10 req/min on research/skills-install, 60 req/min on memory
- **Versioned migrations** — SQLite schema via `schema_migrations` (v1–v9), safe upgrades from any state
- **Export/Import** — full workspace backup and restore as JSON
- **Settings API** — `/api/settings` key-value store for user preferences, API keys, and onboarding state
- **Training API** — `GET /api/training/stats`, `POST /api/training/export` (sharegpt or alpaca format)

---

## Architecture

| Layer | Technology |
|-------|------------|
| Frontend | React 19, Vite, TypeScript, Vanilla CSS |
| Backend | Hono (Node.js), TypeScript |
| Database | SQLite (`better-sqlite3`), 9 versioned migrations |
| Local AI | Ollama daemon (auto-started) |
| Cloud AI | OpenAI-compatible API (OpenAI, OpenRouter, 9Router) |
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
│   │   ├── chat.ts               # POST /api/chat — agent loop + tool execution + skill injection
│   │   ├── research.ts           # POST /api/research — deep research pipeline
│   │   ├── memory.ts             # /api/memory — vector memory CRUD + search
│   │   ├── personas.ts           # /api/personas — list + get personas
│   │   ├── settings.ts           # /api/settings — key-value settings store
│   │   ├── skills.ts             # /api/skills — catalog, install, enable/disable, custom
│   │   ├── models.ts             # /api/models — multi-provider model list
│   │   ├── projects.ts           # /api/projects CRUD
│   │   ├── chats.ts              # /api/chats CRUD
│   │   ├── messages.ts           # /api/messages + /api/messages/:id/feedback
│   │   ├── training.ts           # /api/training/stats, /api/training/export
│   │   └── data.ts               # /api/export, /api/import, /api/pick-directory
│   └── services/
│       ├── provider.ts           # LLMProvider interface + types
│       ├── ollamaProvider.ts     # Ollama implementation
│       ├── openaiProvider.ts     # OpenAI-compatible implementation
│       ├── nineRouterProvider.ts # 9Router implementation (40+ provider proxy)
│       ├── providerRegistry.ts   # Provider routing by model prefix
│       ├── streamAdapter.ts      # OpenAI SSE → Ollama NDJSON converter
│       ├── embedding.ts          # EmbeddingService (nomic-embed-text)
│       ├── personas.ts           # Persona definitions + system prompts
│       ├── tools.ts              # Tool registry + execution (5 built-in + search_web)
│       ├── toolInterface.ts      # Tool / ToolSchema interfaces
│       ├── database.ts           # SQLite + all table CRUD (incl. skills, memory BLOB, feedback)
│       ├── migrations.ts         # Schema migrations v1–v9 (v8: BLOB embeddings, v9: message_feedback)
│       └── ollama.ts             # Ollama daemon management
└── frontend/
    ├── App.tsx                   # Shell + onboarding wizard mount
    ├── context/ChatContext.tsx   # Single React Context
    ├── components/
    │   ├── OnboardingWizard      # First-run setup wizard
    │   ├── Sidebar               # Chat history, projects, skills panel
    │   ├── ChatHeader            # Model info, thinking timer, tokens
    │   ├── ChatLog               # Message renderer + tool events + thumbs feedback
    │   ├── Composer              # Input, persona selector, model selector
    │   ├── ModelSelector         # Provider-grouped model dropdown
    │   ├── ProjectDetail         # Project settings panel
    │   ├── Skills                # Agent skills catalog + management UI
    │   └── SettingsModal         # Settings + Memories + Training tabs
    └── hooks/
        ├── useChatApp.ts         # Root hook — assembles all sub-hooks
        ├── useChatSession.ts     # Coordinator: shared state + refs, delegates to sub-hooks
        ├── useSendMessage.ts     # Send logic, streaming, abort, AI title generation
        ├── useResearch.ts        # Deep research pipeline + chat persistence
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

> **Cloud-only users**: If you only use OpenAI, OpenRouter, or 9Router, Ollama is optional. The app will start without it.

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
git clone https://github.com/coderaulia/vanailachat.git
cd vanailachat
npm install

# 5. (Optional) Set cloud API keys
export OPENAI_API_KEY=sk-...           # OpenAI
# OR for OpenRouter:
export OPENAI_API_KEY=sk-or-...
export OPENAI_BASE_URL=https://openrouter.ai/api/v1
# OR for 9Router:
export NINE_ROUTER_API_KEY=...
export NINE_ROUTER_BASE_URL=http://localhost:20128/v1

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
git clone https://github.com/coderaulia/vanailachat.git
cd vanailachat
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
git clone https://github.com/coderaulia/vanailachat.git
cd vanailachat
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
   git clone https://github.com/coderaulia/vanailachat.git
   cd vanailachat
   npm install

   # Optional: set cloud API keys
   $env:OPENAI_API_KEY = "sk-..."

   npm run dev
   ```

5. **Open** `http://localhost:5173` in your browser.

> **Note**: `npm run dev` uses a Node.js predev script (`scripts/predev.js`) — no `sh`/bash dependency on Windows. The folder picker (`/api/pick-directory`) uses `zenity`/`kdialog` which aren't available on Windows; type the path manually in Coder mode instead.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | random (49152–65535) | Force a specific backend port |
| `OPENAI_API_KEY` | — | API key for OpenAI or OpenRouter |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Override for OpenRouter or other OpenAI-compatible APIs |
| `NINE_ROUTER_API_KEY` | — | API key for 9Router (also configurable via Settings UI) |
| `NINE_ROUTER_BASE_URL` | `http://localhost:20128/v1` | 9Router host (also configurable via Settings UI) |
| `MEMORY_TABLE_CAP` | `5000` | Max rows in the `memories` table; oldest entries evicted on insert beyond cap |

> You can also configure API keys and hosts in the **first-run onboarding wizard** or **Settings modal** — no env vars needed for basic use.

**OpenRouter example:**
```bash
export OPENAI_API_KEY=sk-or-v1-...
export OPENAI_BASE_URL=https://openrouter.ai/api/v1
```

**9Router example:**
```bash
export NINE_ROUTER_API_KEY=your-key
export NINE_ROUTER_BASE_URL=http://localhost:20128/v1
```

---

## First-Run Onboarding

On first launch, a setup wizard guides you through:

1. **LLM Setup** — choose Ollama (local), OpenAI, OpenRouter, or 9Router and enter credentials
2. **Profile** — optional name and role (personalizes AI responses)
3. **Memory & Instructions** — base instructions injected into every conversation
4. **Done** — tips on using personas, web search, and memory

Settings are saved to the SQLite `settings` table and cached in `localStorage`. To re-run the wizard, clear `localStorage` key `vanaila_onboarding_done` in browser DevTools.

---

## Agent Skills

Skills inject specialized instructions into every chat's system prompt, extending what the AI can do without changing its model.

**Install a skill** from the sidebar → Agent Skills → catalog, or paste a custom `SKILL.md`:

```
SKILL.md format:
---
name: my-skill
description: What this skill does
---
Skill body content injected into system prompt...
```

**How injection works**: at request time, all enabled skills are appended as `[Skill: name]\n{content}` blocks in the system prompt — before the user's messages reach the LLM.

**Built-in catalog** (fetched from `anthropics/skills` on GitHub):
- `frontend-design`, `canvas-design`, `algorithmic-art`, `brand-guidelines`
- `claude-api`, `skill-creator`, `mcp-builder`, `theme-factory`
- `doc-coauthoring`, `internal-comms`, `web-artifacts-builder`, `webapp-testing`

---

## Using Cloud Models

Once your API key is configured (via onboarding or env var), cloud models appear in the model picker with a provider badge:

- **OpenAI models** — prefixed as `openai:gpt-4o`, `openai:o1`, etc.
- **OpenRouter models** — same prefix convention, routed to `openrouter.ai`
- **9Router models** — prefixed as `9router:model-name`, routed to your 9Router instance

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

**9Router models not appearing**
Verify your API key and host are set in Settings → Provider Keys, or via `NINE_ROUTER_API_KEY` env var. The provider only lists models when a valid key is present.

**Windows: folder picker not working**
Type the path manually in the "Project Root" field in Coder mode. The native picker requires `zenity`/`kdialog` (Linux/macOS only).

**Training export returns 0 pairs**
You need at least one thumbs-up (👍) on an assistant message. Ratings are stored in the `message_feedback` table; check with `Settings → Training` to see current count.

**LoRA training fails (no module 'unsloth')**
```bash
pip install "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"
pip install --no-deps trl peft accelerate bitsandbytes
```
Unsloth requires Linux or WSL2 + NVIDIA GPU. macOS/CPU is unsupported for LoRA.

---

## Self-Learning Fine-Tune Guide

Full runbook: `scripts/finetune/README.md`

Quick path once you have ≥200 thumbs-up ratings:

```bash
# 1. Export dataset (or use Settings → Training tab)
curl -X POST http://localhost:<PORT>/api/training/export \
     -H 'content-type: application/json' \
     -d '{"format":"sharegpt"}'

# 2. Train (Linux/WSL2 + GPU required)
cd scripts/finetune
python train_lora.py \
    --base unsloth/Llama-3.2-3B-Instruct \
    --data ../../data/training/train-sharegpt-<stamp>.jsonl \
    --out  ../../data/adapters/v1

# 3. Convert adapter → GGUF (unsloth helper)
python -c "
from unsloth import FastLanguageModel
m, tok = FastLanguageModel.from_pretrained('../../data/adapters/v1')
m.save_pretrained_gguf('../../data/adapters/v1.gguf', tok, quantization_method='q4_k_m')
"

# 4. Generate Modelfile
node scripts/finetune/build-modelfile.js \
    --base llama3.2:3b \
    --adapter ../../data/adapters/v1.gguf \
    --out ../../data/adapters/v1.Modelfile \
    --tag vanaila-llama:v1

# 5. Register with Ollama
ollama create vanaila-llama:v1 -f ../../data/adapters/v1.Modelfile
# → now appears in VanailaChat model picker
```

---

## Roadmap

| Phase | Status | What |
|-------|--------|------|
| Phase 1 — Feedback capture | ✅ Done | Thumbs-up/down on messages, `message_feedback` table, `/api/messages/:id/feedback` |
| Phase 2 — Decay-weighted RAG | ✅ Done | Feedback-boosted cosine search, 30-day half-life decay, auto-embed on +1 |
| Phase 3 — LoRA pipeline | ✅ Done | Training export, `train_lora.py`, `build-modelfile.js`, Training tab UI |
| Phase 4 — Auto-eval harness | 🔲 Planned | A/B comparison across adapter versions; auto-positive heuristic (long reply + no follow-up edit = implicit +1); prompt distillation from high-scoring chats |

**Phase 4 details:**
- **A/B harness** — run two model tags in parallel on the same prompt, display side-by-side, record which wins; use wins as training signal for v(N+1)
- **Auto-positive heuristic** — if the user continues the conversation without editing the last assistant reply and the reply is >200 tokens, score it as implicit +1; configurable threshold
- **Prompt distillation** — extract the highest-scoring chat threads and use them as seed data for each training round, mixing with explicit +1 pairs to reduce catastrophic forgetting
- **Catastrophic-forgetting mitigation** — automatic 10% public instruction data blend (ShareGPT subset) added to every export to preserve general capability

---

Made with ❤️ by **Vanaila** for the local AI community.
