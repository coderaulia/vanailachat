# VanailaChat Local WebUI

A local browser interface for Ollama that starts the Ollama server, lets you choose a local model, and opens your browser automatically. Features chat history for continuing conversations across sessions.

## Setup

1. Open a terminal in this folder:
   ```bash
   cd /home/asw/Documents/dev/web-ui
   ```
2. Run the start command:
   ```bash
   npm start
   ```

## What happens

- The script detects installed Ollama models.
- You choose one of the local models in the terminal.
- It starts `ollama serve` on `http://127.0.0.1:11434` if not already running.
- It starts the WebUI at `http://127.0.0.1:3000`.
- Your default browser opens automatically.

## Usage

- Type a prompt in the text area.
- Click **Send** or press **Ctrl+Enter** to send.
- The app sends the request through the local proxy server and shows the assistant response.
- Chat history is saved automatically in your browser's local storage.
- Use the sidebar to view and load previous chats.
- Click **New Chat** to start a fresh conversation.
- Click **Clear** to delete the current chat.

## Features

- **Chat History**: Conversations are saved locally and can be resumed later.
- **Model Selection**: Choose from installed Ollama models.
- **Keyboard Shortcuts**: Ctrl+Enter to send messages.
- **Responsive Layout**: Fixed window layout with scrollable chat.
- **Auto-save**: Chats are saved after each response.

## Notes

- The WebUI proxies requests through the local Node server, so browser CORS issues are avoided.
- Chat history is stored in browser localStorage and persists across sessions.
- If `ollama` is not installed or the model list cannot be read, the start command will display an error.
