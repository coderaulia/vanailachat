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
  /** Desktop only: which chat this event belongs to. */
  chat_id?: string;
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
  projectRoot?: string | null;
  project_root?: string | null;
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
  archived?: boolean | number;
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
  versionOf?: string | null;
  version_of?: string | null;
  versionCount?: number;
  version_count?: number;
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

export async function apiCreateProject(payload: { id: string; name: string; description?: string; instructions?: string; projectRoot?: string }): Promise<ApiProjectDto> {
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
  payload: { name?: string; description?: string; instructions?: string; memory?: string; pinned?: boolean; projectRoot?: string | null }
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

/** Partial chat update: rename, pin, archive, prompt, root, model, role. */
export async function apiPatchChat(
  id: string,
  updates: {
    title?: string;
    projectId?: string | null;
    projectRoot?: string | null;
    systemPrompt?: string | null;
    model?: string | null;
    role?: string | null;
    pinned?: boolean;
    archived?: boolean;
    updatedAt?: number;
  },
): Promise<ApiChatDto> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    const chat = await invoke<ApiChatDto | null>('update_chat', { id, patch: updates });
    if (!chat) throw new Error(`Chat ${id} not found`);
    return chat;
  }
  const data = await requestApi<{ chat?: ApiChatDto }>(`/api/chats/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!data.chat) throw new Error('Missing chat in response');
  return data.chat;
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

/** Answers a parked tool-call approval request. */
export async function apiRespondToApproval(id: string, approved: boolean): Promise<void> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    await invoke('approve_tool', { id, approved });
    return;
  }
  await requestApi('/api/chat/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, approved }),
  });
}

/** One message-body hit from full-text search; same shape on web and desktop. */
export interface MessageSearchHit {
  chatId: string;
  chatTitle: string;
  projectId?: string | null;
  messageId: string;
  role: string;
  snippet: string;
  createdAt: number;
}

export async function apiSearchMessages(query: string, projectId?: string, signal?: AbortSignal): Promise<MessageSearchHit[]> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    return await invoke<MessageSearchHit[]>('search_messages', { query, projectId: projectId ?? null });
  }
  const scope = projectId ? `&projectId=${encodeURIComponent(projectId)}` : '';
  const data = await requestApi<{ results?: MessageSearchHit[] }>(
    `/api/messages/search?q=${encodeURIComponent(query)}${scope}`,
    { signal },
  );
  return data.results ?? [];
}

/** Current rating for a message: 1, -1, 0, or null when never rated. */
export async function apiGetFeedback(messageId: string): Promise<number | null> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    const feedback = await invoke<{ rating: number } | null>('get_feedback', { messageId });
    return feedback?.rating ?? null;
  }
  const data = await requestApi<{ feedback: { rating: number } | null }>(`/api/messages/${encodeURIComponent(messageId)}/feedback`);
  return data.feedback?.rating ?? null;
}

export async function apiSetFeedback(messageId: string, rating: number): Promise<void> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    await invoke('set_feedback', { payload: { message_id: messageId, rating } });
    return;
  }
  await requestApi(`/api/messages/${encodeURIComponent(messageId)}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating }),
  });
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
  versionOf?: string | null;
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
        version_of: payload.versionOf ?? null,
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
      versionOf: payload.versionOf ?? null,
    }),
  });
  return data.message ?? (payload as ApiMessageDto);
}

/** Hides a message and everything after it, before a regenerate or edit re-sends. */
export async function apiSupersedeMessages(chatId: string, fromMessageId: string): Promise<number> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    return await invoke<number>('supersede_messages', { chatId, fromMessageId });
  }
  const data = await requestApi<{ superseded: number }>('/api/messages/supersede', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, fromMessageId }),
  });
  return data.superseded;
}

export interface MessageVersionDto {
  id: string;
  content: string;
  createdAt: number;
  current: boolean;
}

