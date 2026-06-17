import { Hono } from 'hono';
import type { AppDependencies } from '../types.js';

/**
 * A/B model comparison harness.
 *
 * POST /api/ab
 *   body: { prompt: string, modelA: string, modelB: string, systemPrompt?: string }
 *   returns: { a: { model, content, latencyMs }, b: { model, content, latencyMs } }
 *
 * POST /api/ab/pick
 *   body: { userContent: string, winnerContent: string, winnerModel: string, loserModel?: string }
 *   Saves the winning response as a +1 training pair.
 *   returns: { chatId, messageId }
 */
export function abRouter(dependencies: AppDependencies): Hono {
  const app = new Hono();

  app.post('/', async (context) => {
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: 'Invalid JSON body' }, 400);
    }

    const b = (body ?? {}) as Record<string, unknown>;

    if (typeof b.prompt !== 'string' || !b.prompt.trim()) {
      return context.json({ error: 'prompt: required string' }, 400);
    }
    if (typeof b.modelA !== 'string' || !b.modelA.trim()) {
      return context.json({ error: 'modelA: required string' }, 400);
    }
    if (typeof b.modelB !== 'string' || !b.modelB.trim()) {
      return context.json({ error: 'modelB: required string' }, 400);
    }

    const prompt = b.prompt as string;
    const modelA = b.modelA as string;
    const modelB = b.modelB as string;
    const systemContent = typeof b.systemPrompt === 'string' && b.systemPrompt.trim()
      ? b.systemPrompt
      : 'You are a helpful assistant.';

    const messages = [
      { role: 'system', content: systemContent },
      { role: 'user', content: prompt },
    ];

    const runModel = async (modelId: string): Promise<{ model: string; content: string; latencyMs: number }> => {
      const { provider, modelName } = dependencies.providerRegistry.resolveModel(modelId);
      const start = Date.now();
      const response = await provider.chat(
        { model: modelName, messages, stream: false } as Parameters<typeof provider.chat>[0],
        context.req.raw.signal,
      );
      const latencyMs = Date.now() - start;
      // Extract text from Ollama or OpenAI-shaped response
      const content: string =
        (response as { message?: { content?: string } }).message?.content ??
        (response as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ??
        '';
      return { model: modelId, content, latencyMs };
    };

    try {
      const [resultA, resultB] = await Promise.all([runModel(modelA), runModel(modelB)]);
      return context.json({ a: resultA, b: resultB });
    } catch (error) {
      return context.json(
        { error: error instanceof Error ? error.message : 'A/B run failed' },
        500,
      );
    }
  });

  app.post('/pick', async (context) => {
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: 'Invalid JSON body' }, 400);
    }

    const b = (body ?? {}) as Record<string, unknown>;

    if (typeof b.userContent !== 'string' || !b.userContent.trim()) {
      return context.json({ error: 'userContent: required string' }, 400);
    }
    if (typeof b.winnerContent !== 'string' || !b.winnerContent.trim()) {
      return context.json({ error: 'winnerContent: required string' }, 400);
    }
    if (typeof b.winnerModel !== 'string' || !b.winnerModel.trim()) {
      return context.json({ error: 'winnerModel: required string' }, 400);
    }

    try {
      const result = dependencies.recordAbPick({
        userContent: b.userContent as string,
        assistantContent: b.winnerContent as string,
        winnerModel: b.winnerModel as string,
        loserModel: typeof b.loserModel === 'string' ? b.loserModel : undefined,
      });

      // Fire-and-forget embed for RAG boost
      (async () => {
        try {
          const content = (b.winnerContent as string).slice(0, 4000);
          if (content.length >= 20) {
            const embedding = await dependencies.embed(content);
            dependencies.upsertMemory({
              type: 'assistant_positive',
              content,
              embedding,
              metadata: JSON.stringify({
                role: 'assistant',
                rating: 1,
                source: 'ab_pick',
                winnerModel: b.winnerModel,
                messageId: result.messageId,
                chatId: result.chatId,
              }),
              sourceId: result.chatId,
            });
          }
        } catch (err) {
          console.warn('[AB PICK] embed failed:', err instanceof Error ? err.message : err);
        }
      })();

      return context.json(result, 201);
    } catch (error) {
      return context.json(
        { error: error instanceof Error ? error.message : 'pick record failed' },
        500,
      );
    }
  });

  return app;
}
