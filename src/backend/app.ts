import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { DatabaseService } from './services/database.js';
import type {
  ChatRecord,
  CreateProjectInput,
  InsertMessageInput,
  MessageRecord,
  ProjectRecord,
  UpsertChatInput,
} from './services/database.js';
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
  listProjects: () => ProjectRecord[];
  createProject: (input: CreateProjectInput) => ProjectRecord;
  listChats: (projectId?: string) => ChatRecord[];
  upsertChat: (input: UpsertChatInput) => ChatRecord;
  deleteChat: (id: string) => boolean;
  listMessages: (chatId: string) => MessageRecord[];
  insertMessage: (input: InsertMessageInput) => MessageRecord;
}

const defaultDependencies: AppDependencies = {
  executeTool: ToolService.executeTool.bind(ToolService),
  fetchFn: fetch,
  getBaseUrl: OllamaService.getBaseUrl.bind(OllamaService),
  getInstalledModels: OllamaService.getInstalledModels.bind(OllamaService),
  getModelDetails: OllamaService.getModelDetails.bind(OllamaService),
  getToolDefinitions: ToolService.getToolDefinitions.bind(ToolService),
  listProjects: DatabaseService.listProjects.bind(DatabaseService),
  createProject: DatabaseService.createProject.bind(DatabaseService),
  listChats: DatabaseService.listChats.bind(DatabaseService),
  upsertChat: DatabaseService.upsertChat.bind(DatabaseService),
  deleteChat: DatabaseService.deleteChat.bind(DatabaseService),
  listMessages: DatabaseService.listMessages.bind(DatabaseService),
  insertMessage: DatabaseService.insertMessage.bind(DatabaseService),
};

function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function extractImageBase64(url: string): string {
  const dataUrlMarker = ';base64,';
  const markerIndex = url.indexOf(dataUrlMarker);
  if (markerIndex === -1) {
    return url;
  }

  return url.slice(markerIndex + dataUrlMarker.length);
}

function normalizeMessageContent(content: unknown): { content: string; images?: string[] } {
  if (typeof content === 'string') {
    return { content };
  }

  if (!Array.isArray(content)) {
    return { content: String(content ?? '') };
  }

  const textParts: string[] = [];
  const images: string[] = [];

  for (const part of content) {
    if (typeof part !== 'object' || part === null) {
      continue;
    }

    const typedPart = part as {
      type?: unknown;
      text?: unknown;
      image_url?: { url?: unknown };
    };

    if (typedPart.type === 'text' && typeof typedPart.text === 'string') {
      textParts.push(typedPart.text);
      continue;
    }

    if (
      typedPart.type === 'image_url' &&
      typedPart.image_url &&
      typeof typedPart.image_url.url === 'string'
    ) {
      images.push(extractImageBase64(typedPart.image_url.url));
    }
  }

  const normalized = {
    content: textParts.join('\n').trim(),
  };

  if (images.length > 0) {
    return { ...normalized, images };
  }

  return normalized;
}

