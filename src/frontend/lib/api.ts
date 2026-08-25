/**
 * Unified API layer supporting both Web (Node.js/Hono fetch) and Desktop (Tauri 2.0 Rust IPC).
 *
 * When running in the browser, requests route via HTTP fetch to /api/*.
 * When running inside Tauri, requests route through high-performance native IPC commands and events.
 */

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// ── Types ─────────────────────────────────────────────────────────────

export interface StreamChunk {
  message?: {
    role: string;
    content: string;
  };
  tool_calls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  tool_event?: {
    tool: string;
    status: 'start' | 'done' | 'error';
    summary?: string;
  };
  approval_request?: {
    id: string;
    tool: string;
    summary: string;
    details?: Record<string, unknown>;
  };
  generated_file?: {
    kind: string;
    name: string;
    url: string;
  };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

export interface ChatStreamRequest {
  messages: Array<{ role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }>;
  model?: string;
  provider?: string;
  persona?: string;
  systemPrompt?: string;
  projectRoot?: string | null;
  projectId?: string | null;
  tools?: string[];
  skills?: string[];
  temperature?: number;
  maxTokens?: number;
}

// ── Dynamic Tauri API Loader ──────────────────────────────────────────

async function getTauriCore() {
  return await import('@tauri-apps/api/core');
}

async function getTauriEvent() {
  return await import('@tauri-apps/api/event');
}

async function getTauriDialog() {
  return await import('@tauri-apps/plugin-dialog');
}

// ── Generic REST / IPC Helper ─────────────────────────────────────────

export async function requestApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  // If in desktop Tauri environment, we can route directly to invoke or fallback to internal bridge
  // For standard fetch calls, if running as web or if HTTP proxy is active:
  const response = await fetch(endpoint, options);
  if (!response.ok) {
    let errorMsg = `API Error ${response.status}: ${response.statusText}`;
    try {
      const errJson = await response.json();
      if (errJson?.error) errorMsg = errJson.error;
    } catch {
      // ignore
    }
    throw new Error(errorMsg);
  }
  return response.json();
}

// ── Native Folder / Directory Picker ─────────────────────────────────

export async function pickDirectoryDialog(): Promise<string | null> {
  if (isTauri) {
    try {
      const dialog = await getTauriDialog();
      const selected = await dialog.open({
        directory: true,
        multiple: false,
        title: 'Select Workspace Directory',
      });
      if (typeof selected === 'string') return selected;
      return null;
    } catch (err) {
      console.warn('[api] Tauri folder dialog failed, falling back to HTTP:', err);
    }
  }

  // Web fallback: calls backend /api/pick-directory
  try {
    const res = await requestApi<{ path: string | null }>('/api/pick-directory', { method: 'POST' });
    return res.path ?? null;
  } catch {
    return null;
  }
}

// ── Streaming Chat Completions ────────────────────────────────────────

export async function streamChatCompletion(
  body: ChatStreamRequest,
  onChunk: (chunk: StreamChunk) => void,
  signal?: AbortSignal
): Promise<void> {
  if (isTauri) {
    try {
      const { invoke } = await getTauriCore();
      const { listen } = await getTauriEvent();

      let unlisten: (() => void) | null = null;
      unlisten = await listen<StreamChunk>('chat-stream', (event) => {
        onChunk(event.payload);
      });

      const abortHandler = () => {
        invoke('cancel_chat').catch(() => {});
        if (unlisten) {
          unlisten();
          unlisten = null;
        }
      };

      signal?.addEventListener('abort', abortHandler, { once: true });

      try {
        await invoke('start_chat', { request: body });
      } finally {
        if (unlisten) {
          unlisten();
        }
        signal?.removeEventListener('abort', abortHandler);
      }
      return;
    } catch (err) {
      console.warn('[api] Tauri IPC chat stream failed or command not ready, falling back to HTTP:', err);
    }
  }

  // Web fallback: HTTP fetch with ReadableStream NDJSON line reader
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    let errorMsg = `Server error ${response.status}`;
    try {
      const err = await response.json();
      if (err.error) errorMsg = err.error;
    } catch {}
    throw new Error(errorMsg);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('Response body is not readable');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as StreamChunk;
        onChunk(parsed);
      } catch (e) {
        console.error('[api] Failed to parse streaming line:', line, e);
      }
    }
  }

  if (buffer.trim()) {
    try {
      const parsed = JSON.parse(buffer.trim()) as StreamChunk;
      onChunk(parsed);
    } catch {}
  }
}

// ── Deep Research Stream ──────────────────────────────────────────────

export async function streamResearch(
  query: string,
  onEvent: (event: Record<string, unknown>) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch('/api/research', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal,
  });

  if (!response.ok) throw new Error(`Research request failed: ${response.status}`);

  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        onEvent(parsed);
      } catch {}
    }
  }
}
