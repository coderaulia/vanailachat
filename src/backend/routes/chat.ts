import { Hono } from 'hono';
import type { AppDependencies, ChatRequestBody } from '../types.js';
import { normalizeMessageContent } from '../helpers/index.js';
import { ProviderRegistry } from '../services/providerRegistry.js';
import { getPersonaSystemPrompt, getPersonaToolAllowlist } from '../services/personas.js';

export function chatRouter(dependencies: AppDependencies): Hono {
  const app = new Hono();

  app.post('/', async (context) => {
    const body = (await context.req.json()) as ChatRequestBody;

    try {
      if (!body.model || typeof body.model !== 'string') {
        return context.json({ error: 'Model required' }, 400);
      }

      // Resolve provider from model name (supports "openai:gpt-4o" prefix syntax,
      // leaves Ollama tags like "qwen3.5:latest" intact)
      const { provider, modelName } = dependencies.providerRegistry.resolveModel(body.model);

      // Validate model availability
      const isAvailable = await provider.isModelAvailable(modelName);
      if (!isAvailable) {
        return context.json(
          { error: `Model '${modelName}' is not available on provider '${provider.id}'.` },
          400,
        );
      }

      const clientWantsStreaming = body.stream !== false;

      const chatRecord =
        typeof body.chatId === 'string' && body.chatId
          ? dependencies.getChat(body.chatId)
          : null;

      // --- Assemble system prompt ---
      let systemPrompt = 'You are a helpful assistant.';

      if (chatRecord?.projectId) {
        const project = dependencies.getProject(chatRecord.projectId);
        if (project) {
          if (project.instructions && project.instructions.trim()) {
            systemPrompt += `\n\n[Project Instructions]\n${project.instructions}`;
          }
          if (project.memory && project.memory.trim()) {
            systemPrompt += `\n\n[Shared Project Memory]\n${project.memory}`;
          }
        }
      }

      const chatPrompt = chatRecord?.systemPrompt ?? null;
      if (chatPrompt && chatPrompt.trim()) {
        systemPrompt += `\n\n[Chat-Specific Instructions]\n${chatPrompt}`;
      }

      if (body.search) {
        systemPrompt +=
          '\n\nWeb search is enabled. ALWAYS use search_web if the user asks for real-time information, news, or facts you are unsure about.';
      }

      // Inject relevant vector memories into system prompt
      // Done here after incomingMessages is declared below
      let memoryContextBlock = '';

      if (chatRecord?.projectRoot) {
        systemPrompt += `\n\n[Project Root]\n${chatRecord.projectRoot}`;
        try {
          const directoryListing = await dependencies.executeTool(
            'list_directory',
            { path: '.', maxDepth: 2 },
            chatRecord.projectRoot,
          );
          systemPrompt += `\n\n[Project Structure]\n${directoryListing}`;
        } catch (error) {
          console.error(`[SYSTEM PROMPT] Failed to list directory: ${error}`);
        }
      }

      systemPrompt += '\n\nYou can also read local project files using read_file.';

      // --- Inject enabled Skills ---
      try {
        const { DatabaseService } = await import('../services/database.js');
        const enabledSkills = DatabaseService.listEnabledSkills();
        if (enabledSkills.length > 0) {
          for (const skill of enabledSkills) {
            systemPrompt += `\n\n[Skill: ${skill.name}]\n${skill.content}`;
          }
        }
      } catch {
        // DB unavailable — skip skill injection
      }

      // --- Inject Persona (Coder / Creator / General) ---
      const personaId = (body as Record<string, unknown>).persona as string | undefined;
      const personaPrompt = getPersonaSystemPrompt(personaId);
      if (personaPrompt) {
        systemPrompt += `\n\n${personaPrompt}`;
      }
      const personaToolAllowlist = getPersonaToolAllowlist(personaId);

      const incomingMessages = Array.isArray(body.messages) ? body.messages : [];

      // Inject relevant vector memories into system prompt
      try {
        const lastUserMessage = incomingMessages
          .slice()
          .reverse()
          .find((m: { role: string }) => m.role === 'user');
        if (lastUserMessage) {
          const userText = normalizeMessageContent(lastUserMessage.content).content;
          if (userText.trim()) {
            const { EmbeddingService } = await import('../services/embedding.js');
            const memories = await EmbeddingService.search(userText, 3, 0.3);
            if (memories.length > 0) {
              memoryContextBlock = memories
                .map((m, i) => `[Memory ${i + 1} (relevance: ${m.score})] ${m.content}`)
                .join('\n\n');
            }
          }
        }
      } catch {
        // Embedding model unavailable — skip memory injection
      }

      if (memoryContextBlock) {
        systemPrompt += `\n\n[Relevant Memories]\n${memoryContextBlock}`;
      }

      const messages = [
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

      // --- Tool resolution ---
      const modelDetails = (await provider.getModelDetails(modelName)) as {
        capabilities?: string[];
      } | null;
      const capabilities = modelDetails?.capabilities ?? [];
      const supportsTools = capabilities.includes('tools');

      let tools = dependencies.getToolDefinitions() as Record<string, unknown>[];
      if (!supportsTools) {
        tools = [];
      } else {
        // Persona tool allowlist (empty/null = all tools allowed)
        if (personaToolAllowlist && personaToolAllowlist.length > 0) {
          tools = tools.filter((t) => {
            const fn = (t as { function?: { name?: string } }).function;
            return personaToolAllowlist.includes(fn?.name ?? '');
          });
        }
        if (!body.search) {
          tools = tools.filter((t) => {
            const fn = (t as { function?: { name?: string } }).function;
            return fn?.name !== 'search_web';
          });
        }
      }

      // --- Non-streaming path ---
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

      // --- Streaming path with agentic tool loop ---
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      const stream = new ReadableStream({
        async start(controller) {
          let currentMessages = [...messages];
          let iteration = 0;
          const maxIterations = 7;

          // Track tool calls to detect repeated identical calls
          const toolCallHistory = new Set<string>();

          const enqueueToolEvent = (
            name: string,
            status: 'start' | 'done' | 'error',
            detail?: string,
          ) => {
            try {
              controller.enqueue(
                encoder.encode(
                  JSON.stringify({
                    tool_event: true,
                    iteration,
                    tool: name,
                    status,
                    ...(detail ? { detail: detail.slice(0, 200) } : {}),
                  }) + '\n',
                ),
              );
            } catch {
              // Stream may be closed
            }
          };

          try {
            while (iteration < maxIterations) {
              iteration++;

              const upstreamResponse = await provider.chatStream(
                {
                  model: modelName,
                  messages: currentMessages,
                  stream: true,
                  tools: tools.length > 0 ? tools : undefined,
                } as Parameters<typeof provider.chatStream>[0],
                context.req.raw.signal,
              );

              if (!upstreamResponse.ok) {
                const errorText = await upstreamResponse.text();
                throw new Error(errorText);
              }

              if (!upstreamResponse.body) throw new Error('No stream body from provider');

              const reader = upstreamResponse.body.getReader();
              let isToolCall = false;
              let streamBuffer = '';
              let assistantMessage: {
                role: string;
                content: string;
                tool_calls: Array<{
                  id?: string;
                  function?: { name?: string; arguments?: unknown };
                  type?: string;
                }>;
              } = { role: 'assistant', content: '', tool_calls: [] };

              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunkStr = decoder.decode(value, { stream: true });
                streamBuffer += chunkStr;
                const lines = streamBuffer.split('\n');
                streamBuffer = lines.pop() ?? '';

                for (const line of lines) {
                  if (!line.trim()) continue;
                  const data = JSON.parse(line);

                  if (data.message) {
                    if (data.message.tool_calls) {
                      isToolCall = true;
                      assistantMessage.tool_calls = data.message.tool_calls;
                    }
                    if (data.message.content) {
                      assistantMessage.content += data.message.content;
                    }
                  }

                  if (!isToolCall) {
                    controller.enqueue(encoder.encode(line + '\n'));
                  }
                }
              }

              if (streamBuffer.trim()) {
                const data = JSON.parse(streamBuffer);
                if (data.message?.tool_calls) {
                  isToolCall = true;
                  assistantMessage.tool_calls = data.message.tool_calls;
                }
                if (!isToolCall) {
                  controller.enqueue(encoder.encode(streamBuffer + '\n'));
                }
              }

              if (!isToolCall) {
                controller.close();
                return;
              }

              currentMessages.push(assistantMessage as (typeof currentMessages)[number]);

              // Process tool calls with deduplication
              let skippedCount = 0;
              for (const tc of assistantMessage.tool_calls) {
                const toolName = tc.function?.name ?? 'unknown';
                const toolArgs = tc.function?.arguments;

                // Deduplicate: skip identical tool calls already made in this session
                const callKey = `${toolName}:${JSON.stringify(toolArgs ?? {})}`;
                if (toolCallHistory.has(callKey)) {
                  skippedCount++;
                  continue;
                }
                toolCallHistory.add(callKey);

                enqueueToolEvent(toolName, 'start');

                try {
                  const result = await dependencies.executeTool(
                    toolName,
                    toolArgs,
                    chatRecord?.projectRoot ?? null,
                  );
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
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  message: { role: 'assistant', content: `\n\n*Agent looped ${maxIterations} times without finishing. Please simplify your request.*` },
                  done: true,
                }) + '\n',
              ),
            );
            controller.close();
          } catch (err) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const error = err as any;
            if (error.name === 'AbortError' || error.code === 'ERR_INVALID_STATE') {
              return;
            }
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
      if (error instanceof Error && error.name === 'AbortError') {
        return new Response(null);
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[CHAT ERROR] ${message}`);
      return context.json({ error: message }, 500);
    }
  });

  return app;
}
