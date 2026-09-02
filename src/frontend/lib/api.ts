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
  messages: Array<{
    role: string;
    content: string | Array<string | { text?: string }>;
    tool_calls?: unknown[];
    tool_call_id?: string;
  }>;
  model?: string;
  provider?: string;
  persona?: string;
  systemPrompt?: string;
  projectRoot?: string | null;
  projectId?: string | null;
  tools?: string[];
  chatId?: string;
  assistantMessageId?: string;
  stream?: boolean;
  search?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface ApiProjectDto {
  id: string;
  name: string;
  description?: string | null;
  instructions?: string | null;
  memory?: string | null;
  pinned?: boolean;
  created_at?: number;
  createdAt?: number;
  updated_at?: number;
  updatedAt?: number;
}

export interface ApiChatDto {
  id: string;
  title: string;
  project_id?: string | null;
  projectId?: string | null;
  project_root?: string | null;
  projectRoot?: string | null;
  system_prompt?: string | null;
  systemPrompt?: string | null;
  model?: string | null;
  role?: string | null;
  created_at?: number;
  createdAt?: number;
  updated_at?: number;
  updatedAt?: number;
  pinned?: boolean | number;
  usage?: number;
}

export interface ApiMessageDto {
  id: string;
  chat_id?: string;
  chatId?: string;
  role: string;
  content: string;
  prompt_tokens?: number | null;
  promptTokens?: number | null;
  completion_tokens?: number | null;
  completionTokens?: number | null;
  created_at?: number;
  createdAt?: number;
  timestamp?: number;
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

// ── Generic REST Helper ───────────────────────────────────────────────

export async function requestApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
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

  try {
    const res = await requestApi<{ path: string | null }>('/api/pick-directory', { method: 'POST' });
    return res.path ?? null;
  } catch {
    return null;
  }
}

// ── Projects IPC / REST ───────────────────────────────────────────────

export async function apiFetchProjects(): Promise<ApiProjectDto[]> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    return await invoke<ApiProjectDto[]>('get_projects');
  }
  const data = await requestApi<{ projects?: ApiProjectDto[] }>('/api/projects');
  return Array.isArray(data.projects) ? data.projects : [];
}

export async function apiGetProject(id: string): Promise<ApiProjectDto | null> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    return await invoke<ApiProjectDto | null>('get_project', { id });
  }
  const data = await requestApi<{ project?: ApiProjectDto }>(`/api/projects/${encodeURIComponent(id)}`);
  return data.project ?? null;
}

export async function apiCreateProject(payload: { id: string; name: string; description?: string; instructions?: string }): Promise<ApiProjectDto> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    return await invoke<ApiProjectDto>('create_project', { payload });
  }
  const data = await requestApi<{ project?: ApiProjectDto }>('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return data.project ?? (payload as ApiProjectDto);
}

