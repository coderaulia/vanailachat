import { Hono } from 'hono';
import type { AppDependencies } from '../types.js';
import { toOptionalNumber } from '../helpers/index.js';

export function dataRouter(dependencies: AppDependencies): Hono {
  const app = new Hono();

  app.get('/export', (context) => {
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

  app.post('/import', async (context) => {
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
  
  app.post('/pick-directory', async (context) => {
    try {
      const path = await dependencies.pickDirectory();
      return context.json({ path });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return context.json({ error: message }, 500);
    }
  });

  return app;
}
