import { Hono } from 'hono';
import type { AppDependencies } from '../types.js';
import { toOptionalNumber } from '../helpers/index.js';

export function messagesRouter(dependencies: AppDependencies): Hono {
  const app = new Hono();

  app.get('/', (context) => {
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

  app.post('/', async (context) => {
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

  /**
   * GET /api/messages/:id/feedback — fetch current rating + edited content
   * for a message (if any).
   */
  app.get('/:id/feedback', (context) => {
    const id = context.req.param('id');
    const feedback = dependencies.getFeedback(id);
    return context.json({ feedback });
  });

  /**
   * POST /api/messages/:id/feedback — set rating (-1, 0, +1) and optional
   * edited_content for a message. Upsert: re-rating overwrites.
   */
  app.post('/:id/feedback', async (context) => {
    const id = context.req.param('id');

    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: 'Invalid JSON in request body' }, 400);
    }

    const b = (body ?? {}) as { rating?: unknown; editedContent?: unknown };
    if (typeof b.rating !== 'number' || !Number.isFinite(b.rating)) {
      return context.json({ error: 'rating (number -1, 0, or 1) required' }, 400);
    }
    if (b.editedContent !== undefined && b.editedContent !== null && typeof b.editedContent !== 'string') {
      return context.json({ error: 'editedContent must be string or null' }, 400);
    }

    const message = dependencies.getMessage(id);
    if (!message) return context.json({ error: 'Message not found' }, 404);

    try {
      const feedback = dependencies.upsertFeedback({
        messageId: id,
        rating: b.rating,
        editedContent: (b.editedContent as string | null | undefined) ?? null,
      });
      return context.json({ feedback });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return context.json({ error: message }, 500);
    }
  });

  return app;
}
