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
  UpdateProjectInput,
  UpsertChatInput,
} from './services/database.js';
import { OllamaService } from './services/ollama.js';
import { ToolService } from './services/tools.js';

interface ChatRequestBody {
  model?: string;
  chatId?: string;
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
  getProject: (id: string) => ProjectRecord | null;
  createProject: (input: CreateProjectInput) => ProjectRecord;
  updateProject: (id: string, input: UpdateProjectInput) => ProjectRecord;
  deleteProject: (id: string) => boolean;
  listChats: (projectId?: string) => ChatRecord[];
  getChat: (id: string) => ChatRecord | null;
  upsertChat: (input: UpsertChatInput) => ChatRecord;
  deleteChat: (id: string) => boolean;
  listMessages: (chatId: string) => MessageRecord[];
  insertMessage: (input: InsertMessageInput) => MessageRecord;
  pickDirectory: () => Promise<string | null>;
}

const defaultDependencies: AppDependencies = {
  executeTool: ToolService.executeTool.bind(ToolService),
  fetchFn: fetch,
  getBaseUrl: OllamaService.getBaseUrl.bind(OllamaService),
  getInstalledModels: OllamaService.getInstalledModels.bind(OllamaService),
  getModelDetails: OllamaService.getModelDetails.bind(OllamaService),
  getToolDefinitions: ToolService.getToolDefinitions.bind(ToolService),
  listProjects: DatabaseService.listProjects.bind(DatabaseService),
  getProject: DatabaseService.getProject.bind(DatabaseService),
  createProject: DatabaseService.createProject.bind(DatabaseService),
  updateProject: DatabaseService.updateProject.bind(DatabaseService),
  deleteProject: DatabaseService.deleteProject.bind(DatabaseService),
  listChats: DatabaseService.listChats.bind(DatabaseService),
  getChat: DatabaseService.getChat.bind(DatabaseService),
  upsertChat: DatabaseService.upsertChat.bind(DatabaseService),
  deleteChat: DatabaseService.deleteChat.bind(DatabaseService),
  listMessages: DatabaseService.listMessages.bind(DatabaseService),
  insertMessage: DatabaseService.insertMessage.bind(DatabaseService),
  pickDirectory: async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFilePromise = promisify(execFile);
    try {
      const { stdout } = await execFilePromise('zenity', [
        '--file-selection',
        '--directory',
        '--title=Select Project Root',
      ]);
      return stdout.trim();
    } catch {
      try {
        const { stdout } = await execFilePromise('kdialog', ['--getexistingdirectory', '.']);
        return stdout.trim();
      } catch {
        return null;
      }
    }
  },
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

