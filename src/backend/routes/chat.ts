import { Hono } from 'hono';
import type { AppDependencies, ChatRequestBody } from '../types.js';
import { normalizeMessageContent, sanitizeError } from '../helpers/index.js';
import { getPersonaSystemPrompt, getPersonaToolAllowlist } from '../services/personas.js';
import type { LLMProvider } from '../services/provider.js';
import type { ChatRecord } from '../services/database.js';

// ── caches ────────────────────────────────────────────────────────────────────

/**
 * Cache list_directory output per (chatId, projectRoot, depth) so we don't
 * walk the project tree on every chat turn. Refreshed when TTL expires.
 */
interface DirCacheEntry { listing: string; expiresAt: number }
const dirListingCache = new Map<string, DirCacheEntry>();
const DIR_CACHE_TTL_MS = 5 * 60_000;
const DIR_CACHE_MAX_ENTRIES = 200;

async function getCachedDirListing(
  deps: AppDependencies,
  chatId: string,
  projectRoot: string,
): Promise<string> {
  const key = `${chatId}::${projectRoot}::2`;
  const now = Date.now();
  const hit = dirListingCache.get(key);
  if (hit && hit.expiresAt > now) return hit.listing;

  const listing = await deps.executeTool('list_directory', { path: '.', maxDepth: 2 }, projectRoot);
  dirListingCache.set(key, { listing, expiresAt: now + DIR_CACHE_TTL_MS });

  // Bound cache size. Sweeping only expired entries left the map unbounded
  // whenever every entry was still live, so fall back to evicting the oldest.
  if (dirListingCache.size > DIR_CACHE_MAX_ENTRIES) {
    for (const [k, v] of dirListingCache) {
      if (v.expiresAt <= now) dirListingCache.delete(k);
    }
    // Map preserves insertion order — drop the stalest keys first.
    for (const k of dirListingCache.keys()) {
      if (dirListingCache.size <= DIR_CACHE_MAX_ENTRIES) break;
      dirListingCache.delete(k);
    }
  }
  return listing;
}

/**
 * Cache whether the embedding model is available so a single missing-model
 * failure doesn't add ~100ms+ DNS/HTTP latency to every chat turn.
 * Re-checks every EMBED_AVAIL_TTL_MS so a later `ollama pull` is noticed.
 */
let embedAvailableUntil = 0;
let embedAvailable = true;
const EMBED_AVAIL_TTL_MS = 60_000;
function markEmbedUnavailable() {
  embedAvailable = false;
  embedAvailableUntil = Date.now() + EMBED_AVAIL_TTL_MS;
}
function isEmbedLikelyAvailable(): boolean {
  if (embedAvailable) return true;
  if (Date.now() > embedAvailableUntil) {
    embedAvailable = true;
    return true;
  }
  return false;
}

// ── validation ────────────────────────────────────────────────────────────────

