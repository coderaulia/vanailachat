import { Hono } from 'hono';
import type { AppDependencies } from '../types.js';
import { sanitizeError, toOptionalNumber } from '../helpers/index.js';

/** Newest-N messages returned per chat load, and the ceiling for ?limit=. */
const MAX_MESSAGES_PAGE = 500;

export function messagesRouter(dependencies: AppDependencies): Hono {
  const app = new Hono();

  /**
   * Search message bodies across chats. Registered before '/' so the literal
   * path is not shadowed by the chat-listing handler.
   */
  app.get('/search', (context) => {
    const query = context.req.query('q')?.trim();
    if (!query) {
      return context.json({ results: [] });
    }

    try {
      const limit = Math.min(Math.max(Number(context.req.query('limit')) || 30, 1), 100);
      const projectId = context.req.query('projectId') || undefined;
      return context.json({ results: dependencies.searchMessages(query, limit, projectId) });
    } catch (error) {
      return context.json({ error: sanitizeError(error, 'Search failed') }, 500);
    }
  });

  app.get('/', (context) => {
    try {
      const chatId = context.req.query('chatId');
      if (!chatId) {
        return context.json({ error: 'chatId is required' }, 400);
      }

      // Bounded by default — opening a long chat used to read its entire
      // history, and message content is unbounded text.
      const requested = Number.parseInt(context.req.query('limit') ?? '', 10);
      const limit = Number.isFinite(requested) && requested > 0
        ? Math.min(requested, MAX_MESSAGES_PAGE)
        : MAX_MESSAGES_PAGE;

      const messages = dependencies.listMessages(chatId, limit);
      return context.json({ messages });
    } catch (error) {
      const message = sanitizeError(error, 'Unknown error');
      return context.json({ error: message }, 500);
    }
  });

  app.post('/', async (context) => {
    try {
      const body = (await context.req.json()) as {
        id?: unknown;
        chatId?: unknown;
        chat_id?: unknown;
        role?: unknown;
        content?: unknown;
        promptTokens?: unknown;
        prompt_tokens?: unknown;
        completionTokens?: unknown;
        completion_tokens?: unknown;
        createdAt?: unknown;
        created_at?: unknown;
        timestamp?: unknown;
      };

      const chatId = typeof body.chatId === 'string' ? body.chatId : typeof body.chat_id === 'string' ? body.chat_id : '';
      if (!chatId.trim()) {
        return context.json({ error: 'chatId is required' }, 400);
      }

      const role = typeof body.role === 'string' ? body.role : '';
      if (!role.trim()) {
        return context.json({ error: 'role is required' }, 400);
      }

      if (typeof body.content !== 'string') {
        return context.json({ error: 'content must be a string' }, 400);
      }

      const message = dependencies.insertMessage({
        id: typeof body.id === 'string' ? body.id : undefined,
        chatId,
        role,
        content: body.content,
        promptTokens: toOptionalNumber(body.promptTokens ?? body.prompt_tokens),
        completionTokens: toOptionalNumber(body.completionTokens ?? body.completion_tokens),
        createdAt: toOptionalNumber(body.createdAt ?? body.created_at ?? body.timestamp),
      });

      return context.json({ message }, 201);
    } catch (error) {
      const message = sanitizeError(error, 'Unknown error');
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

      // RAG self-learning hook: when an assistant message is rated +1,
      // embed it (or its corrected version) into vector memory so it
      // resurfaces on similar future queries. Best-effort — failures
      // (embedding model offline, etc.) don't break the feedback write.
      if (b.rating === 1 && message.role === 'assistant') {
        const contentToEmbed =
          (typeof b.editedContent === 'string' && b.editedContent.trim()) ||
          message.content;

        if (contentToEmbed.trim().length >= 20) {
          (async () => {
            try {
              const embedding = await dependencies.embed(contentToEmbed);
              dependencies.upsertMemory({
                type: 'assistant_positive',
                content: contentToEmbed.slice(0, 4000),
                embedding,
                metadata: JSON.stringify({
                  role: 'assistant',
                  rating: 1,
                  messageId: id,
                  chatId: message.chatId,
                  edited: typeof b.editedContent === 'string' && b.editedContent.trim().length > 0,
                }),
                sourceId: message.chatId,
              });
            } catch (err) {
              console.warn('[FEEDBACK] failed to embed +1 assistant msg:', err instanceof Error ? err.message : err);
            }
          })();
        }
      }

      return context.json({ feedback });
    } catch (error) {
      const message = sanitizeError(error, 'Unknown error');
      return context.json({ error: message }, 500);
    }
  });

  return app;
}
