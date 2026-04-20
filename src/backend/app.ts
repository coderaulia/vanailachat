import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { OllamaService } from './services/ollama.js';
import { ToolService } from './services/tools.js';

interface ChatRequestBody {
  model?: string;
  messages?: Array<{ role: string; content: unknown }>;
  stream?: boolean;
  search?: boolean;
  [key: string]: unknown;
}

interface AppDependencies {
  executeTool: (name: string, args: unknown) => Promise<string>;
  fetchFn: typeof fetch;
  getBaseUrl: () => string;
  getInstalledModels: () => Promise<string[]>;
  getModelDetails: (modelName: string) => Promise<unknown>;
  getToolDefinitions: () => unknown[];
}

const defaultDependencies: AppDependencies = {
  executeTool: ToolService.executeTool.bind(ToolService),
  fetchFn: fetch,
  getBaseUrl: OllamaService.getBaseUrl.bind(OllamaService),
  getInstalledModels: OllamaService.getInstalledModels.bind(OllamaService),
  getModelDetails: OllamaService.getModelDetails.bind(OllamaService),
  getToolDefinitions: ToolService.getToolDefinitions.bind(ToolService),
};

export function createApp(overrides: Partial<AppDependencies> = {}): Hono {
  const dependencies = { ...defaultDependencies, ...overrides };
  const app = new Hono();

  app.use('*', logger());
  app.use('*', cors());

  app.get('/api/health', (context) => context.json({ status: 'ok' }));

  app.get('/api/models', async (context) => {
    try {
      const models = await dependencies.getInstalledModels();
      return context.json({ models });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return context.json({ error: message }, 500);
    }
  });

  app.get('/api/config', (context) => {
    return context.json({
      apiUrl: '/api',
      ollamaUrl: dependencies.getBaseUrl(),
    });
  });

  app.get('/api/model-details', async (context) => {
    const model = context.req.query('model');
    if (!model) {
      return context.json({ error: 'Model required' }, 400);
    }

    const details = await dependencies.getModelDetails(model);
    return context.json({ model, ...(details as object) });
  });

  app.post('/api/chat', async (context) => {
    const body = (await context.req.json()) as ChatRequestBody;
    const ollamaUrl = dependencies.getBaseUrl();

    try {
      const clientWantsStreaming = body.stream !== false;
      const tools = dependencies.getToolDefinitions();

      let systemPrompt = 'You are a helpful assistant.';
      if (body.search) {
        systemPrompt +=
          ' Web search is enabled. ALWAYS use search_web if the user asks for real-time information, news, or facts you are unsure about.';
      }
      systemPrompt += ' You can also read local project files using read_file.';

      const messages = [
        { role: 'system', content: systemPrompt },
        ...((Array.isArray(body.messages) ? body.messages : []) as Array<{ role: string; content: unknown }>),
      ];

      let currentTurn = 0;
      const maxTurns = 5;
      let lastData: Record<string, unknown> | null = null;
      let lastMessage: Record<string, unknown> | null = null;

      while (currentTurn < maxTurns) {
        const response = await dependencies.fetchFn(`${ollamaUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...body,
            stream: false,
            tools,
            messages,
          }),
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const data = (await response.json()) as {
          choices?: Array<{ message?: Record<string, unknown> }>;
          usage?: Record<string, unknown>;
        };

        lastData = data as unknown as Record<string, unknown>;

        const candidateMessage = data.choices?.[0]?.message;
        if (!candidateMessage) {
          throw new Error('Invalid response from Ollama: missing assistant message');
        }

        lastMessage = candidateMessage;
        messages.push(candidateMessage as { role: string; content: unknown });

        const toolCalls = Array.isArray(candidateMessage.tool_calls)
          ? (candidateMessage.tool_calls as Array<{
              id: string;
              function: { name: string; arguments?: string };
            }>)
          : [];

        if (toolCalls.length === 0) {
          break;
        }

        for (const call of toolCalls) {
          const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
          const result = await dependencies.executeTool(call.function.name, args);
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: call.function.name,
            content: result,
          } as unknown as { role: string; content: unknown });
        }

        currentTurn += 1;
      }

      if (!lastMessage) {
        throw new Error('No assistant response generated');
      }

      if (clientWantsStreaming) {
        const sseContent = `data: ${JSON.stringify({
          message: {
            role: 'assistant',
            content: typeof lastMessage.content === 'string' ? lastMessage.content : '',
          },
          usage: lastData?.usage,
          done: true,
        })}\n\n`;

        return context.body(sseContent, {
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }

      return context.json({
        choices: [{ message: lastMessage }],
        usage: lastData?.usage,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[CHAT ERROR] ${message}`);
      return context.json({ error: message }, 500);
    }
  });

  return app;
}
