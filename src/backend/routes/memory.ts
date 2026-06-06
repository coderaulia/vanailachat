import { Hono } from 'hono';
import type { AppDependencies } from '../types.js';
import { EmbeddingService } from '../services/embedding.js';
import { DatabaseService } from '../services/database.js';

export function memoryRouter(dependencies: AppDependencies): Hono {
  const app = new Hono();

  /** Search memories by semantic similarity */
  app.get('/search', async (context) => {
    const query = context.req.query('q');
    if (!query) {
      return context.json({ error: 'Query string ?q= required' }, 400);
    }
    const topK = parseInt(context.req.query('k') || '5', 10);

    try {
      const results = await EmbeddingService.search(query, topK);
      return context.json({ results });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Search failed' }, 500);
    }
  });

  /** Store a new memory */
  app.post('/', async (context) => {
    try {
      const body = await context.req.json<{ content: string; type?: string; sourceId?: string }>();
      if (!body.content?.trim()) {
        return context.json({ error: 'Content required' }, 400);
      }

      const embedding = await EmbeddingService.embed(body.content);
      const record = DatabaseService.upsertMemory({
        type: body.type ?? 'manual',
        content: body.content,
        embedding: JSON.stringify(Array.from(embedding)),
        sourceId: body.sourceId ?? null,
      });

      return context.json({ memory: record }, 201);
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Storage failed' }, 500);
    }
  });

  /** Delete a memory by ID */
  app.delete('/:id', (context) => {
    const id = context.req.param('id');
    const deleted = DatabaseService.deleteMemory(id);
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

        const embedding = await EmbeddingService.embed(msg.content);
        DatabaseService.upsertMemory({
          type: 'conversation',
          content: msg.content.slice(0, 4000),
          embedding: JSON.stringify(Array.from(embedding)),
          metadata: JSON.stringify({ role: msg.role, chatId, chatTitle: chat.title }),
          sourceId: chatId,
        });
        indexed++;
      }

      return context.json({ indexed, chatId });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Indexing failed' }, 500);
    }
  });

  /** Get memory context for injecting into system prompt */
  app.get('/context', async (context) => {
    const query = context.req.query('q');
    if (!query) {
      return context.json({ context: '' });
    }

    try {
      const results = await EmbeddingService.search(query, 3, 0.25);
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