function validateChatRequest(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'Request body must be a JSON object';
  const b = body as Record<string, unknown>;
  if (!b.model || typeof b.model !== 'string') return 'model: required string';
  if (b.messages !== undefined && !Array.isArray(b.messages)) return 'messages: must be an array';
  if (b.stream !== undefined && typeof b.stream !== 'boolean') return 'stream: must be boolean';
  if (b.search !== undefined && typeof b.search !== 'boolean') return 'search: must be boolean';
  if (b.skipMemory !== undefined && typeof b.skipMemory !== 'boolean') return 'skipMemory: must be boolean';
  if (b.chatId !== undefined && b.chatId !== null && typeof b.chatId !== 'string')
    return 'chatId: must be string';
  if (Array.isArray(b.messages)) {
    for (const msg of b.messages) {
      if (!msg || typeof msg !== 'object') return 'messages[]: each item must be an object';
      if (typeof (msg as Record<string, unknown>).role !== 'string')
        return 'messages[].role: must be a string';
    }
  }
  return null;
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function buildSystemPrompt(
  deps: AppDependencies,
  chatRecord: ChatRecord | null,
  body: ChatRequestBody,
  incomingMessages: Array<{ role: string; content: unknown }>,
): Promise<{ systemPrompt: string; personaToolAllowlist: string[] | null }> {
  let systemPrompt = 'You are a helpful assistant.';

  // User profile from onboarding/settings. Without this the model has no idea
  // who it is talking to — the profile is stored in settings but was never
  // reaching the prompt. Skipped for synthetic calls (title generation).
  if (!body.skipMemory) {
    try {
      const userName = deps.getSetting('user_name')?.trim();
      const userRole = deps.getSetting('user_role')?.trim();
      const baseInstructions = deps.getSetting('base_instructions')?.trim();

      const profile: string[] = [];
      if (userName) profile.push(`Name: ${userName}`);
      if (userRole) profile.push(`Role: ${userRole}`);
      if (profile.length > 0) {
        systemPrompt += `\n\n[User Profile]\nYou are talking to:\n${profile.join('\n')}`;
      }
      if (baseInstructions) {
        systemPrompt += `\n\n[User Preferences]\n${baseInstructions}`;
      }
    } catch (error) {
      console.error(`[SYSTEM PROMPT] Failed to load user profile: ${error}`);
    }
  }

  // Project-level instructions + memory
  if (chatRecord?.projectId) {
    const project = deps.getProject(chatRecord.projectId);
    if (project) {
      if (project.instructions?.trim()) {
        systemPrompt += `\n\n[Project Instructions]\n${project.instructions}`;
      }
      if (project.memory?.trim()) {
        systemPrompt += `\n\n[Shared Project Memory]\n${project.memory}`;
      }
    }
  }

  // Chat-specific system prompt
  const chatPrompt = chatRecord?.systemPrompt ?? null;
  if (chatPrompt?.trim()) {
    systemPrompt += `\n\n[Chat-Specific Instructions]\n${chatPrompt}`;
  }

  if (body.search) {
    systemPrompt +=
      '\n\nWeb search is enabled. ALWAYS use search_web if the user asks for real-time information, news, or facts you are unsure about.';
  }

  // Project root + directory listing (cached per chat for 5 min)
  if (chatRecord?.projectRoot) {
    systemPrompt += `\n\n[Project Root]\n${chatRecord.projectRoot}`;
    try {
      const listing = await getCachedDirListing(deps, chatRecord.id, chatRecord.projectRoot);
      systemPrompt += `\n\n[Project Structure]\n${listing}`;
    } catch (error) {
      console.error(`[SYSTEM PROMPT] Failed to list directory: ${error}`);
    }
  }

  systemPrompt += '\n\nYou can also read local project files using read_file.';

  // Enabled skills (via injected dep — no direct DB import)
  try {
    const enabledSkills = deps.listEnabledSkills();
    for (const skill of enabledSkills) {
      systemPrompt += `\n\n[Skill: ${skill.name}]\n${skill.content}`;
    }
  } catch {
    // DB unavailable — skip
  }

  // Persona (only when no saved chat system prompt)
  const personaId = (body as Record<string, unknown>).persona as string | undefined;
  if (!chatPrompt?.trim()) {
    const personaPrompt = getPersonaSystemPrompt(personaId);
    if (personaPrompt) systemPrompt += `\n\n${personaPrompt}`;
  }
  const personaToolAllowlist = getPersonaToolAllowlist(personaId);

  // Vector memory — embed last user message, search + auto-save.
  // Skipped when caller sets skipMemory (e.g. internal title-generation calls)
  // so synthetic prompts don't pollute the vector store.
  const lastUserMsg = !body.skipMemory && isEmbedLikelyAvailable()
    ? incomingMessages.slice().reverse().find((m) => m.role === 'user')
    : undefined;
  if (lastUserMsg) {
    const userText = normalizeMessageContent(lastUserMsg.content).content;
    if (userText.trim()) {
      try {
        const queryVec = await deps.embed(userText);

        const memories = deps.searchMemories(queryVec, 3, 0.3);
        if (memories.length > 0) {
          const block = memories
            .map((m, i) => `[Memory ${i + 1} (relevance: ${m.score})] ${m.content}`)
            .join('\n\n');
          systemPrompt += `\n\n[Relevant Memories]\n${block}`;
        }

        if (userText.trim().length >= 20) {
          deps.upsertMemory({
            type: 'conversation',
            content: userText.slice(0, 4000),
            embedding: queryVec,
            metadata: JSON.stringify({
              role: 'user',
              chatId: body.chatId ?? null,
              chatTitle: chatRecord?.title ?? null,
            }),
            sourceId: (body.chatId as string | null) ?? null,
          });
        }
      } catch {
        // Embedding model unavailable — flag so subsequent turns skip the call
        // entirely until the TTL expires.
        markEmbedUnavailable();
      }
    }
  }

  return { systemPrompt, personaToolAllowlist };
}

function resolveTools(
  allTools: Record<string, unknown>[],
  supportsTools: boolean,
  personaToolAllowlist: string[] | null,
  searchEnabled: boolean,
): Record<string, unknown>[] {
  if (!supportsTools) return [];

  let tools = [...allTools];

  if (personaToolAllowlist && personaToolAllowlist.length > 0) {
    tools = tools.filter((t) => {
      const fn = (t as { function?: { name?: string } }).function;
      return personaToolAllowlist.includes(fn?.name ?? '');
    });
  }

  if (!searchEnabled) {
    tools = tools.filter((t) => {
      const fn = (t as { function?: { name?: string } }).function;
      return fn?.name !== 'search_web';
    });
  }

  return tools;
}

type AnyMessage = { role: string; content: unknown; tool_calls?: unknown[] };

async function runAgentLoop(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  decoder: TextDecoder,
  provider: LLMProvider,
  modelName: string,
  initialMessages: AnyMessage[],
  tools: Record<string, unknown>[],
  deps: AppDependencies,
  chatRecord: ChatRecord | null,
  signal: AbortSignal,
): Promise<void> {
  const currentMessages = [...initialMessages];
  let iteration = 0;
  const maxIterations = 7;
  const toolCallHistory = new Set<string>();

  const enqueue = (obj: unknown) => {
    try {
      controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
    } catch {
      // stream closed
    }
  };

  const enqueueToolEvent = (name: string, status: 'start' | 'done' | 'error', detail?: string) => {
    enqueue({
      tool_event: true,
      iteration,
      tool: name,
      status,
      ...(detail ? { detail: detail.slice(0, 200) } : {}),
    });
  };

  while (iteration < maxIterations) {
    iteration++;

    const upstreamResponse = await provider.chatStream(
      {
        model: modelName,
        messages: currentMessages,
        stream: true,
        tools: tools.length > 0 ? tools : undefined,
      } as Parameters<typeof provider.chatStream>[0],
      signal,
    );

    if (!upstreamResponse.ok) throw new Error(await upstreamResponse.text());
    if (!upstreamResponse.body) throw new Error('No stream body from provider');

    const reader = upstreamResponse.body.getReader();
    let isToolCall = false;
    let streamBuffer = '';
    const assistantMessage: {
      role: string;
      content: string;
      tool_calls: Array<{ id?: string; function?: { name?: string; arguments?: unknown }; type?: string }>;
    } = { role: 'assistant', content: '', tool_calls: [] };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      streamBuffer += decoder.decode(value, { stream: true });
      const lines = streamBuffer.split('\n');
      streamBuffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        let data: { message?: { content?: string; tool_calls?: unknown[] } };
        try {
          data = JSON.parse(line);
        } catch (parseError) {
          console.warn('[CHAT] Skipping malformed stream line:', parseError instanceof Error ? parseError.message : 'unknown');
          continue;
        }
        if (data.message?.tool_calls) {
          isToolCall = true;
          assistantMessage.tool_calls = data.message.tool_calls as typeof assistantMessage.tool_calls;
        }
        if (data.message?.content) assistantMessage.content += data.message.content;
        if (!isToolCall) controller.enqueue(encoder.encode(line + '\n'));
      }
    }

    if (streamBuffer.trim()) {
      try {
        const data = JSON.parse(streamBuffer);
        if (data.message?.tool_calls) {
          isToolCall = true;
          assistantMessage.tool_calls = data.message.tool_calls;
        }
        if (!isToolCall) controller.enqueue(encoder.encode(streamBuffer + '\n'));
      } catch (parseError) {
        console.warn('[CHAT] Skipping malformed trailing stream buffer:', parseError instanceof Error ? parseError.message : 'unknown');
      }
    }

    if (!isToolCall) { controller.close(); return; }

    currentMessages.push(assistantMessage as AnyMessage);

    let skippedCount = 0;
    for (const tc of assistantMessage.tool_calls) {
      const toolName = tc.function?.name ?? 'unknown';
      const toolArgs = tc.function?.arguments;

      // Sort keys to prevent dedup misses from key-order differences
      const callKey = `${toolName}:${JSON.stringify(toolArgs ?? {}, Object.keys(toolArgs ?? {}).sort())}`;
      if (toolCallHistory.has(callKey)) { skippedCount++; continue; }
      toolCallHistory.add(callKey);

      enqueueToolEvent(toolName, 'start');
      try {
        const result = await deps.executeTool(toolName, toolArgs, chatRecord?.projectRoot ?? null);
        currentMessages.push({ role: 'tool', content: result });
        enqueueToolEvent(toolName, 'done', typeof result === 'string' ? result.slice(0, 200) : '');
      } catch (toolErr) {
        const errMsg = toolErr instanceof Error ? toolErr.message : 'Unknown error';
        currentMessages.push({ role: 'tool', content: `Error: ${errMsg}` });
        enqueueToolEvent(toolName, 'error', errMsg);
      }
    }

    if (skippedCount > 0) {
      enqueueToolEvent('dedup', 'done', `Skipped ${skippedCount} duplicate tool call(s)`);
    }
  }

  enqueue({
    message: {
      role: 'assistant',
      content: `\n\n*Agent looped ${maxIterations} times without finishing. Please simplify your request.*`,
    },
    done: true,
  });
  controller.close();
}

