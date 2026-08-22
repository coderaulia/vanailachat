# VanailaChat

VanailaChat is a self-hosted AI workspace for local and OpenAI-compatible models. It combines chat, projects, web research, long-term memory, agent tools, document generation, and model evaluation in one local-first application.

It is built with React, TypeScript, Hono, Vite, and SQLite.

## Highlights

- Use local Ollama models or OpenAI, 9Router, and other OpenAI-compatible providers.
- Organize conversations into projects with instructions, memory, and an optional project directory.
- Stream chat responses, cancel runs, search conversations, and rate assistant replies.
- Give the assistant controlled tools for web search, reading URLs and files, searching directories, editing files, running commands, and generating downloadable Word documents.
- Review every state-changing tool call in the UI before it runs.
- Attach text, PDF, DOCX, and XLSX files; document text is extracted locally before being sent to the model.
- Build semantic memory with Ollama embeddings, with keyword fallback when embeddings are unavailable.
- Run deep-research workflows and side-by-side A/B model comparisons.
- Export feedback data for LoRA fine-tuning and evaluate model variants.

## Requirements

- Node.js 20 or later
- [pnpm](https://pnpm.io/) (v10 or later)
- [Ollama](https://ollama.com/) for local models and semantic embeddings (optional for cloud-only use)

## Getting started

```bash
git clone https://github.com/coderaulia/vanailachat.git
cd vanailachat
pnpm install
```

For local models, install Ollama and pull a model:

```bash
ollama pull llama3.2
# Optional: enables semantic memory
ollama pull nomic-embed-text
```

Copy the environment template if you want to configure providers outside the app:

```bash
cp .env.example .env
```

*(On Windows Command Prompt, use `copy .env.example .env`).* You can also add provider keys directly in the application settings.

Start the app:

```bash
pnpm dev
```

Open the frontend at `http://localhost:5173`. The backend chooses an available local port and records it in `.port`; Vite connects to it automatically.

## Providers

| Provider | Configuration |
| --- | --- |
| Ollama | No key required; local daemon is started when available. |
| OpenRouter | `OPENROUTER_API_KEY` (and default `https://openrouter.ai/api/v1`). |
| OpenAI | `OPENAI_API_KEY` and optional `OPENAI_BASE_URL`. |
| 9Router | `NINE_ROUTER_API_KEY` and `NINE_ROUTER_BASE_URL`. |
| Custom OpenAI-compatible API | `CUSTOM_OPENAI_API_KEY` and `CUSTOM_OPENAI_BASE_URL`. |
| Claude Code workspace | `ANTHROPIC_API_KEY`; opened from the Coding control in the composer. |

### Persisting API Keys & Settings

Provider credentials can be configured in two ways:

1. **In the UI (Recommended)**: Open **Settings** (⚙️) → **AI Connection**, choose your provider, enter your secret key, and click **Test Connection** or dismiss the modal. Credentials are saved locally and permanently to the SQLite database (`data/vanaila.sqlite`).
2. **In `.env` / `.env.local`**: Copy `.env.example` to `.env` and fill in your keys (e.g. `OPENROUTER_API_KEY=sk-or-v1-...`). The backend loads `.env` and `.env.local` automatically at startup.

### Coding Workspace & Free Claude Code (FCC) Integration

The Coding control opens a Claude Code workspace directly in the browser:
- Powered by the open-source **[Free Claude Code (FCC)](https://github.com/alishahryar1/free-claude-code)** integration (by [@alishahryar1](https://github.com/alishahryar1), MIT License).
- Runs out of the box using your active connected providers (**Ollama**, **OpenRouter**, **9Router**, **Custom**, or **OpenAI**) without requiring an Anthropic API key.
- Choose a local project directory, send plans or implementation prompts, and approve file edits and shell commands before they run.
- Optionally provide a direct `ANTHROPIC_API_KEY` in Settings or connect to an external `fcc-server` if preferred.

## Main features

### Projects, chat, and memory

- Projects keep related conversations, instructions, and shared context together.
- Chats support Markdown, code highlighting, image attachments, streaming, cancellation, generated titles, and full-text message search.
- Assistant feedback powers positive/negative memory weighting and training-data exports.
- Memory is stored in the local SQLite database. Semantic retrieval uses `nomic-embed-text` when available and falls back gracefully when it is not.

### Agent tools

Available tools depend on the selected persona and include:

- Web search and page reading
- File and directory reading within the configured project root
- File search, create, and targeted edits
- Allowlisted local commands for development tasks
- Downloadable `.docx` document generation

Writes, edits, and commands require an explicit approval in the chat interface. Tool access is scoped to the project root and is protected against path and symlink traversal.

### Research and evaluation

- Deep Research searches the web, reads selected sources, and streams a cited synthesis.
- A/B comparison runs one prompt against two models and records the chosen response.
- The training section exports approved conversation pairs in ShareGPT or Alpaca format. The optional LoRA workflow is documented in [`scripts/finetune/README.md`](scripts/finetune/README.md).

### Skills and personas

Choose focused personas for general work, coding, creative work, research, writing, and more. Skills can be installed from the catalog or added from a custom `SKILL.md`; enabled skills are included in the assistant’s system prompt.

## Scripts

```bash
pnpm dev           # Start backend and frontend
pnpm dev:backend   # Start the backend only
pnpm dev:frontend  # Start the frontend only
pnpm build         # Build backend and frontend
pnpm test          # Run the test suite
pnpm type-check    # Validate TypeScript
pnpm lint          # Run ESLint
pnpm backup        # Create a SQLite database backup
pnpm preview       # Preview a production frontend build
```

## Data and security

- Application data is stored locally in SQLite at `data/vanaila.sqlite` by default. Set `DATABASE_PATH` to override it.
- Database backups are written to `backups/` by `pnpm backup`.
- The backend is intended for local use and binds to loopback. It does not provide multi-user authentication.
- API access is restricted to loopback origins, state-changing cross-site requests are rejected, and security headers are enabled.
- URL-reading tools block private and metadata network targets to reduce SSRF risk.

## Development

Continuous integration runs linting, type checks, tests, and production builds on Windows and Ubuntu. Before opening a pull request, run:

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

## Contributing

Open-source contributors are welcome. To join the development of VanailaChat, email [care@vanaila.com](mailto:care@vanaila.com) with a brief introduction and the area you would like to help with.

Please keep pull requests focused, include tests when behavior changes, and never include secrets or local database files.

## Acknowledgements & Credits

- **[Free Claude Code (FCC)](https://github.com/alishahryar1/free-claude-code)** by [@alishahryar1](https://github.com/alishahryar1) (MIT License) — powers the provider-agnostic Anthropic Messages adapter for Claude Code in VanailaChat.

## License

No license file is currently included in this repository. Contact the maintainers before redistributing or reusing the project outside the repository terms.
