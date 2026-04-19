# VanailaChat Local WebUI

A modern, local browser interface for Ollama built with **React 19**, **Vite**, and **Hono**. It automatically manages the Ollama server, provides a sleek UI for local AI interactions, and features robust tool execution like web searching.

## Architecture

- **Frontend**: React 19, Vite, TypeScript, Vanilla CSS (Premium Aesthetic).
- **Backend**: Hono (Node Server), TypeScript, DuckDuckGo Search Integration.
- **AI Engine**: Local Ollama daemon.

## Setup

1. Ensure you have Node.js and [Ollama](https://ollama.com) installed.
2. Open a terminal in this folder and install dependencies:
   ```bash
   npm install
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```

## What happens

- The Hono backend starts on port 3000, checking for and starting the `ollama` daemon automatically.
- The Vite frontend starts on a local port (e.g., 5173) and proxies `/api` requests to the backend.
- The UI fetches your installed Ollama models for you to select directly in the browser.

## Usage

- **Chat**: Select a model from the top bar and type your prompt.
- **Web Search**: The AI can automatically perform web searches if it determines real-time info is needed.
- **File Context**: Drag and drop text files into the chat area to include their content as context.
- **History**: Conversations are saved automatically in your browser's local storage. Use the sidebar to navigate them.

## Features

- **Tool Execution**: Integrated Web Search using DuckDuckGo via the Hono backend.
- **Context Management**: Live context window visualization and multi-modal file attachments.
- **Markdown & Code**: Full markdown rendering with GitHub-style code blocks and one-click copy buttons.
- **Theme Parity**: Premium dark/light modes with subtle animations and shimmering loading states.
- **TypeScript**: End-to-end type safety across both frontend and backend environments.
