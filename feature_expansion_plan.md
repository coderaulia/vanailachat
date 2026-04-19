# Feature Expansion Plan: Files, Skills, and Web Search

This document outlines the technical strategy for introducing advanced capabilities to VanailaChat: **File Context**, **Skills (Tool Calling)**, and **Web Search**. These features will transform the app from a simple chat interface into a powerful agentic workspace.

---

## 1. Add Files for Context 📎

**Goal:** Allow users to attach local files to their prompt so the model can read and reason about them.

### Frontend Changes (`index.html`, `app.js`, `style.css`)
- **UI Element:** Add a "📎 Attach File" button (file input) next to the composer text area.
- **Attachment Tray:** Create a horizontal tray above the textarea to display selected files as "pills" with an `&times;` button to remove them.
- **File Parsing:** 
  - Use the browser's `FileReader API` to extract text content from standard code/text files (`.js`, `.txt`, `.md`, `.py`, etc.).
  - For images (if using vision models like `llava`), read as Base64.
- **Payload Injection:** When `sendPrompt()` is triggered, inject the file contents into the user's message context. 
  - *Format:* `[File: filename.txt]\n\`\`\`\n{content}\n\`\`\`\n\n{User Prompt}`

### Backend Changes (`server.js`)
- If handling only text, the backend proxy requires **no changes** (the frontend handles embedding the text).
- If supporting images (Vision models), the payload sent to `/v1/chat/completions` must include the `images: [base64_string]` array inside the user's message object.

---

## 2. Use Skills (Tool Calling) 🛠️

**Goal:** Give the model the ability to execute local functions (skills) like running scripts or reading system info.

*Note: This relies on Ollama's native [Tool Calling capabilities](https://ollama.com/blog/tool-support) (supported by models like `llama3.1`, `mistral`, `qwen2`).*

### Backend Changes (`server.js`)
- **Tool Registry:** Define a schema of available skills.
  ```json
  "tools": [{
    "type": "function",
    "function": {
      "name": "execute_node",
      "description": "Executes javascript code in a secure Node environment",
      "parameters": { ... }
    }
  }]
  ```
- **Execution Loop:** When the proxy requests a completion, we must monitor the stream. If the model returns a `tool_calls` object instead of normal text:
  1. Pause the stream to the frontend.
  2. Execute the requested local function (e.g., via Node's `child_process`).
  3. Append the result as a `role: "tool"` message.
  4. Automatically trigger a secondary request to Ollama with the new context so it can formulate a final answer.

### Frontend Changes
- **Tool UI:** Add visual indicators when a skill is running (e.g., a pulsing "🛠️ Executing execute_node..." pill in the chat log).
- **Collapsible Logs:** Render the raw output of the skill in a `<details>`/`<summary>` block within the assistant's message so the user can inspect what the tool actually did.

---

## 3. Web Search 🌐

**Goal:** Allow the model to search the live internet to answer questions about recent events or documentation.

### Backend Changes (`server.js`)
- **Implement as a Skill:** Web search will be registered as a standard tool (e.g., `search_web(query: string)`).
- **Search Provider:** Integrate a lightweight, free search scraper. 
  - *Option A:* [`duck-duck-scrape`](https://www.npmjs.com/package/duck-duck-scrape) (NPM package, zero API keys required).
  - *Option B:* `SerpAPI` or `Tavily` (Requires API keys, but more reliable for LLMs).
- **Execution:** When the model calls `search_web`, the backend performs the search, extracts the top 3-5 snippets, and returns them as a JSON string to the model.

### Frontend Changes
- **Web Toggle:** Add a "🌐 Web Search" toggle switch above the composer. If enabled, the `tools` array (including the search skill) is passed in the payload; if disabled, it is omitted to save tokens and prevent hallucinations.
- **Citations:** Update the Markdown renderer (`marked`) to parse and style citation links gracefully if the model references the searched URLs.

---

## Suggested Execution Phases

- **Phase 1: File Attachments (Text/Code).** This is the easiest win and requires zero backend changes. It immediately boosts developer productivity.
- **Phase 2: Vision File Support.** Update the backend/frontend to pass Base64 images for multimodal models.
- **Phase 3: The Tool Execution Loop.** Refactor the `server.js` streaming proxy to intercept, execute, and return `tool_calls`. Implement a safe dummy tool (e.g., `get_current_time`) to test the loop.
- **Phase 4: Implement Core Skills.** Add `search_web` (using duckduckgo) and basic local system skills. Integrate the UI toggles.
