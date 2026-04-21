import { Hono } from 'hono';
import type { AppDependencies } from '../types.js';
import { toOptionalNumber } from '../helpers/index.js';

export function chatsRouter(dependencies: AppDependencies): Hono {
  const app = new Hono();

  app.get('/', (context) => {
    try {
      const projectId = context.req.query('projectId') || undefined;
      const chats = dependencies.listChats(projectId);
      return context.json({ chats });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return context.json({ error: message }, 500);
    }
  });

  app.post('/', async (context) => {
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

  app.delete('/:id', (context) => {
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

  app.patch('/:id', async (context) => {
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

  return app;
}
