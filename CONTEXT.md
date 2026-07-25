# Stack Profile — vanaila-chat (ollama-vanaila-webui v0.2.0)

- **Language/runtime**: TypeScript 5.7 (ESM, `target: ESNext`), Node.js 20.x (per README nodesource setup_20.x); no `engines` field in package.json. Python 3 side-script for LoRA training.
- **Backend framework**: Hono 4.6 served by `@hono/node-server`; entry `src/backend/index.ts`, app factory `src/backend/app.ts` (DI via `AppDependencies`).
- **Frontend**: React 19 + Vite 6, `marked` + `highlight.js` + `dompurify` for message rendering. Dev proxy = custom Vite plugin reading `.port`.
- **Database**: SQLite via `better-sqlite3` 12 (WAL, `foreign_keys=ON`), file `data/vanaila.sqlite`, path override `DATABASE_PATH`.
- **ORM/query layer**: none — hand-written SQL + prepared statements in `DatabaseService`; hand-rolled migration runner (`services/migrations.ts`, versions 1–10, `schema_migrations` table, legacy-DB backfill to v4).
- **Auth**: none. No sessions, JWT, cookies, or OAuth; server binds `127.0.0.1` only. Bearer tokens are **outbound only** to LLM providers (`OPENAI_API_KEY`, `NINE_ROUTER_API_KEY`, `CUSTOM_OPENAI_API_KEY`, or same keys stored in the SQLite `settings` table).
- **LLM providers**: `ProviderRegistry` over Ollama (local, auto-starts daemon), OpenAI, NineRouter, custom OpenAI-compatible.
- **Caching**: no Redis/external cache. In-process only — rate-limiter Map, skills `SKILL.md` content cached in SQLite, embeddings (nomic-embed-text, 768-dim) stored in SQLite for cosine search.
- **Queue / background jobs**: none. Only in-process timers: rate-limiter sweep `setInterval` (`middleware/rateLimiter.ts`) and per-tool `setTimeout` timeouts. Fine-tuning is a manual offline step.
- **Rate limiting**: in-memory sliding window — 20/min `/api/chat`, 60/min `/api/models` + `/api/memory`, 10/min `/api/research`, `/api/skills/install`, `/api/skills/custom`, `/api/ab`. `trustProxy` off (single anonymous bucket).
- **Deployment target**: local single-machine (VM/desktop, Linux/macOS/Windows). No Dockerfile, no serverless config, no CI manifests. Backend picks `PORT` or a random 49152+ port and writes `.port`; build = `tsc` (backend) + `vite build` (frontend).
- **HTTP entry points**: `/api/health`, `/api/config`, `/api/model-details`, `/api/projects`, `/api/chats`, `/api/messages` (+`/:id/feedback`), `/api/export`, `/api/import`, `/api/pick-directory`, `/api/models`, `/api/settings`, `/api/skills` (catalog/install/custom), `/api/personas`, `/api/research`, `/api/memory` (search/index-chat/context), `/api/training` (stats/export), `/api/ab` (+`/pick`), `/api/chat` (NDJSON streaming).
- **Cron/webhooks**: none — no scheduler, no inbound webhook handlers.
- **Outbound network**: Ollama HTTP API, OpenAI-compatible endpoints, DuckDuckGo (`duck-duck-scrape`) + URL fetch for research, `raw.githubusercontent.com` for skill install.
- **CLI entry points**: `npm run dev` (concurrently tsx-watch backend + vite), `scripts/predev.js` (Windows port reclaim; `predev.sh` POSIX twin), `scripts/finetune/build-modelfile.js` (Ollama Modelfile generator), `scripts/finetune/train_lora.py` (LoRA training, `--mix-file`/`--mix-ratio`).
- **Agent tools exposed to models**: `search_web`, `read_url`, `read_file`, `list_directory`, `run_command` (local shell execution, timeout-guarded).
- **Testing/lint**: Vitest 3 (node env, jsdom available) — 14 backend suites + 1 frontend; ESLint 9 flat config, `--max-warnings=0`; `tsc --noEmit` type-check.