// ── router ─────────────────────────────────────────────────────────────────────

export function chatRouter(dependencies: AppDependencies): Hono {
  const app = new Hono();

  app.post('/', async (context) => {
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: 'Invalid JSON in request body' }, 400);
    }

    const validationError = validateChatRequest(body);
    if (validationError) return context.json({ error: validationError }, 400);

    const typedBody = body as ChatRequestBody;

    try {
      const { provider, modelName } = dependencies.providerRegistry.resolveModel(typedBody.model!);

      const isAvailable = await dependencies.providerRegistry.isModelAvailableCached(
        provider,
        modelName,
      );
      if (!isAvailable) {
        return context.json(
          { error: `Model '${modelName}' is not available on provider '${provider.id}'.` },
          400,
        );
      }

      const clientWantsStreaming = typedBody.stream !== false;
      const chatRecord =
        typeof typedBody.chatId === 'string' && typedBody.chatId
          ? dependencies.getChat(typedBody.chatId)
          : null;
      const incomingMessages = Array.isArray(typedBody.messages) ? typedBody.messages : [];

      // Auto-positive heuristic: if the previous assistant reply in this chat
      // is long and unrated, give it an implicit +1 now that the user is
      // continuing the conversation (continuation is a signal of satisfaction).
      // Fire-and-forget — never blocks the current request.
      if (!typedBody.skipMemory && chatRecord) {
        (async () => {
          try {
            const minTokens = (() => {
              const raw = process.env.AUTO_POSITIVE_MIN_TOKENS;
              const n = raw ? Number.parseInt(raw, 10) : NaN;
              return Number.isFinite(n) && n > 0 ? n : 200;
            })();
            const autoRated = dependencies.autoPositiveForChat(chatRecord.id, minTokens);
            if (autoRated && isEmbedLikelyAvailable()) {
              const embedding = await dependencies.embed(autoRated.content.slice(0, 4000));
              dependencies.upsertMemory({
                type: 'assistant_positive',
                content: autoRated.content.slice(0, 4000),
                embedding,
                metadata: JSON.stringify({
                  role: 'assistant',
                  rating: 1,
                  implicit: true,
                  messageId: autoRated.messageId,
                  chatId: autoRated.chatId,
                }),
                sourceId: autoRated.chatId,
              });
            }
          } catch (err) {
            console.warn('[AUTO-POSITIVE] failed:', err instanceof Error ? err.message : err);
          }
        })();
      }

      const { systemPrompt, personaToolAllowlist } = await buildSystemPrompt(
        dependencies,
        chatRecord,
        typedBody,
        incomingMessages,
      );

      const messages: AnyMessage[] = [
        { role: 'system', content: systemPrompt },
        ...incomingMessages.map((message) => {
          const normalized = normalizeMessageContent(message.content);
          return {
            role: message.role,
            content: normalized.content,
            ...(normalized.images ? { images: normalized.images } : {}),
          };
        }),
      ];

      const modelDetails = (await dependencies.providerRegistry.getModelDetailsCached(
        provider,
        modelName,
      )) as {
        capabilities?: string[];
      } | null;
      const capabilities = modelDetails?.capabilities ?? [];
      const tools = resolveTools(
        dependencies.getToolDefinitions() as Record<string, unknown>[],
        capabilities.includes('tools'),
        personaToolAllowlist,
        typedBody.search ?? false,
      );

      // Non-streaming path
      if (!clientWantsStreaming) {
        const payload = await provider.chat(
          {
            model: modelName,
            messages,
            stream: false,
            tools: tools.length > 0 ? tools : undefined,
          } as Parameters<typeof provider.chat>[0],
          context.req.raw.signal,
        );
        return context.json(payload);
      }

      // Streaming path with agentic tool loop
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      const stream = new ReadableStream({
        async start(controller) {
          try {
            await runAgentLoop(
              controller,
              encoder,
              decoder,
              provider,
              modelName,
              messages,
              tools,
              dependencies,
              chatRecord,
              context.req.raw.signal,
            );
          } catch (err) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const error = err as any;
            if (error.name === 'AbortError' || error.code === 'ERR_INVALID_STATE') return;
            console.error('[CHAT ERROR]', err);
            try { controller.error(err); } catch { /* ignore */ }
          }
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return new Response(null);
      const message = sanitizeError(error, 'Unknown error');
      console.error(`[CHAT ERROR] ${message}`);
      return context.json({ error: message }, 500);
    }
  });

  return app;
}
