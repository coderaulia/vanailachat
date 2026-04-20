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

- **Intelligent Selector**: High-performance model picker with capability badges and role-based filtering.
- **Dynamic Roles**: Pivot between Coding, Vision, and Creative modes for task-specific optimization.
- **Agentic Suggestions**: Smart detection of vision and creative tasks based on prompts and attachments.
- **Global Search**: Toggle real-time web awareness via integrated DuckDuckGo search.
- **Rich Context**: Support for image vision and deep text-file context.

## Features

- **Premium DX**: Metadata-driven model orchestration with role-based filtering and smart detection.
- **Multi-Modal Native**: Deep integration for vision models and Flux text-to-image workflows.
- **Search Augmented**: Built-in tool execution for real-time web intelligence.
- **Visual Excellence**: Premium glassmorphic design with serif typography and micro-animations.
- **Atomic Precision**: End-to-end TypeScript safety and optimized Hono/React architecture.

---
Made with ❤️ by **Vanaila** for local AI community