function parseOllamaError(responseText: string): string {
  try {
    const parsed = JSON.parse(responseText);
    if (parsed.error) {
      if (typeof parsed.error === 'string' && (parsed.error.startsWith('{') || parsed.error.startsWith('['))) {
        try {
          const nested = JSON.parse(parsed.error);
          return nested.error || parsed.error;
        } catch {
          return parsed.error;
        }
      }
      return parsed.error;
    }
    return responseText;
  } catch {
    return responseText;
  }
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
      const body = (await context.req.json()) as { 
        id?: unknown; 
        name?: unknown; 
        description?: unknown;
        instructions?: unknown;
        memory?: unknown;
        createdAt?: unknown 
      };
      if (typeof body.name !== 'string' || !body.name.trim()) {
        return context.json({ error: 'Project name is required' }, 400);
      }

      const project = dependencies.createProject({
        id: typeof body.id === 'string' ? body.id : undefined,
        name: body.name,
        description: typeof body.description === 'string' ? body.description : undefined,
        instructions: typeof body.instructions === 'string' ? body.instructions : undefined,
        memory: typeof body.memory === 'string' ? body.memory : undefined,
        createdAt: toOptionalNumber(body.createdAt),
      });

      return context.json({ project }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return context.json({ error: message }, 500);
    }
  });

  app.get('/api/projects/:id', (context) => {
    try {
      const id = context.req.param('id');
      const project = dependencies.getProject(id);
      if (!project) {
        return context.json({ error: 'Project not found' }, 404);
      }
      return context.json({ project });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return context.json({ error: message }, 500);
    }
  });

  app.patch('/api/projects/:id', async (context) => {
    try {
      const id = context.req.param('id');
      const body = (await context.req.json()) as {
        name?: unknown;
        description?: unknown;
        instructions?: unknown;
        memory?: unknown;
        pinned?: unknown;
      };

      const project = dependencies.updateProject(id, {
        name: typeof body.name === 'string' ? body.name : undefined,
        description: typeof body.description === 'string' ? body.description : undefined,
        instructions: typeof body.instructions === 'string' ? body.instructions : undefined,
        memory: typeof body.memory === 'string' ? body.memory : undefined,
        pinned: typeof body.pinned === 'boolean' ? body.pinned : undefined,
      });

      return context.json({ project });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return context.json({ error: message }, 500);
    }
  });
 
  app.delete('/api/projects/:id', (context) => {
    try {
      const id = context.req.param('id');
      const deleted = dependencies.deleteProject(id);
      if (!deleted) {
        return context.json({ error: 'Project not found' }, 404);
      }
      return context.json({ ok: true });
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
        projectRoot?: unknown;
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
        projectRoot:
          typeof body.projectRoot === 'string'
            ? body.projectRoot
            : body.projectRoot === null
              ? null
              : undefined,
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

  app.patch('/api/chats/:id', async (context) => {
    try {
      const id = context.req.param('id');
      if (!id) {
        return context.json({ error: 'Chat ID required' }, 400);
      }

      const existingChat = dependencies.getChat(id);
      if (!existingChat) {
        return context.json({ error: 'Chat not found' }, 404);
      }

      const body = (await context.req.json()) as {
        projectId?: unknown;
        title?: unknown;
        model?: unknown;
        projectRoot?: unknown;
        systemPrompt?: unknown;
        pinned?: unknown;
        role?: unknown;
        updatedAt?: unknown;
      };

      const chat = dependencies.upsertChat({
        id,
        projectId: typeof body.projectId === 'string' ? body.projectId : existingChat.projectId,
        title: typeof body.title === 'string' ? body.title : existingChat.title,
        model: typeof body.model === 'string' ? body.model : body.model === null ? null : existingChat.model,
        projectRoot:
          typeof body.projectRoot === 'string'
            ? body.projectRoot
            : body.projectRoot === null
              ? null
              : existingChat.projectRoot,
        systemPrompt:
          typeof body.systemPrompt === 'string'
            ? body.systemPrompt
            : body.systemPrompt === null
              ? null
              : existingChat.systemPrompt,
        pinned:
          typeof body.pinned === 'boolean'
            ? body.pinned
            : typeof body.pinned === 'number'
              ? body.pinned === 1
              : existingChat.pinned,
        role: typeof body.role === 'string' ? body.role : body.role === null ? null : existingChat.role,
        createdAt: existingChat.createdAt,
        updatedAt: toOptionalNumber(body.updatedAt) ?? Date.now(),
      });

      return context.json({ chat });
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

  app.get('/api/export', (context) => {
    try {
      const projects = dependencies.listProjects();
      const chats = dependencies.listChats();
      const messages = chats.flatMap((chat) => dependencies.listMessages(chat.id));

      return context.json({
        exportedAt: Date.now(),
        projects,
        chats,
        messages,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return context.json({ error: message }, 500);
    }
  });

  app.post('/api/import', async (context) => {
    try {
      const body = (await context.req.json()) as {
        projects?: Array<{ id?: unknown; name?: unknown; createdAt?: unknown }>;
        chats?: Array<{
          id?: unknown;
          projectId?: unknown;
          title?: unknown;
          model?: unknown;
          projectRoot?: unknown;
          systemPrompt?: unknown;
          pinned?: unknown;
          role?: unknown;
          createdAt?: unknown;
          updatedAt?: unknown;
        }>;
        messages?: Array<{
          id?: unknown;
          chatId?: unknown;
          role?: unknown;
          content?: unknown;
          promptTokens?: unknown;
          completionTokens?: unknown;
          createdAt?: unknown;
        }>;
      };

      const incomingProjects = Array.isArray(body.projects) ? body.projects : [];
      const incomingChats = Array.isArray(body.chats) ? body.chats : [];
      const incomingMessages = Array.isArray(body.messages) ? body.messages : [];

      const existingProjects = new Set(dependencies.listProjects().map((project) => project.id));
      for (const project of incomingProjects) {
        const id = typeof project.id === 'string' ? project.id : undefined;
        const name = typeof project.name === 'string' ? project.name : '';
        if (!id || !name || existingProjects.has(id)) {
          continue;
        }

        dependencies.createProject({
          id,
          name,
          createdAt: toOptionalNumber(project.createdAt),
        });
        existingProjects.add(id);
      }

      const existingChats = new Set(dependencies.listChats().map((chat) => chat.id));
      const importedChatIds = new Set<string>();
      let importedChats = 0;
      let skippedChats = 0;

      for (const chat of incomingChats) {
        const id = typeof chat.id === 'string' ? chat.id : '';
        if (!id) {
          continue;
        }

        if (existingChats.has(id)) {
          skippedChats += 1;
          continue;
        }

        dependencies.upsertChat({
          id,
          projectId: typeof chat.projectId === 'string' ? chat.projectId : undefined,
          title: typeof chat.title === 'string' ? chat.title : undefined,
          model: typeof chat.model === 'string' ? chat.model : chat.model === null ? null : undefined,
          projectRoot:
            typeof chat.projectRoot === 'string'
              ? chat.projectRoot
              : chat.projectRoot === null
                ? null
                : undefined,
          systemPrompt:
            typeof chat.systemPrompt === 'string'
              ? chat.systemPrompt
              : chat.systemPrompt === null
                ? null
                : undefined,
          pinned:
            typeof chat.pinned === 'boolean'
              ? chat.pinned
              : typeof chat.pinned === 'number'
                ? chat.pinned === 1
                : undefined,
          role: typeof chat.role === 'string' ? chat.role : chat.role === null ? null : undefined,
          createdAt: toOptionalNumber(chat.createdAt),
          updatedAt: toOptionalNumber(chat.updatedAt),
        });

        importedChats += 1;
        importedChatIds.add(id);
        existingChats.add(id);
      }

      let importedMessages = 0;
      for (const message of incomingMessages) {
        const chatId = typeof message.chatId === 'string' ? message.chatId : '';
        if (!chatId || !importedChatIds.has(chatId)) {
          continue;
        }

        dependencies.insertMessage({
          id: typeof message.id === 'string' ? message.id : undefined,
          chatId,
          role: typeof message.role === 'string' ? message.role : 'assistant',
          content: typeof message.content === 'string' ? message.content : '',
          promptTokens: toOptionalNumber(message.promptTokens),
          completionTokens: toOptionalNumber(message.completionTokens),
          createdAt: toOptionalNumber(message.createdAt),
        });
        importedMessages += 1;
      }

      return context.json({
        importedChats,
        skippedChats,
        importedMessages,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return context.json({ error: message }, 500);
    }
  });
  
  app.post('/api/pick-directory', async (context) => {
    try {
      const path = await dependencies.pickDirectory();
      return context.json({ path });
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

      const chatRecord =
        typeof body.chatId === 'string' && body.chatId
          ? dependencies.getChat(body.chatId)
          : null;

      ToolService.setExecutionRoot(chatRecord?.projectRoot ?? null);

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
          const directoryListing = await ToolService.executeTool('list_directory', { path: '.', maxDepth: 2 });
          systemPrompt += `\n\n[Project Structure]\n${directoryListing}`;
        } catch (error) {
          console.error(`[SYSTEM PROMPT] Failed to list directory: ${error}`);
        }
      }

      systemPrompt += '\n\nYou can also read local project files using read_file.';

      const incomingMessages = Array.isArray(body.messages) ? body.messages : [];
      
      // Check if model supports chat or is an image model
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
          body: JSON.stringify({
            model: body.model,
            prompt: prompt,
            stream: false,
          }),
        });

        if (!genResponse.ok) {
          throw new Error(parseOllamaError(await genResponse.text()));
        }

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
        throw new Error(parseOllamaError(await upstreamResponse.text()));
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
