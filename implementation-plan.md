# VanailaChat v0.3 — Implementation Plan (Build Order)

## 1. SQLite Migration (Storage Foundation)

Replace all localStorage with better-sqlite3 on the Hono backend.
Schema:
sqlprojects (id, name, created_at)
chats (id, project_id, title, model, system_prompt, pinned, role, created_at, updated_at)
messages (id, chat_id, role, content, prompt_tokens, completion_tokens, created_at)

Add better-sqlite3 to dependencies
Create src/backend/services/database.ts — init DB, run migrations on startup
Add Hono routes: GET/POST/DELETE /api/chats, GET/POST /api/messages, GET/POST /api/projects
Replace all localStorage calls in App.tsx with fetch calls to these endpoints
Keep localStorage only for active UI state (theme, selected model)

## 2. Fix lastMessage Bug + Chat Title Bug

Two quick correctness fixes before adding more features.

In index.ts: declare let lastMessage: any = null before the while loop — currently referenced without declaration, throws in strict mode
In App.tsx handleSend: replace conversation[0]?.content.slice(0, 30) with userMessage.content.slice(0, 50) for accurate chat titles

## 3. Real Streaming + AbortController

In index.ts: replace the fake single-event SSE with a true piped stream from Ollama's /api/chat with stream: true — pipe response body chunks directly to the client
Update frontend SSE reader in handleSend to handle real incremental token chunks
Add const abortRef = useRef<AbortController | null>(null) in App.tsx
Call abortRef.current?.abort() on new send, new chat, or model switch
Pass signal to fetch in handleSend
Context window counter: wire from prompt_eval_count + eval_count in Ollama stream done event

## 4. Pin + Rename

Add pinned BOOLEAN DEFAULT 0 already in schema from step 1
In sidebar history item: add pin icon button, toggle via PATCH /api/chats/:id
Pinned chats sort to top in the frontend sort function
On title double-click in history item: replace <span> with inline <input>, save on blur or Enter via PATCH /api/chats/:id

## 5. Thinking Timer

Add thinkingStart = useRef<number | null>(null) in App.tsx
Set to Date.now() when isSending becomes true, clear on done
Add a useEffect with setInterval updating a thinkingSeconds state every second while sending
Display as a badge next to status text: Thinking... 6s
Add a subtle CSS pulse animation on the badge
Performance: limit conversation history sent to Ollama to last 20 messages (configurable constant) to reduce time-to-first-token

## 6. System Prompt Editor

system_prompt column already in schema from step 1
Add a collapsible <details> element above the textarea in the composer
Contains a <textarea> defaulting to 'You are a helpful assistant.'
Stored per chat in the chats table, loaded when switching chats
Replaces the hardcoded systemPrompt string in index.ts — backend reads it from the chat record on each request

## 7. Multi-Project

projects table already in schema from step 1
Add a project switcher dropdown at the top of the sidebar
Default project created on first launch: "Default"
All existing chats assigned to default project on migration
New chat inherits the currently selected project
Chat history list filters by project_id
Add + button to create new project (inline input, same pattern as rename)

## 8. Model Role Selector + Auto-Suggest

Create src/config/modelRoles.ts:
tsexport const MODEL_ROLE_MAP = {
general: ['llama3', 'qwen3.5', 'gemma4'],
coding: ['qwen3.5', 'qwen3-coder'],
vision: ['llava', 'gemma4'],
content: ['llama3', 'gemma4'],
}

Add role picker (icon button row) above model dropdown in composer
Selecting a role filters the model dropdown to recommended models
Role saved per chat in chats.role column
Auto-suggest: after user types a message, scan for code fences, file extensions, or keywords (debug, refactor, write, design) — if role mismatch detected, show a non-intrusive banner: "This looks like a coding task — switch to Qwen3-Coder?" with Accept / Dismiss buttons

## 9. Per-Message Token Badge

prompt_tokens + completion_tokens already in messages schema from step 1
Populate from Ollama stream done event in the backend before saving to DB
In App.tsx: add a showTokens boolean state (default false), toggled by a small icon button in the header
When enabled, render a subtle badge below each assistant message: ↑ 312 ↓ 89 tokens
Helps compare model efficiency across roles

## 10. Export / Import Chat History

Export: GET /api/export endpoint — queries all projects + chats + messages, returns as JSON; frontend triggers a Blob download as vanaila-backup-{date}.json
Import: POST /api/import endpoint — accepts the JSON file, iterates chats, inserts with conflict check on chat.id (skip duplicates, or prompt user to overwrite)
Add Export and Import buttons in the sidebar footer
File input for import uses <input type="file" accept=".json">

## 11. Coding Context Tools

    Extend src/backend/services/tools.ts:

Add list_directory tool: recursive fs.readdir up to depth 3, returns file tree as formatted string, respects .gitignore patterns
Add run_command tool: execFile with an allowlist (git log, git status, npm test, npm run lint, cat, ls) — reject anything not on the list
Add Project Root input field in the composer (shown when coding role is active), stored as project_root in chats table
Backend reads project_root from chat record and passes it as the working directory to both tools
