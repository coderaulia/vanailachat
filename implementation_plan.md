# VanailaChat — Code Review & Improvement Plan

## Summary

VanailaChat is a zero-dependency local WebUI for Ollama. It's a solid and well-structured vanilla Node.js + HTML/CSS/JS project. The code is clean and readable, but it has several areas where reliability, DX, and UX can be significantly improved before considering it production-grade.

---

## 🔴 Critical Issues

### ~~1. No streaming — full-response wait blocks UX~~ ✅ RESOLVED

`proxyChatRequest` now forces `stream: true` and pipes Ollama's SSE byte stream directly to the browser via `Readable.fromWeb()`. `sendPrompt` consumes the `ReadableStream` chunk-by-chunk, showing raw text live during generation, then re-renders with `marked` on completion.

---

### ~~2. Markdown renderer is custom and incomplete~~ ✅ RESOLVED

`appendInlineContent` + hand-rolled parser removed. `renderAssistantContent` now calls `marked.parse()` (GFM + breaks) and post-processes `<pre><code>` blocks with `hljs.highlight()`, wrapped in the existing `.code-block` shell with copy buttons. `marked@15.0.12` and `highlight.js@11.11.1` loaded via CDN — no build step.

---

### 3. No input length / context guard on the frontend
**File:** `app.js` L741–L787

`sendPrompt()` sends the entire `conversation` array verbatim with no truncation. If the conversation exceeds the model's context window, Ollama will error or silently truncate. The context meter is displayed but never actually enforced.

**Fix:** Before sending, trim or warn when `estimatedTokens` exceeds `currentContextWindow * 0.9`.

---

## 🟡 Important Improvements

### ~~4. Server: no body size limit~~ ✅ RESOLVED

`readRequestBody` in `server.js` now enforces a 4MB size limit and early-rejects payloads that exceed it.

---

### 5. `server.js` uses a raw `http` module — consider Express or Hono
**File:** `server.js` entire file

The routing logic is manual `if/else` on URL pathnames. It works, but it's fragile:
- No middleware chain → repeated error handling logic
- No built-in body parsing, CORS, or compression
- Static file serving is callback-based and bypasses `stream.pipe`

**Recommended dependency:** [`hono`](https://hono.dev/) (zero-dependency, Node-native, TypeScript-ready) or [`fastify`](https://fastify.dev/) if you want a richer plugin ecosystem. Both support streaming responses natively.

---

### ~~6. No `dev` script / hot-reload~~ ✅ RESOLVED

`nodemon` installed as a dev dependency. `npm run dev` now hot-reloads `server.js` on every file save.

---

### 7. `localStorage` may silently overflow
**File:** `app.js` L110–L118

`persistHistories()` calls `localStorage.setItem` without a try/catch. When the quota (~5 MB) is exceeded it throws a `QuotaExceededError` which is completely unhandled, so history is silently lost.

**Fix:**
```js
function persistHistories() {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, chats: chatHistories }));
  } catch (e) {
    console.warn('localStorage quota exceeded. Pruning oldest chats...');
    pruneOldestChats();
    // retry once
  }
}
```

---

### 8. Chat ID collision risk
**File:** `app.js` L514–L516

`generateChatId()` returns `Date.now().toString()`. If a user creates two chats in the same millisecond (e.g. via keyboard), they'll collide and overwrite.

**Fix:** Use `crypto.randomUUID()` (available in all modern browsers without polyfill).

---

### 9. `for modelSelect` label is duplicated
**File:** `index.html` L105, L111

Both the Model select and the Context display have `<label for="modelSelect">`. The Context label should have `for="contextWindowText"` (or no `for` at all since the target is a `<span>`).

---

### 10. Missing favicon, Open Graph, and meta description
**File:** `index.html`

No `<meta name="description">`, no favicon, no `<meta property="og:*">`. Minor, but worth adding for polish.

---

## 🟢 Nice-to-Have Improvements

### 11. Dark mode support
**File:** `style.css`

The design is light-only. There's no `@media (prefers-color-scheme: dark)` block. Many developer users run dark terminals and expect dark-mode UIs.

**Fix:** Add a `[data-theme="dark"]` CSS variable override + a toggle button in the header.

---

### 12. Delete individual chat history items
**File:** `app.js` L641–L677

The `history-item` buttons have no delete action. Users can only "Clear" the active chat; they can't prune stale history entries from the sidebar.

**Fix:** Add a small ✕ button inside each `history-item` with a `stopPropagation` guard.

---

### 13. No keyboard navigation for history list
**File:** `app.js` L658–L673

History items are `<button>` elements (✅ accessible) but there's no `role="listbox"` or arrow-key navigation. Consider adding `aria-selected` and `↑/↓` key support.

---

### 14. Typing animation re-renders the full DOM node
**File:** `app.js` L710–L738

`animateAssistantResponse` calls `updateMessageInDom` on every 16ms tick, which replaces the entire `<article>` DOM node via `replaceWith`. For long responses this causes excessive layout thrash.

**Fix:** During typing, update only the inner text node incrementally instead of replacing the whole element.

---

### ~~15. `ollama serve --port` flag may not be supported~~ ✅ RESOLVED

The `ollama serve` port is now correctly set using the `OLLAMA_HOST` environment variable when spawning the child process in `server.js`.

---

## Recommended Dependencies Summary

| Package | Purpose | Install |
|---|---|---|
| `hono` or `fastify` | Replace raw `http` router | `npm i hono` |
| `marked` | Full Markdown rendering | CDN or `npm i marked` |
| `highlight.js` / `shiki` | Syntax highlighting in code blocks | CDN |
| `eventsource-parser` | Parse SSE stream from Ollama | `npm i eventsource-parser` |
| `nodemon` | Dev hot-reload | `npm i -D nodemon` |

---

## Priority Order (Suggested Execution)

1. ~~**Streaming** — biggest UX win, unblocks everything else~~ ✅ Done
2. ~~**Replace markdown renderer** with `marked` + syntax highlighting~~ ✅ Done
3. ~~**Fix `ollama serve` port bug**~~ ✅ Done
4. ~~**Add body size cap** on `readRequestBody`~~ ✅ Done
5. ~~**Add dev script** + nodemon~~ ✅ Done
6. **Patch localStorage overflow** guard
7. **Dark mode** + delete history items
8. **Fix duplicate label / favicon**