export async function apiUpdateProject(
  id: string,
  payload: { name?: string; description?: string; instructions?: string; memory?: string; pinned?: boolean }
): Promise<ApiProjectDto | null> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    return await invoke<ApiProjectDto | null>('update_project', { id, payload });
  }
  const data = await requestApi<{ project?: ApiProjectDto }>(`/api/projects/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return data.project ?? null;
}

export async function apiDeleteProject(id: string): Promise<boolean> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    return await invoke<boolean>('delete_project', { id });
  }
  await requestApi(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return true;
}

// ── Chats IPC / REST ──────────────────────────────────────────────────

export async function apiFetchChats(): Promise<ApiChatDto[]> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    return await invoke<ApiChatDto[]>('get_chats');
  }
  const data = await requestApi<{ chats?: ApiChatDto[] }>('/api/chats');
  return Array.isArray(data.chats) ? data.chats : [];
}

export async function apiCreateChat(payload: {
  id: string;
  title: string;
  project_id?: string | null;
  projectId?: string | null;
  project_root?: string | null;
  projectRoot?: string | null;
  system_prompt?: string | null;
  systemPrompt?: string | null;
  model?: string | null;
  role?: string | null;
  created_at?: number;
  createdAt?: number;
  updated_at?: number;
  updatedAt?: number;
  pinned?: boolean;
}): Promise<ApiChatDto> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    return await invoke<ApiChatDto>('create_chat', {
      payload: {
        id: payload.id,
        title: payload.title,
        project_id: payload.project_id ?? payload.projectId ?? null,
        project_root: payload.project_root ?? payload.projectRoot ?? null,
        system_prompt: payload.system_prompt ?? payload.systemPrompt ?? null,
        model: payload.model ?? null,
        role: payload.role ?? null,
      },
    });
  }
  const data = await requestApi<{ chat?: ApiChatDto }>('/api/chats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: payload.id,
      title: payload.title,
      projectId: payload.projectId ?? payload.project_id ?? null,
      projectRoot: payload.projectRoot ?? payload.project_root ?? null,
      systemPrompt: payload.systemPrompt ?? payload.system_prompt ?? null,
      model: payload.model ?? null,
      role: payload.role ?? null,
      createdAt: payload.createdAt ?? payload.created_at,
      updatedAt: payload.updatedAt ?? payload.updated_at,
      pinned: payload.pinned,
    }),
  });
  return data.chat ?? (payload as ApiChatDto);
}

export async function apiDeleteChat(id: string): Promise<boolean> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    return await invoke<boolean>('delete_chat', { id });
  }
  await requestApi(`/api/chats/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return true;
}

// ── Messages IPC / REST ───────────────────────────────────────────────

export async function apiFetchMessages(chatId: string): Promise<ApiMessageDto[]> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    return await invoke<ApiMessageDto[]>('get_messages', { chatId });
  }
  const data = await requestApi<{ messages?: ApiMessageDto[] }>(`/api/messages?chatId=${encodeURIComponent(chatId)}`);
  return Array.isArray(data.messages) ? data.messages : [];
}

export async function apiSaveMessage(payload: {
  id: string;
  chat_id?: string;
  chatId?: string;
  role: string;
  content: string;
  prompt_tokens?: number | null;
  promptTokens?: number | null;
  completion_tokens?: number | null;
  completionTokens?: number | null;
  created_at?: number;
  createdAt?: number;
  timestamp?: number;
}): Promise<ApiMessageDto> {
  const chatId = payload.chatId ?? payload.chat_id ?? '';
  const createdAt = payload.createdAt ?? payload.created_at ?? payload.timestamp ?? Date.now();
  if (isTauri) {
    const { invoke } = await getTauriCore();
    return await invoke<ApiMessageDto>('save_message', {
      payload: {
        id: payload.id,
        chat_id: chatId,
        role: payload.role,
        content: payload.content,
        created_at: createdAt,
      },
    });
  }
  const data = await requestApi<{ message?: ApiMessageDto }>('/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: payload.id,
      chatId,
      role: payload.role,
      content: payload.content,
      promptTokens: payload.promptTokens ?? payload.prompt_tokens ?? null,
      completionTokens: payload.completionTokens ?? payload.completion_tokens ?? null,
      createdAt,
    }),
  });
  return data.message ?? (payload as ApiMessageDto);
}

// ── Models & Settings IPC / REST ──────────────────────────────────────

export async function apiFetchModels(): Promise<Array<{
  name: string;
  provider: string;
  providerLabel?: string;
  model_type?: string;
}>> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    return await invoke('get_models');
  }
  const data = await requestApi<{
    models?: Array<{ name: string; provider: string; providerLabel?: string; model_type?: string }>;
  }>('/api/models');
  return Array.isArray(data.models) ? data.models : [];
}

export async function apiPullModel(
  name: string,
  onProgress?: (progress: { status?: string; completed?: number; total?: number }) => void
): Promise<void> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    const { listen } = await getTauriEvent();

    let unlisten: (() => void) | null = null;
    if (onProgress) {
      unlisten = await listen('ollama-pull-progress', (event) => {
        onProgress(event.payload as { status?: string; completed?: number; total?: number });
      });
    }

    try {
      await invoke('pull_model', { name });
    } finally {
      if (unlisten) unlisten();
    }
    return;
  }

  // Web fallback:
  await requestApi('/api/models/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function apiFetchSettings(): Promise<Record<string, string>> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    return await invoke<Record<string, string>>('get_settings');
  }
  const data = await requestApi<{ settings?: Record<string, string> }>('/api/settings');
  return data.settings ?? {};
}

