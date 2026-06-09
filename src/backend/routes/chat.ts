import { Hono } from 'hono';
import type { AppDependencies, ChatRequestBody } from '../types.js';
import { normalizeMessageContent } from '../helpers/index.js';
import { getPersonaSystemPrompt, getPersonaToolAllowlist } from '../services/personas.js';
import { DatabaseService } from '../services/database.js';
import { EmbeddingService } from '../services/embedding.js';
import type { LLMProvider } from '../services/provider.js';
import type { ChatRecord } from '../services/database.js';

// ── helpers ───────────────────────────────────────────────────────────────────

async function buildSystemPrompt(
  deps: AppDependencies,
  chatRecord: ChatRecord | null,
  body: ChatRequestBody,
  incomingMessages: Array<{ role: string; content: unknown }>,
): Promise<{ systemPrompt: string; personaToolAllowlist: string[] | null }> {
  let systemPrompt = 'You are a helpful assistant.';

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

  // Project root + directory listing
  if (chatRecord?.projectRoot) {
    systemPrompt += `\n\n[Project Root]\n${chatRecord.projectRoot}`;
    try {
      const listing = await deps.executeTool('list_directory', { path: '.', maxDepth: 2 }, chatRecord.projectRoot);
      systemPrompt += `\n\n[Project Structure]\n${listing}`;
    } catch (error) {
      console.error(`[SYSTEM PROMPT] Failed to list directory: ${error}`);
    }
  }

  systemPrompt += '\n\nYou can also read local project files using read_file.';

  // Enabled skills
  try {
    const enabledSkills = DatabaseService.listEnabledSkills();
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

  // Vector memory — embed last user message, search + auto-save
  const lastUserMsg = incomingMessages.slice().reverse().find((m) => m.role === 'user');
  if (lastUserMsg) {
    const userText = normalizeMessageContent(lastUserMsg.content).content;
    if (userText.trim()) {
      try {
        const queryVec = await EmbeddingService.embed(userText);

        const memories = EmbeddingService.searchWithVector(queryVec, 3, 0.3);
        if (memories.length > 0) {
          const block = memories
            .map((m, i) => `[Memory ${i + 1} (relevance: ${m.score})] ${m.content}`)
            .join('\n\n');
          systemPrompt += `\n\n[Relevant Memories]\n${block}`;
        }

        if (userText.trim().length >= 20) {
          DatabaseService.upsertMemory({
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
        // Embedding model unavailable — skip memory operations
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
  let currentMessages = [...initialMessages];
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

    if (!upstreamResponse.ok) {
      throw new Error(await upstreamResponse.text());
    }
    if (!upstreamResponse.body) throw new Error('No stream body from provider');

    const reader = upstreamResponse.body.getReader();
    let isToolCall = false;
    let streamBuffer = '';
    let assistantMessage: {
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
        const data = JSON.parse(line);
        if (data.message?.tool_calls) {
          isToolCall = true;
          assistantMessage.tool_calls = data.message.tool_calls;
        }
        if (data.message?.content) assistantMessage.content += data.message.content;
        if (!isToolCall) controller.enqueue(encoder.encode(line + '\n'));
      }
    }

    if (streamBuffer.trim()) {
      const data = JSON.parse(streamBuffer);
      if (data.message?.tool_calls) {
        isToolCall = true;
        assistantMessage.tool_calls = data.message.tool_calls;
      }
      if (!isToolCall) controller.enqueue(encoder.encode(streamBuffer + '\n'));
    }

    if (!isToolCall) {
      controller.close();
      return;
    }

    currentMessages.push(assistantMessage as AnyMessage);

    let skippedCount = 0;
    for (const tc of assistantMessage.tool_calls) {
      const toolName = tc.function?.name ?? 'unknown';
      const toolArgs = tc.function?.arguments;

      // Sort keys to avoid dedup misses from key-order differences
      const callKey = `${toolName}:${JSON.stringify(toolArgs ?? {}, Object.keys(toolArgs ?? {}).sort())}`;
      if (toolCallHistory.has(callKey)) {
        skippedCount++;
        continue;
      }
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

  // Max iterations reached
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
    const body = (await context.req.json()) as ChatRequestBody;

    try {
      if (!body.model || typeof body.model !== 'string') {
        return context.json({ error: 'Model required' }, 400);
      }

      const { provider, modelName } = dependencies.providerRegistry.resolveModel(body.model);

      const isAvailable = await provider.isModelAvailable(modelName);
      if (!isAvailable) {
        return context.json(
          { error: `Model '${modelName}' is not available on provider '${provider.id}'.` },
          400,
        );
      }

      const clientWantsStreaming = body.stream !== false;
      const chatRecord =
        typeof body.chatId === 'string' && body.chatId ? dependencies.getChat(body.chatId) : null;
      const incomingMessages = Array.isArray(body.messages) ? body.messages : [];

      const { systemPrompt, personaToolAllowlist } = await buildSystemPrompt(
        dependencies,
        chatRecord,
        body,
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

      const modelDetails = (await provider.getModelDetails(modelName)) as {
        capabilities?: string[];
      } | null;
      const capabilities = modelDetails?.capabilities ?? [];
      const tools = resolveTools(
        dependencies.getToolDefinitions() as Record<string, unknown>[],
        capabilities.includes('tools'),
        personaToolAllowlist,
        body.search ?? false,
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
            try {
              controller.error(err);
            } catch {
              // ignore
            }
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
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[CHAT ERROR] ${message}`);
      return context.json({ error: message }, 500);
    }
  });

  return app;
}
