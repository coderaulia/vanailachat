# VanailaChat Local WebUI

A modern, production-grade local browser interface for [Ollama](https://ollama.com) — built with **React 19**, **Hono**, and **SQLite**. Features a premium glassmorphic UI, multi-project workspaces, agentic tool execution, and a fully modular backend and frontend architecture.

## Architecture

| Layer | Technology | Notes |
|---|---|---|
| **Frontend** | React 19, Vite, TypeScript | Context API state, per-component CSS modules |
| **Backend** | Hono (Node.js), TypeScript | Modular routes, dependency-injected services |
| **Database** | SQLite (`better-sqlite3`) | Versioned migration system (`schema_migrations`) |
| **AI Engine** | Local Ollama daemon | Auto-started, model-validated, stream-proxied |
| **Search** | DuckDuckGo (`duck-duck-scrape`) | Injected as a tool at inference time |

### Backend Structure

```
src/backend/
├── app.ts                  # createApp() — middleware + route registration only
├── routes/
│   ├── chat.ts             # POST /api/chat — streaming inference + tool execution
│   ├── chats.ts            # /api/chats CRUD
│   ├── messages.ts         # /api/messages
│   ├── projects.ts         # /api/projects CRUD
│   ├── models.ts           # /api/models, /api/model-details
│   └── data.ts             # /api/export, /api/import, /api/pick-directory
├── services/
│   ├── database.ts         # SQLite setup + versioned migrations
│   ├── migrations.ts       # Migration definitions (schema_migrations table)
│   ├── ollama.ts           # Model listing, streaming, details
│   └── tools.ts            # Hardened agentic tool execution (path-safe)
└── helpers/index.ts        # normalizeMessageContent, extractImageBase64
```

### Frontend Structure

```
src/frontend/
├── context/ChatContext.tsx # Single React Context eliminating all prop drilling
├── components/             # Leaf components, each with co-located CSS
│   ├── Sidebar(.tsx/.css)
│   ├── ChatHeader(.tsx/.css)
│   ├── ChatLog(.tsx/.css)
│   ├── Composer(.tsx/.css)
│   ├── ModelSelector(.tsx/.css)
│   └── ProjectDetail(.tsx/.css)
├── hooks/
│   ├── useChatApp.ts       # Root hook — assembles all sub-hooks
│   ├── useChatSession.ts   # Streaming, abort, send, conversation state
│   ├── useModelManager.ts  # Model list, role detection, suggestions
│   ├── usePersistence.ts   # API calls to SQLite backend
│   ├── useUIState.ts       # Sidebar, theme, status text
│   └── useKeyboardShortcuts.ts  # Global keyboard shortcut registration
└── styles/tokens.css       # Design tokens, global resets, animations
```

## Setup

1. Ensure you have **Node.js ≥ 18** and [Ollama](https://ollama.com) installed.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```

The Hono backend starts on **port 3000** and auto-launches the `ollama` daemon if it isn't running. The Vite frontend starts on **port 5173** and proxies `/api` requests to the backend.

## Features

### AI & Model Management
- **Premium Model Picker**: Dropdown with capability badges (`vision`, `coding`, `creative`), role-based filtering, and instant model refresh.
- **Dynamic Role Switching**: Pivot between `General`, `Coding`, `Vision`, and `Creative` modes. Smart role suggestions auto-fire based on prompt content and attachments.
- **Model Validation**: Backend validates the requested model against the installed Ollama list before proxying — prevents silent crashes.
- **Context Window Meter**: Live progress bar showing token usage vs. model capacity.

### Conversation
- **Streaming Responses**: NDJSON stream parsed and rendered token-by-token with a typing cursor.
- **Abort / Stop**: Cancel any in-flight generation. The previous prompt is automatically restored to the composer.
- **Copy Response**: Hover any assistant message to reveal a **Copy** button that copies the raw Markdown source — not rendered HTML.
- **Token Badges**: Toggle per-message prompt/completion token counts.

### Agentic Tools
- **Web Search**: Toggle DuckDuckGo integration per-session; results are injected as context before inference.
- **File Reading** (`cat`): LLM can read files within the configured project root — path traversal is blocked server-side.
- **Directory Listing** (`ls`): LLM can browse directory trees, confined to the project root.
- **Image Generation**: Automatic routing to Flux-compatible endpoints when a vision/generation model is selected.

### Projects & Workspaces
- **Multi-Project Support**: Organize chats into named projects with descriptions, custom instructions, and memory fields.
- **Project Root**: Bind a filesystem path to a chat session; injected as context for the coding role.
- **Folder Picker**: Native OS directory picker (`zenity`/`kdialog`) via backend `/api/pick-directory`.
- **System Prompt per Chat**: Per-session system prompt saved to SQLite and restored on chat reload.

### UI & UX
- **Keyboard Shortcuts**:
  | Shortcut | Action |
  |---|---|
  | `Ctrl+N` | New chat |
  | `Ctrl+/` | Toggle sidebar |
  | `Ctrl+Shift+S` | Toggle web search |
  | `Escape` | Abort generation |
- **Dark Mode**: Full theme toggle persisted across sessions.
- **Glassmorphic Design**: Layered backdrop-blur surfaces, gradient backgrounds, micro-animations.
- **Sidebar Chat History**: Pinnable, renameable, deleteable chat sessions filtered by active project.
- **Multi-modal Attachments**: Paste or attach images and text files; images are sent as base64 to vision models.

### Backend & Data
- **Modular Routes**: All route logic extracted from the original 831-line monolith into focused Hono router files.
- **Versioned Migrations**: SQLite schema managed via a `schema_migrations` table — safe for upgrades from any legacy database state.
- **Export / Import**: One-click full workspace backup and restore as JSON.
- **Security Hardened**: Path traversal prevention on all file tool calls; model name validation against installed list.

## Scripts

```bash
npm run dev          # Start backend + frontend concurrently
npm run dev:backend  # Backend only (tsx watch)
npm run dev:frontend # Frontend only (vite)
npm run build        # Production build (backend tsc + frontend vite)
npm run test         # Vitest unit + integration tests
npm run type-check   # TypeScript type validation (no emit)
npm run lint         # ESLint (zero warnings policy)
```

---
Made with ❤️ by **Vanaila** for the local AI community.