/** Every answer in a message's regenerate group, oldest first. */
export async function apiFetchMessageVersions(messageId: string): Promise<MessageVersionDto[]> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    return await invoke<MessageVersionDto[]>('get_message_versions', { messageId });
  }
  const data = await requestApi<{ versions?: MessageVersionDto[] }>(`/api/messages/${encodeURIComponent(messageId)}/versions`);
  return data.versions ?? [];
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

/** Names of every model the configured providers can serve (used by "Test connection"). */
export async function apiListModelNames(): Promise<string[]> {
  if (isTauri) {
    return (await apiFetchModels()).map((model) => model.name);
  }
  const data = await requestApi<{ models?: string[] }>('/api/models');
  return Array.isArray(data.models) ? data.models : [];
}

export interface CodingHarnessStatus {
  id: string;
  label: string;
  available: boolean;
  reason?: string;
}

/** Whether each web coding harness can run here. The desktop app has its own built-in agent, so it reports none. */
export async function apiFetchCodingHarnesses(): Promise<CodingHarnessStatus[]> {
  if (isTauri) return [];
  const data = await requestApi<{ harnesses?: CodingHarnessStatus[] }>('/api/coding/harnesses');
  return Array.isArray(data.harnesses) ? data.harnesses : [];
}

/** Which provider serves each model; "Test connection" uses it to check only the provider being edited. */
export async function apiListModelProviders(): Promise<Array<{ name: string; provider: string }>> {
  if (isTauri) {
    return (await apiFetchModels()).map(({ name, provider }) => ({ name, provider }));
  }
  const data = await requestApi<{ providers?: Array<{ name: string; provider: string }> }>('/api/models');
  return Array.isArray(data.providers) ? data.providers : [];
}

/** One line of Ollama's pull progress. */
export interface PullProgress {
  status?: string;
  digest?: string;
  completed?: number;
  total?: number;
  error?: string;
}

/**
 * Downloads an Ollama model, reporting Ollama's progress lines as they
 * arrive. Rejects on an `error` line, so a bad name does not look like success.
 */
