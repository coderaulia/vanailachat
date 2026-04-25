import { Hono } from 'hono';
import type { AppDependencies, ChatRequestBody } from '../types.js';
import { parseOllamaError, normalizeMessageContent } from '../helpers/index.js';

export function chatRouter(dependencies: AppDependencies): Hono {
  const app = new Hono();

  app.post('/', async (context) => {
    const body = (await context.req.json()) as ChatRequestBody;
    const ollamaUrl = dependencies.getBaseUrl();

    try {
      if (!body.model || typeof body.model !== 'string') {
        return context.json({ error: 'Model required' }, 400);
      }

      const installedModels = await dependencies.getInstalledModels();
      if (!installedModels.includes(body.model)) {
        return context.json({ error: `Model '${body.model}' is not installed or available.` }, 400);
      }

      const clientWantsStreaming = body.stream !== false;

      const chatRecord =
        typeof body.chatId === 'string' && body.chatId
          ? dependencies.getChat(body.chatId)
          : null;



      let systemPrompt = 'You are a helpful assistant.';

      // Integrate Project Context if available
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
      if (chatRecord?.projectRoot) {
        systemPrompt += `\n\n[Project Root]\n${chatRecord.projectRoot}`;
        try {
          const directoryListing = await dependencies.executeTool('list_directory', { path: '.', maxDepth: 2 }, chatRecord.projectRoot);
          systemPrompt += `\n\n[Project Structure]\n${directoryListing}`;
        } catch (error) {
          console.error(`[SYSTEM PROMPT] Failed to list directory: ${error}`);
        }
      }

      systemPrompt += '\n\nYou can also read local project files using read_file.';

      const incomingMessages = Array.isArray(body.messages) ? body.messages : [];
      
      // Check if model supports chat or is an image model
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const modelDetails = (await dependencies.getModelDetails(body.model)) as any;
      const isImageModel = modelDetails?.capabilities?.includes('image');
      const isChatModel =
        !modelDetails?.capabilities ||
        modelDetails.capabilities.includes('chat') ||
        (modelDetails.capabilities.includes('text') && !isImageModel);

      if (isImageModel && !isChatModel) {
        const lastUserMessage = [...incomingMessages].reverse().find((m) => m.role === 'user');
        if (!lastUserMessage) {
          throw new Error('No user message found for image generation');
        }

        const prompt = typeof lastUserMessage.content === 'string' 
          ? lastUserMessage.content 
          : normalizeMessageContent(lastUserMessage.content).content;

        const genResponse = await dependencies.fetchFn(`${ollamaUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: context.req.raw.signal,
          body: JSON.stringify({
            model: body.model,
            prompt: prompt,
            stream: false,
          }),
        });

        if (!genResponse.ok) {
          throw new Error(parseOllamaError(await genResponse.text()));
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const genPayload = (await genResponse.json()) as any;
        const images = genPayload.images || [];
        const imageMarkdown = images
          .map((img: string) => `![Generated Image](data:image/png;base64,${img})`)
          .join('\n\n');
        
        const content = genPayload.response 
          ? `${genPayload.response}\n\n${imageMarkdown}`
          : imageMarkdown;

        if (!clientWantsStreaming) {
          return context.json({
            model: body.model,
            message: { role: 'assistant', content },
            done: true,
          });
        }

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  model: body.model,
                  message: { role: 'assistant', content },
                  done: true,
                }) + '\n'
              )
            );
            controller.close();
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
      const supportsTools = Array.isArray(modelDetails?.capabilities) && modelDetails.capabilities.includes('tools');
      
      let tools = dependencies.getToolDefinitions() as any[];
      if (!supportsTools) {
        tools = [];
      } else if (!body.search) {
        tools = tools.filter((t) => t.function.name !== 'search_web');
      }

      if (!clientWantsStreaming) {
        const upstreamResponse = await dependencies.fetchFn(`${ollamaUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: context.req.raw.signal,
          body: JSON.stringify({
            model: body.model,
            stream: false,
            messages,
            tools: tools.length > 0 ? tools : undefined,
          }),
        });

        if (!upstreamResponse.ok) {
          throw new Error(parseOllamaError(await upstreamResponse.text()));
        }

        const payload = await upstreamResponse.json();
        return context.json(payload as object);
      }

      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      const stream = new ReadableStream({
        async start(controller) {
          let currentMessages = [...messages];
          let iteration = 0;
          const maxIterations = 7;

          try {
            while (iteration < maxIterations) {
              iteration++;

              const upstreamResponse = await dependencies.fetchFn(`${ollamaUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: context.req.raw.signal,
                body: JSON.stringify({
                  model: body.model,
                  stream: true,
                  messages: currentMessages,
                  tools: tools.length > 0 ? tools : undefined,
                }),
              });

              if (!upstreamResponse.ok) {
                throw new Error(parseOllamaError(await upstreamResponse.text()));
              }

              if (!upstreamResponse.body) throw new Error('No stream body from Ollama');
              
              const reader = upstreamResponse.body.getReader();
              let isToolCall = false;
              let streamBuffer = '';
              let assistantMessage = { role: 'assistant', content: '', tool_calls: [] as any[] };

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

              currentMessages.push(assistantMessage);

              for (const tc of assistantMessage.tool_calls) {
                controller.enqueue(encoder.encode(JSON.stringify({
                   tool_event: true,
                   tool: tc.function.name
                }) + '\n'));

                try {
                  const result = await dependencies.executeTool(
                    tc.function.name,
                    tc.function.arguments,
                    chatRecord?.projectRoot ?? null
                  );
                  currentMessages.push({ role: 'tool', content: result });
                } catch (toolErr) {
                  currentMessages.push({ role: 'tool', content: `Error: ${toolErr instanceof Error ? toolErr.message : 'Unknown error'}` });
                }
              }
            }
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
            } catch (e) {
              // ignore
            }
          }
        }
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