export function createApp(overrides: Partial<AppDependencies> = {}): Hono {
  const dependencies = { ...defaultDependencies, ...overrides };
  const app = new Hono();

  app.use('*', logger());
  app.use('*', cors());

  app.get('/api/health', (context) => context.json({ status: 'ok' }));

  app.get('/api/projects', (context) => {
    try {
      const projects = dependencies.listProjects();
      return context.json({ projects });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return context.json({ error: message }, 500);
    }
  });

  app.post('/api/projects', async (context) => {
    try {
      const body = (await context.req.json()) as { id?: unknown; name?: unknown; createdAt?: unknown };
      if (typeof body.name !== 'string' || !body.name.trim()) {
        return context.json({ error: 'Project name is required' }, 400);
      }

      const project = dependencies.createProject({
        id: typeof body.id === 'string' ? body.id : undefined,
        name: body.name,
        createdAt: toOptionalNumber(body.createdAt),
      });

      return context.json({ project }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return context.json({ error: message }, 500);
    }
  });

  app.get('/api/chats', (context) => {
    try {
      const projectId = context.req.query('projectId') || undefined;
      const chats = dependencies.listChats(projectId);
      return context.json({ chats });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return context.json({ error: message }, 500);
    }
  });

  app.post('/api/chats', async (context) => {
    try {
      const body = (await context.req.json()) as {
        id?: unknown;
        projectId?: unknown;
        title?: unknown;
        model?: unknown;
        systemPrompt?: unknown;
        pinned?: unknown;
        role?: unknown;
        createdAt?: unknown;
        updatedAt?: unknown;
      };

      const chat = dependencies.upsertChat({
        id: typeof body.id === 'string' ? body.id : undefined,
        projectId: typeof body.projectId === 'string' ? body.projectId : undefined,
        title: typeof body.title === 'string' ? body.title : undefined,
        model: typeof body.model === 'string' ? body.model : body.model === null ? null : undefined,
        systemPrompt:
          typeof body.systemPrompt === 'string'
            ? body.systemPrompt
            : body.systemPrompt === null
              ? null
              : undefined,
        pinned:
          typeof body.pinned === 'boolean'
            ? body.pinned
            : typeof body.pinned === 'number'
              ? body.pinned === 1
              : undefined,
        role: typeof body.role === 'string' ? body.role : body.role === null ? null : undefined,
        createdAt: toOptionalNumber(body.createdAt),
        updatedAt: toOptionalNumber(body.updatedAt),
      });

      return context.json({ chat }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return context.json({ error: message }, 500);
    }
  });

  app.delete('/api/chats/:id', (context) => {
    try {
      const id = context.req.param('id');
      if (!id) {
        return context.json({ error: 'Chat ID required' }, 400);
      }

      const deleted = dependencies.deleteChat(id);
      if (!deleted) {
        return context.json({ error: 'Chat not found' }, 404);
      }

      return context.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return context.json({ error: message }, 500);
    }
  });

  app.get('/api/messages', (context) => {
    try {
      const chatId = context.req.query('chatId');
      if (!chatId) {
        return context.json({ error: 'chatId is required' }, 400);
      }

      const messages = dependencies.listMessages(chatId);
      return context.json({ messages });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return context.json({ error: message }, 500);
    }
  });

  app.post('/api/messages', async (context) => {
    try {
      const body = (await context.req.json()) as {
        id?: unknown;
        chatId?: unknown;
        role?: unknown;
        content?: unknown;
        promptTokens?: unknown;
        completionTokens?: unknown;
        createdAt?: unknown;
      };

      if (typeof body.chatId !== 'string' || !body.chatId.trim()) {
        return context.json({ error: 'chatId is required' }, 400);
      }

      if (typeof body.role !== 'string' || !body.role.trim()) {
        return context.json({ error: 'role is required' }, 400);
      }

      if (typeof body.content !== 'string') {
        return context.json({ error: 'content must be a string' }, 400);
      }

      const message = dependencies.insertMessage({
        id: typeof body.id === 'string' ? body.id : undefined,
        chatId: body.chatId,
        role: body.role,
        content: body.content,
        promptTokens: toOptionalNumber(body.promptTokens),
        completionTokens: toOptionalNumber(body.completionTokens),
        createdAt: toOptionalNumber(body.createdAt),
      });

      return context.json({ message }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return context.json({ error: message }, 500);
    }
  });

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
      if (!body.model || typeof body.model !== 'string') {
        return context.json({ error: 'Model required' }, 400);
      }

      const clientWantsStreaming = body.stream !== false;

      let systemPrompt = 'You are a helpful assistant.';
      if (body.search) {
        systemPrompt +=
          ' Web search is enabled. ALWAYS use search_web if the user asks for real-time information, news, or facts you are unsure about.';
      }
      systemPrompt += ' You can also read local project files using read_file.';

      const incomingMessages = Array.isArray(body.messages) ? body.messages : [];
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

      const upstreamResponse = await dependencies.fetchFn(`${ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: body.model,
          stream: clientWantsStreaming,
          messages,
        }),
      });

      if (!upstreamResponse.ok) {
        throw new Error(await upstreamResponse.text());
      }

      if (!clientWantsStreaming) {
        const payload = await upstreamResponse.json();
        return context.json(payload as object);
      }

      if (!upstreamResponse.body) {
        throw new Error('No stream body from Ollama');
      }

      return new Response(upstreamResponse.body, {
        status: 200,
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[CHAT ERROR] ${message}`);
      return context.json({ error: message }, 500);
    }
  });

  return app;
}