export async function apiPullModel(
  name: string,
  onProgress?: (progress: PullProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    const { listen } = await getTauriEvent();

    let unlisten: (() => void) | null = null;
    if (onProgress) {
      unlisten = await listen('ollama-pull-progress', (event) => {
        onProgress(event.payload as PullProgress);
      });
    }

    try {
      await invoke('pull_model', { name });
    } finally {
      if (unlisten) unlisten();
    }
    return;
  }

  const response = await fetch('/api/models/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
    signal,
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error || `Pull failed (HTTP ${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const handleLine = (line: string) => {
    if (!line.trim()) return;
    let progress: PullProgress;
    try {
      progress = JSON.parse(line) as PullProgress;
    } catch {
      return;
    }
    if (progress.error) throw new Error(progress.error);
    onProgress?.(progress);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    lines.forEach(handleLine);
  }
  handleLine(buffer);
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
  includeDistillation?: boolean;
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
    body: JSON.stringify({
      format: request.format,
      selectedIds: request.selectedIds,
      includeDistillation: request.includeDistillation ?? false,
    }),
  });
}

export interface CodingSessionDto {
  chatId: string;
  harness: string;
  harnessSessionId?: string | null;
  workspacePath: string;
  status: string;
  createdAt: number;
  updatedAt: number;
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

/**
 * Runs a desktop command that streams `chat-stream` events for one chat. Events are
 * tagged with their chat, so a second chat streaming at the same time cannot write
 * into this one's message. Resolves when the command does; a failure rejects.
 */
async function invokeChatStream(
  command: string,
  payload: Record<string, unknown>,
  chatId: string | undefined,
  onChunk: (chunk: StreamChunk) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { invoke } = await getTauriCore();
  const { listen } = await getTauriEvent();

  const unlisten = await listen<StreamChunk>('chat-stream', (event) => {
    const chunk = event.payload;
    if (chatId && chunk.chat_id && chunk.chat_id !== chatId) return;
    onChunk(chunk);
  });
  const abortHandler = () => { invoke('cancel_chat', { chatId: chatId ?? null }).catch(() => {}); };
  signal?.addEventListener('abort', abortHandler, { once: true });

  try {
    await invoke(command, payload);
  } catch (error) {
    if (signal?.aborted) return;
    throw commandError(error, 'Chat failed');
  } finally {
    unlisten();
    signal?.removeEventListener('abort', abortHandler);
  }
}

/**
 * One coding turn in the session's workspace: the desktop app's own agent, which
 * streams the same text, tool and approval events as a chat.
 */
export async function runNativeCoding(
  request: { chatId: string; prompt: string; model: string; history?: Array<{ role: string; content: string }> },
  onChunk: (chunk: StreamChunk) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!isTauri) throw new Error('Native coding is only available in Tauri');
  await invokeChatStream(
    'run_coding',
    { request: { chat_id: request.chatId, prompt: request.prompt, model: request.model, history: request.history ?? [] } },
    request.chatId,
    onChunk,
    signal,
  );
}

// ── Streaming Chat Completions ────────────────────────────────────────

type ContentPart = string | { type?: string; text?: string; image_url?: { url?: string } };

/** Desktop messages carry plain text plus a separate list of images. */
export function toNativeMessage(message: ChatStreamRequest['messages'][number]) {
  const { content, ...rest } = message;
  if (typeof content === 'string') return { ...rest, content };
  const parts: ContentPart[] = Array.isArray(content) ? content : [String(content ?? '')];
  const text = parts
    .map((part) => (typeof part === 'string' ? part : part.text ?? ''))
    .filter(Boolean)
    .join('\n');
  const images = parts
    .map((part) => (typeof part === 'string' ? undefined : part.image_url?.url))
    .filter((url): url is string => Boolean(url));
  return { ...rest, content: text, ...(images.length > 0 ? { images } : {}) };
}

/**
 * One non-streaming completion (chat titles and the like). Skips the profile,
 * memories and tools. Returns the reply text, or null when it fails.
 */
export async function apiChatOnce(model: string, prompt: string): Promise<string | null> {
  try {
    if (isTauri) {
      const { invoke } = await getTauriCore();
      return await invoke<string>('chat_once', { request: { model, messages: [{ role: 'user', content: prompt }], skip_memory: true } });
    }
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], stream: false, skipMemory: true }),
    });
    if (!response.ok) return null;
    const data = await response.json() as Record<string, unknown>;
    // Ollama and OpenAI response shapes
    const ollama = (data as { message?: { content?: string } }).message?.content;
    const openai = (data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content;
    return ollama ?? openai ?? null;
  } catch {
    return null;
  }
}


export async function streamChatCompletion(
  body: ChatStreamRequest,
  onChunk: (chunk: StreamChunk) => void,
  signal?: AbortSignal
): Promise<void> {
  if (isTauri) {
    const { systemPrompt, maxTokens, ...nativeRequest } = body;
    const nativeBody = {
      ...nativeRequest,
      messages: body.messages.map(toNativeMessage),
      system_prompt: systemPrompt,
      max_tokens: maxTokens,
    };
    // Resolves when the reply is complete; a provider error rejects.
    await invokeChatStream('start_chat', { request: nativeBody }, body.chatId, onChunk, signal);
    return;
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

export interface ResearchStreamRequest {
  query: string;
  model: string;
  maxSources?: number;
  depth?: 'quick' | 'standard' | 'deep';
  /** Identifies this run so the desktop app can cancel it and route its events. */
  researchId?: string;
}

/** Streams the stage events (`searching` … `chunk` … `done`) of a research run. */
export async function streamResearch(
  request: ResearchStreamRequest,
  onEvent: (event: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    const { listen } = await getTauriEvent();
    const id = request.researchId;

    const unlisten = await listen<Record<string, unknown>>('research-stage', (event) => {
      if (id && event.payload.chat_id && event.payload.chat_id !== id) return;
      onEvent(event.payload);
    });
    const abortHandler = () => { invoke('cancel_chat', { chatId: id ?? null }).catch(() => {}); };
    signal?.addEventListener('abort', abortHandler, { once: true });
    try {
      // Resolves once the report is complete; failures arrive as an `error` stage.
      await invoke('start_research', {
        request: { query: request.query, model: request.model, max_sources: request.maxSources, depth: request.depth, research_id: id },
      });
    } catch (error) {
      if (!signal?.aborted) throw commandError(error, 'Research failed');
    } finally {
      unlisten();
      signal?.removeEventListener('abort', abortHandler);
    }
    return;
  }

  const { researchId: _researchId, ...body } = request;
  const response = await fetch('/api/research', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) throw new Error((await response.text().catch(() => '')) || `Research request failed: ${response.status}`);

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

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
        onEvent(JSON.parse(trimmed));
      } catch {
        // ignore malformed line
      }
    }
  }
}

// ── A/B comparison ────────────────────────────────────────────────────

export interface AbRunRequest {
  prompt: string;
  modelA: string;
  modelB: string;
  systemPrompt?: string;
  search?: boolean;
  deepResearch?: boolean;
  attachments?: Array<{ type?: string; name?: string; content?: string }>;
}

export interface AbSideResult {
  model: string;
  content: string;
  latencyMs: number;
}

export interface AbPickRequest {
  userContent: string;
  winnerContent: string;
  winnerModel: string;
  loserModel?: string;
}

async function postJson<T>(url: string, body: unknown, fallback: string): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `${fallback} (HTTP ${response.status})`);
  return data;
}

export async function apiRunAb(request: AbRunRequest): Promise<{ a: AbSideResult; b: AbSideResult }> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    try {
      return await invoke('run_ab', { request });
    } catch (error) {
      throw commandError(error, 'Comparison failed');
    }
  }
  return postJson('/api/ab', request, 'Comparison failed');
}

export async function apiPickAb(pick: AbPickRequest): Promise<{ chatId: string; messageId: string }> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    try {
      return await invoke('pick_ab', { pick });
    } catch (error) {
      throw commandError(error, 'Failed to save pick');
    }
  }
  return postJson('/api/ab/pick', pick, 'Failed to save pick');
}

// ── Attachments & folders ─────────────────────────────────────────────

export interface ExtractedDocument {
  name?: string;
  kind?: string;
  characters?: number;
  text?: string;
}

/** Unpacks a .docx/.xlsx/.pdf into plain text for the model. */
export async function apiExtractAttachment(file: File): Promise<ExtractedDocument> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    try {
      // The bytes go as the raw request body; the name rides in a header.
      return await invoke<ExtractedDocument>('extract_attachment', new Uint8Array(await file.arrayBuffer()), {
        headers: { 'x-file-name': encodeURIComponent(file.name), 'x-file-type': file.type },
      });
    } catch (error) {
      throw commandError(error, 'Extraction failed');
    }
  }
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch('/api/attachments/extract', { method: 'POST', body: formData });
  const data = (await response.json().catch(() => ({}))) as ExtractedDocument & { error?: string };
  if (!response.ok) throw new Error(data.error ?? 'Extraction failed');
  return data;
}

export interface DirectoryListing {
  path: string;
  parent: string | null;
  directories: Array<{ name: string; path: string }>;
  drives: string[];
  home: string;
}

export async function apiBrowseDirectory(target?: string): Promise<DirectoryListing> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    try {
      return await invoke<DirectoryListing>('browse_directory', { path: target ?? null });
    } catch (error) {
      throw commandError(error, 'Unable to read that folder');
    }
  }
  const query = target ? `?path=${encodeURIComponent(target)}` : '';
  const response = await fetch(`/api/fs/browse${query}`);
  const data = (await response.json().catch(() => ({}))) as DirectoryListing & { error?: string };
  if (!response.ok) throw new Error(data.error ?? 'Unable to read that folder');
  return data;
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

// ── Desktop integration ───────────────────────────────────────────────

export interface UpdateInfo {
  current: string;
  latest: string;
  available: boolean;
  url: string;
}

/** Desktop only: compares this build with the latest GitHub release. */
export async function apiCheckForUpdate(): Promise<UpdateInfo | null> {
  if (!isTauri) return null;
  const { invoke } = await getTauriCore();
  return await invoke<UpdateInfo>('check_for_update');
}

/** Opens a link in the system browser (desktop) or a new tab (web). */
export async function apiOpenExternal(url: string): Promise<void> {
  if (isTauri) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Desktop only: runs `handler` when the tray menu asks for a new chat. Returns an unsubscribe. */
export async function onDesktopNewChat(handler: () => void): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await getTauriEvent();
  return await listen('vanaila://new-chat', handler);
}

// ── Skills ────────────────────────────────────────────────────────────

export interface SkillCatalogEntry {
  name: string;
  rawUrl: string;
  installed: boolean;
  enabled: boolean;
  id: string | null;
  description: string | null;
}

/** Turns a rejected desktop command (a plain string) into an Error. */
function commandError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === 'string' && error ? error : fallback);
}

export async function apiFetchSkillCatalog(): Promise<SkillCatalogEntry[]> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    return await invoke<SkillCatalogEntry[]>('get_skill_catalog');
  }
  const data = await requestApi<{ catalog: SkillCatalogEntry[] }>('/api/skills/catalog');
  return data.catalog;
}

export async function apiInstallSkill(name: string): Promise<void> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    try {
      await invoke('install_catalog_skill', { name });
    } catch (error) {
      throw commandError(error, 'Install failed');
    }
    return;
  }
  await requestApi('/api/skills/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function apiInstallCustomSkill(content: string): Promise<void> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    try {
      await invoke('install_custom_skill', { content });
    } catch (error) {
      throw commandError(error, 'Upload failed');
    }
    return;
  }
  await requestApi('/api/skills/custom', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

export async function apiSetSkillEnabled(id: string, enabled: boolean): Promise<void> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    await invoke('set_skill_enabled', { id, enabled });
    return;
  }
  await requestApi(`/api/skills/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
}

export async function apiDeleteSkill(id: string): Promise<void> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    await invoke('delete_skill', { id });
    return;
  }
  await requestApi(`/api/skills/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ── Memories ──────────────────────────────────────────────────────────

export interface MemoryEntryDto {
  id: string;
  type: string;
  content: string;
  embedding: string;
  metadata: string | null;
  sourceId: string | null;
  createdAt: number;
}

export async function apiFetchMemories(): Promise<MemoryEntryDto[]> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    return await invoke<MemoryEntryDto[]>('get_memories');
  }
  const data = await requestApi<{ memories?: MemoryEntryDto[] }>('/api/memory');
  return data.memories ?? [];
}

export async function apiAddMemory(content: string): Promise<MemoryEntryDto> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    try {
      return await invoke<MemoryEntryDto>('add_memory', { payload: { content, type: 'manual' } });
    } catch (error) {
      throw commandError(error, 'Could not save memory');
    }
  }
  const data = await requestApi<{ memory: MemoryEntryDto }>('/api/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, type: 'manual' }),
  });
  return data.memory;
}

export async function apiDeleteMemory(id: string): Promise<void> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    await invoke('delete_memory', { id });
    return;
  }
  await requestApi(`/api/memory/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Forgets every memory; chats are untouched. */
export async function apiClearMemories(): Promise<void> {
  if (isTauri) {
    const { invoke } = await getTauriCore();
    await invoke('clear_memories');
    return;
  }
  await requestApi('/api/memory', { method: 'DELETE' });
}