export async function apiUpdateSetting(key: string, value: string): Promise<void> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    await invoke('update_setting', { key, value });
    return;
  }
  await requestApi(`/api/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
}






export interface TrainingExampleDto {
  id: string;
  chat_id?: string;
  chatId?: string;
  chat_title?: string;
  chatTitle?: string;
  user_content?: string;
  userContent?: string;
  assistant_content?: string;
  assistantContent?: string;
  rating: number;
  edited: boolean;
  created_at?: number;
  createdAt?: number;
}

export interface TrainingStatsDto {
  pairs: number;
  explicit: number;
  edited: number;
  implicit: number;
  distillation: number;
  topChats: number;
  oldest: number | null;
  newest: number | null;
}

export async function apiFetchTrainingExamples(): Promise<TrainingExampleDto[]> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    return await invoke<TrainingExampleDto[]>('get_training_examples');
  }
  const data = await requestApi<{ examples?: TrainingExampleDto[] }>('/api/training/examples');
  return data.examples ?? [];
}

export async function apiFetchTrainingStats(): Promise<TrainingStatsDto> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    return await invoke<TrainingStatsDto>('get_training_stats');
  }
  return await requestApi<TrainingStatsDto>('/api/training/stats');
}

export async function apiExportTrainingData(request: {
  format: 'sharegpt' | 'alpaca';
  selectedIds: string[];
}): Promise<{ path?: string; pairs?: number; explicit?: number; distilled?: number; format?: string; error?: string }> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    return await invoke('export_training_data', {
      request: { format: request.format, selected_ids: request.selectedIds },
    });
  }
  return await requestApi('/api/training/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format: request.format, selectedIds: request.selectedIds }),
  });
}

export interface CodingSessionDto {
  chat_id: string;
  harness: string;
  harness_session_id?: string | null;
  workspace_path: string;
  status: string;
  created_at: number;
  updated_at: number;
}

export async function apiGetCodingSession(chatId: string): Promise<CodingSessionDto | null> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    return await invoke<CodingSessionDto | null>('get_coding_session', { chatId });
  }
  const data = await requestApi<{ session?: CodingSessionDto }>(`/api/coding/sessions/${encodeURIComponent(chatId)}`);
  return data.session ?? null;
}

export async function apiCreateCodingSession(request: { chatId: string; harness: string; workspacePath: string }): Promise<CodingSessionDto> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    return await invoke<CodingSessionDto>('create_coding_session', {
      request: { chat_id: request.chatId, harness: request.harness, workspace_path: request.workspacePath },
    });
  }
  const data = await requestApi<{ session: CodingSessionDto }>('/api/coding/sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
  });
  return data.session;
}

export async function runNativeCoding(
  request: { chatId: string; prompt: string; model: string; systemPrompt?: string },
  onChunk: (chunk: StreamChunk) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!isTauri) throw new Error('Native coding is only available in Tauri');
  const { invoke } = await getTauriCore();
  const { listen } = await getTauriEvent();
  let unlisten: (() => void) | null = await listen<StreamChunk>('chat-stream', (event) => onChunk(event.payload));
  const abortHandler = () => { void invoke('cancel_chat'); };
  signal?.addEventListener('abort', abortHandler, { once: true });
  try {
    await invoke('run_coding', { request: {
      chat_id: request.chatId, prompt: request.prompt, model: request.model, system_prompt: request.systemPrompt ?? null,
    } });
  } finally {
    unlisten?.(); unlisten = null;
    signal?.removeEventListener('abort', abortHandler);
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
      const { systemPrompt, maxTokens, ...nativeRequest } = body;
      const nativeBody = {
        ...nativeRequest,
        messages: body.messages.map((message) => ({
          ...message,
          content: typeof message.content === 'string' ? message.content : Array.isArray(message.content)
            ? message.content.map((part: unknown) => typeof part === 'string' ? part : (part as { text?: string }).text ?? '').join('')
            : String(message.content),
        })),
        system_prompt: systemPrompt,
        max_tokens: maxTokens,
      };

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
        await invoke('start_chat', { request: nativeBody });
      } finally {
        if (unlisten) {
          unlisten();
        }
        signal?.removeEventListener('abort', abortHandler);
      }
      return;
    } catch (err) {
      console.error('[api] Tauri IPC chat stream failed:', err);
      throw err;
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
    } catch {
      // ignore json parse failure
    }
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
    } catch {
      // ignore trailing chunk parse failure
    }
  }
}

// ── Deep Research Stream ──────────────────────────────────────────────

export async function streamResearch(
  query: string,
  onEvent: (event: Record<string, unknown>) => void,
  signal?: AbortSignal
): Promise<void> {
  if (isTauri) {
    try {
      const { invoke } = await getTauriCore();
      const { listen } = await getTauriEvent();

      let unlisten: (() => void) | null = null;
      unlisten = await listen('research-status', (event) => {
        onEvent(event.payload as Record<string, unknown>);
      });

      try {
        const res = await invoke<string[]>('start_research', { query });
        onEvent({ status: 'complete', results: res });
      } finally {
        if (unlisten) unlisten();
      }
      return;
    } catch (err) {
      console.warn('[api] Tauri research IPC failed, falling back to HTTP:', err);
    }
  }

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
      } catch {
        // ignore malformed line
      }
    }
  }
}

// ── Data Backup & Restore ─────────────────────────────────────────────

export async function apiExportData(): Promise<Record<string, unknown>> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    return await invoke('export_data');
  }
  const res = await fetch('/api/export');
  if (!res.ok) throw new Error('Export failed');
  return res.json();
}

export async function apiImportData(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    return await invoke('import_data', { payload });
  }
  const res = await fetch('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Import failed');
  return res.json();
}

// ── Git & Codebase Activity ───────────────────────────────────────────

export async function apiGetGitStatus(workspaceRoot: string): Promise<{ isGit: boolean; branch: string | null; isClean: boolean; uncommittedCount: number; isMainOrMaster: boolean; files: string[] }> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    const result = await invoke<{ is_git: boolean; branch: string; is_clean: boolean; uncommitted_count: number; is_main_or_master: boolean; files: string[] }>('get_git_status', { workspaceRoot });
    return { isGit: result.is_git, branch: result.branch, isClean: result.is_clean, uncommittedCount: result.uncommitted_count, isMainOrMaster: result.is_main_or_master, files: result.files };
  }
  const res = await fetch('/api/git/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectRoot: workspaceRoot }),
  });
  if (!res.ok) throw new Error('Failed to get git status');
  const data = await res.json() as {
    isGit?: boolean; branch?: string | null; isClean?: boolean;
    uncommittedCount?: number; isMainOrMaster?: boolean; modifiedFiles?: string[]; files?: string[];
  };
  return {
    isGit: data.isGit ?? false,
    branch: data.branch ?? null,
    isClean: data.isClean ?? true,
    uncommittedCount: data.uncommittedCount ?? 0,
    isMainOrMaster: data.isMainOrMaster ?? false,
    files: data.files ?? data.modifiedFiles ?? [],
  };
}

export async function apiCreateGitBranch(workspaceRoot: string, branchName: string): Promise<string> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    return await invoke<string>('create_git_branch', { workspaceRoot, branchName });
  }
  const res = await fetch('/api/git/branch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectRoot: workspaceRoot, branchName }) });
  const data = await res.json() as { success?: boolean; branch?: string; error?: string };
  if (!res.ok || !data.success || !data.branch) throw new Error(data.error ?? 'Failed to create git branch');
  return data.branch;
}

export async function apiGetGitDiff(workspaceRoot: string): Promise<string> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    return await invoke('get_git_diff', { workspaceRoot });
  }
  const res = await fetch(`/api/git/diff?workspace=${encodeURIComponent(workspaceRoot)}`);
  if (!res.ok) throw new Error('Failed to get git diff');
  const data = await res.json() as { diff?: string };
  return data.diff ?? '';
}
