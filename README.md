# VanailaChat Local WebUI 🍦

A premium, high-performance local browser interface for Ollama. VanailaChat transforms your local AI into a production-grade experience with real-time streaming, markdown support, and file/vision capabilities.

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js**: Version 18 or higher.
- **Ollama**: Must be installed on your system. [Download Ollama here](https://ollama.com/download).

### 2. Ollama Configuration
Before running the WebUI, ensure you have at least one model downloaded. You can pull models via your terminal:
```bash
ollama pull llama3.1       # Recommended for general chat
ollama pull llava          # Recommended for Vision/Image support
```

### 3. Project Setup
1. **Clone or open the project folder**:
   ```bash
   cd /home/asw/Documents/dev/vanaila-chat
   ```
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Launch the app**:
   ```bash
   npm start
   ```

## ✨ Core Features

- **Real-time SSE Streaming**: Zero-latency responses as the model generates text.
- **Markdown & Code Highlighting**: Beautiful rendering with syntax highlighting and one-click "Copy" for code blocks.
- **File & Vision Support**: 
  - **Context**: Attach code or text files (`.js`, `.py`, `.md`) to your prompt.
  - **Vision**: Attach images (`.jpg`, `.png`, `.webp`) for multimodal reasoning (requires a vision model like `llava`).
- **Modern Sidebar**: Manage conversation history with auto-save, model metadata, and one-click deletion.
- **Dark Mode**: Fully adaptive UI with system preference detection and manual toggle.
- **No-Config Launch**: Automatically detects and manages your local Ollama server on port `11434`.

## 🛠️ Development

If you are modifying the code, use the development mode to enable hot-reloading:
```bash
npm run dev
```

## 📝 Tech Stack
- **Frontend**: Vanilla HTML5, CSS3 (Modern Flex/Grid), JavaScript (ES6+).
- **Backend**: Node.js (Raw HTTP Proxy with Streaming).
- **Markdown**: `marked.js` + `highlight.js`.
- **Infrastructure**: Proxied API to bypass CORS, `localStorage` for history persistence.

---
*Created with ❤️ by Vanaila for the local AI community.*
