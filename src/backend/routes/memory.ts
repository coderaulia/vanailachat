import { Hono } from 'hono';
import { sanitizeError } from '../helpers/index.js';
import type { AppDependencies } from '../types.js';

export function memoryRouter(dependencies: AppDependencies): Hono {
  const app = new Hono();

  /** List all stored memories */
  app.get('/', (context) => {
    const entries = dependencies.getAllMemoryEntries();
    return context.json({ memories: entries, count: entries.length });
  });

  /** Search memories by semantic similarity */
  app.get('/search', async (context) => {
    const query = context.req.query('q');
    if (!query) {
      return context.json({ error: 'Query string ?q= required' }, 400);
    }
    const topK = parseInt(context.req.query('k') || '5', 10);

    try {
      const results = await dependencies.searchMemoriesByText(query, topK);
      return context.json({ results });
    } catch (error) {
      return context.json({ error: sanitizeError(error, 'Search failed') }, 500);
    }
  });

  /** Store a new memory */
  app.post('/', async (context) => {
    try {
      const body = await context.req.json<{ content: string; type?: string; sourceId?: string }>();
      if (!body.content?.trim()) {
        return context.json({ error: 'Content required' }, 400);
      }

      const embedding = await dependencies.embed(body.content);
      const record = dependencies.upsertMemory({
        type: body.type ?? 'manual',
        content: body.content,
        embedding,
        sourceId: body.sourceId ?? null,
      });

      return context.json({ memory: record }, 201);
    } catch (error) {
      return context.json({ error: sanitizeError(error, 'Storage failed') }, 500);
    }
  });

  /** Delete a memory by ID */
  app.delete('/:id', (context) => {
    const id = context.req.param('id');
    const deleted = dependencies.deleteMemory(id);
    return context.json({ deleted });
  });

  /** Index an existing chat's messages as vector memories */
  app.post('/index-chat/:chatId', async (context) => {
    const { chatId } = context.req.param();
    const chat = dependencies.getChat(chatId);
    if (!chat) return context.json({ error: 'Chat not found' }, 404);

    try {
      const messages = dependencies.listMessages(chatId);
      let indexed = 0;

      for (const msg of messages) {
        if (msg.role !== 'user' && msg.role !== 'assistant') continue;
        if (!msg.content?.trim()) continue;

        const embedding = await dependencies.embed(msg.content);
        dependencies.upsertMemory({
          type: 'conversation',
          content: msg.content.slice(0, 4000),
          embedding,
          metadata: JSON.stringify({ role: msg.role, chatId, chatTitle: chat.title }),
          sourceId: chatId,
        });
        indexed++;
      }

      return context.json({ indexed, chatId });
    } catch (error) {
      return context.json({ error: sanitizeError(error, 'Indexing failed') }, 500);
    }
  });

  /** Get memory context for injecting into system prompt */
  app.get('/context', async (context) => {
    const query = context.req.query('q');
    if (!query) {
      return context.json({ context: '' });
    }

    try {
      const results = await dependencies.searchMemoriesByText(query, 3, 0.25);
      if (results.length === 0) {
        return context.json({ context: '' });
      }

      const contextText = results
        .map((r, i) => `[Memory ${i + 1}] ${r.content}`)
        .join('\n\n');

      return context.json({ context: contextText, matches: results.length });
    } catch {
      return context.json({ context: '' });
    }
  });

  return app;
}
