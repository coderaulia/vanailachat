import { Hono } from 'hono';
import type { AppDependencies, ChatRequestBody } from '../types.js';
import { normalizeMessageContent, sanitizeError } from '../helpers/index.js';
import { getPersonaSystemPrompt, getPersonaToolAllowlist } from '../services/personas.js';
import type { LLMProvider } from '../services/provider.js';
import type { ChatRecord } from '../services/database.js';
import { ApprovalService, describeToolCall, isMutatingTool } from '../services/approvals.js';

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
  if (b.projectRoot !== undefined && b.projectRoot !== null && typeof b.projectRoot !== 'string')
    return 'projectRoot: must be string or null';
  if (Array.isArray(b.messages)) {
    for (const msg of b.messages) {
      if (!msg || typeof msg !== 'object') return 'messages[]: each item must be an object';
      if (typeof (msg as Record<string, unknown>).role !== 'string')
        return 'messages[].role: must be a string';
    }
  }
  return null;
}

function getRequestedProjectRoot(body: ChatRequestBody): string | null {
  return typeof body.projectRoot === 'string' && body.projectRoot.trim()
    ? body.projectRoot.trim()
    : null;
}

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Approval is on unless explicitly disabled, so an upgrade never silently
 * grants write access that did not exist before.
 */
function approvalsRequired(deps: AppDependencies): boolean {
  try {
    return deps.getSetting('require_tool_approval') !== 'false';
  } catch {
    return true;
  }
}

/** One-line summary for the skill index: stored description, else the first real line. */
function summarizeSkill(description: string | null, content: string): string {
  const fromDescription = description?.trim();
  if (fromDescription) {
    return fromDescription.slice(0, 200);
  }

  // Prefer the first prose line: a SKILL.md almost always opens with a heading
  // that just repeats the skill name, which tells the model nothing new.
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const prose = lines.find((line) => !line.startsWith('#'));
  const heading = lines[0]?.replace(/^#+\s*/, '');

  return (prose ?? heading ?? 'No description').slice(0, 200);
}

async function buildSystemPrompt(
  deps: AppDependencies,
  chatRecord: ChatRecord | null,
  body: ChatRequestBody,
  incomingMessages: Array<{ role: string; content: unknown }>,
): Promise<{ systemPrompt: string; personaToolAllowlist: string[] | null; skillsAvailable: boolean }> {
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
  const projectRoot = chatRecord?.projectRoot ?? getRequestedProjectRoot(body);
  if (projectRoot) {
    systemPrompt += `\n\n[Project Root]\n${projectRoot}`;
    try {
      const cacheId = chatRecord?.id ?? body.chatId ?? projectRoot;
      const listing = await getCachedDirListing(deps, cacheId, projectRoot);
      systemPrompt += `\n\n[Project Structure]\n${listing}`;
    } catch (error) {
      console.error(`[SYSTEM PROMPT] Failed to list directory: ${error}`);
    }
  }

  systemPrompt +=
    '\n\nFor coding requests with a Project Root, inspect the project with list_directory and read_file before answering. ' +
    'Call the provided tools; never print shell commands such as `ls` or `cat` as a substitute for a tool call.';

  // Enabled skills (via injected dep — no direct DB import).
  //
  // Progressive disclosure: only a name + one-line summary per skill goes into
  // the prompt, and the model pulls the full text with load_skill when it is
  // actually relevant. Inlining every SKILL.md cost ~8k tokens per request for
  // a single 32KB skill, on every message, whether or not it was needed — and
  // the unrelated instructions degraded answers as well as billing.
  //
  // Setting skills_inline='true' restores the old inline behaviour, which is
  // reasonable on local models where tokens are free and tool-calling is weak.
  let skillsAvailable = false;
  try {
    const enabledSkills = deps.listEnabledSkills();
    skillsAvailable = enabledSkills.length > 0;

    if (skillsAvailable) {
      const inlineSkills = deps.getSetting('skills_inline') === 'true';

      if (inlineSkills) {
        for (const skill of enabledSkills) {
          systemPrompt += `\n\n[Skill: ${skill.name}]\n${skill.content}`;
        }
      } else {
        const index = enabledSkills
          .map((skill) => `- ${skill.name}: ${summarizeSkill(skill.description, skill.content)}`)
          .join('\n');
        systemPrompt +=
          `\n\n[Available Skills]\n${index}\n\n` +
          'These are titles only — you have not been shown their contents. When one is ' +
          'relevant to the request, call load_skill with the exact name to read its ' +
          'instructions before answering. Never guess what a skill contains, and ignore ' +
          'skills unrelated to the current question.';
      }
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
  const personaToolAllowlist = getPersonaToolAllowlist(personaId) ?? null;

  // Memory — recall against the last user message, then store it.
  //
  // Vector search when an embedding backend is reachable, keyword search when
  // it is not. Cloud-only setups have no Ollama, so the old code embedded
  // nothing, stored nothing and recalled nothing — silently, forever. Memory
  // now degrades instead of disappearing.
  //
  // Skipped when the caller sets skipMemory (internal title generation) so
  // synthetic prompts don't pollute the store.
  const lastUserMsg = body.skipMemory
    ? undefined
    : incomingMessages.slice().reverse().find((m) => m.role === 'user');

  if (lastUserMsg) {
    const userText = normalizeMessageContent(lastUserMsg.content).content;
    if (userText.trim()) {
      try {
        const queryVec = isEmbedLikelyAvailable() ? await deps.embedOrNull(userText) : null;
        if (!queryVec) {
          markEmbedUnavailable();
        }

        const memories = queryVec
          ? deps.searchMemories(queryVec, 3, 0.3)
          : deps.searchMemoriesByKeyword(userText, 3, 0.2);

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
      } catch (error) {
        console.error(`[MEMORY] Recall/store failed: ${error}`);
      }
    }
  }

  return { systemPrompt, personaToolAllowlist, skillsAvailable };
}

export function resolveTools(
  allTools: Record<string, unknown>[],
  supportsTools: boolean,
  personaToolAllowlist: string[] | null,
  searchEnabled: boolean,
  skillsAvailable: boolean,
): Record<string, unknown>[] {
  if (!supportsTools) return [];

  const toolName = (t: Record<string, unknown>) =>
    (t as { function?: { name?: string } }).function?.name ?? '';

  let tools = [...allTools];

  // Offering load_skill with nothing to load only invites hallucinated calls.
  if (!skillsAvailable) {
    tools = tools.filter((t) => toolName(t) !== 'load_skill');
  }

  if (personaToolAllowlist && personaToolAllowlist.length > 0) {
    tools = tools.filter((t) => {
      // load_skill is how skills are reached at all, so a persona allowlist
      // must not strip it — the prompt advertises skills either way.
      const name = toolName(t);
      return personaToolAllowlist.includes(name) || (skillsAvailable && name === 'load_skill');
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

/**
 * Write the finished assistant reply straight from the server.
 *
 * Persistence used to be entirely client-driven: the browser POSTed the reply
 * after the stream ended, so closing the tab (or a crash) mid-answer lost text
 * the server had already produced in full. The client keeps saving — it owns
 * token counts and ordering — but both writes carry the same client-supplied
 * id and insertMessage upserts on it, so the two converge on one row instead
 * of duplicating.
 */
function persistAssistantReply(
  deps: AppDependencies,
  chatRecord: ChatRecord | null,
  body: ChatRequestBody,
  content: string,
): void {
  const chatId = typeof body.chatId === 'string' ? body.chatId : null;
  const messageId = typeof body.assistantMessageId === 'string' ? body.assistantMessageId : null;

  if (!chatId || !messageId || !content.trim()) return;

  try {
    // A brand-new chat has no row yet — the client upserts it only after the
    // stream finishes — and messages.chat_id is a foreign key.
    if (!chatRecord) {
      deps.upsertChat({
        id: chatId,
        projectId: (typeof body.projectId === 'string' && body.projectId) || 'default',
        title: content.slice(0, 50) || 'Untitled chat',
        projectRoot: getRequestedProjectRoot(body),
      });
    }

    deps.insertMessage({
      id: messageId,
      chatId,
      role: 'assistant',
      content,
    });
  } catch (error) {
    // Never fail the response over the safety net.
    console.error('[CHAT] Server-side reply persist failed:', error);
  }
}

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
  projectRoot: string | null,
  signal: AbortSignal,
  body: ChatRequestBody,
): Promise<void> {
  const currentMessages = [...initialMessages];
  // Tracked so an aborted stream denies anything still waiting instead of
  // leaving the promise (and the user's prompt) dangling.
  const pendingApprovalIds = new Set<string>();
  signal.addEventListener('abort', () => {
    ApprovalService.denyAll([...pendingApprovalIds]);
    pendingApprovalIds.clear();
  });

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

    if (!isToolCall) {
      persistAssistantReply(deps, chatRecord, body, assistantMessage.content);
      controller.close();
      return;
    }

    currentMessages.push(assistantMessage as AnyMessage);

    let skippedCount = 0;
    for (const tc of assistantMessage.tool_calls) {
      const toolName = tc.function?.name ?? 'unknown';
      const toolArgs = tc.function?.arguments;

      // Sort keys to prevent dedup misses from key-order differences
      const callKey = `${toolName}:${JSON.stringify(toolArgs ?? {}, Object.keys(toolArgs ?? {}).sort())}`;
      if (toolCallHistory.has(callKey)) { skippedCount++; continue; }
      toolCallHistory.add(callKey);

      // Gate anything that changes state behind an explicit decision. The
      // stream is one-way, so the request goes out as an event and the loop
      // parks on a promise the approval endpoint resolves.
      if (isMutatingTool(toolName) && approvalsRequired(deps)) {
        const approvalId = `apr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        pendingApprovalIds.add(approvalId);

        enqueue({
          approval_request: {
            id: approvalId,
            tool: toolName,
            summary: describeToolCall(toolName, toolArgs),
            details: (toolArgs ?? {}) as Record<string, unknown>,
          },
        });

        const approved = await ApprovalService.request(approvalId);
        pendingApprovalIds.delete(approvalId);
        enqueue({ approval_resolved: { id: approvalId, approved } });

        if (!approved) {
          // Reported back to the model so it can adjust rather than retry blindly.
          currentMessages.push({
            role: 'tool',
            content: `The user declined this ${toolName} call. Do not retry it; ask what to do differently.`,
          });
          enqueueToolEvent(toolName, 'error', 'Declined by user');
          continue;
        }
      }

      enqueueToolEvent(toolName, 'start');
      try {
        const result = await deps.executeTool(toolName, toolArgs, projectRoot);
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

  /**
   * Answer a pending tool-approval request.
   *
   * Separate from the streaming response because that connection is one-way:
   * the loop is parked on a promise this resolves.
   */
  app.post('/approve', async (context) => {
    let body: { id?: unknown; approved?: unknown };
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: 'Invalid JSON in request body' }, 400);
    }

    if (typeof body.id !== 'string' || typeof body.approved !== 'boolean') {
      return context.json({ error: 'id: required string, approved: required boolean' }, 400);
    }

    // Unknown ids are already-settled or timed-out requests, not errors.
    const settled = ApprovalService.resolve(body.id, body.approved);
    return context.json({ settled });
  });

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

      const { systemPrompt, personaToolAllowlist, skillsAvailable } = await buildSystemPrompt(
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
        skillsAvailable,
      );
      const projectRoot = chatRecord?.projectRoot ?? getRequestedProjectRoot(typedBody);

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
              projectRoot,
              context.req.raw.signal,
              typedBody,
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
