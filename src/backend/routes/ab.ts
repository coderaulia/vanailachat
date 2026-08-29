import { Hono } from 'hono';
import { sanitizeError } from '../helpers/index.js';
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
    const searchEnabled = Boolean(b.search);
    const deepResearchEnabled = Boolean(b.deepResearch);
    const attachments = Array.isArray(b.attachments)
      ? (b.attachments as Array<{ type?: string; name?: string; content?: string }>)
      : [];

    let systemContent = typeof b.systemPrompt === 'string' && b.systemPrompt.trim()
      ? b.systemPrompt.trim()
      : 'You are a helpful assistant.';

    // Deep research: synthesize relevant vector memories and web grounding
    if (deepResearchEnabled) {
      try {
        const memories = await dependencies.searchMemoriesByText(prompt, 5, 0.25);
        if (memories.length > 0) {
          const memoryBlock = memories
            .map((m, i) => `[Memory ${i + 1} (relevance: ${m.score.toFixed(2)})] ${m.content}`)
            .join('\n\n');
          systemContent += `\n\n[Relevant Memories]\n${memoryBlock}`;
        }
      } catch (err) {
        console.warn('[AB] Memory recall failed in deep research:', err instanceof Error ? err.message : err);
      }

      try {
        const searchResults = await dependencies.executeTool('search_web', { query: prompt }, null);
        if (searchResults && searchResults.trim()) {
          systemContent += `\n\n[Deep Web Research Grounding]\n${searchResults}`;
        }
      } catch (err) {
        console.warn('[AB] Web search failed in deep research:', err instanceof Error ? err.message : err);
      }
    } else if (searchEnabled) {
      try {
        const searchResults = await dependencies.executeTool('search_web', { query: prompt }, null);
        if (searchResults && searchResults.trim()) {
          systemContent += `\n\n[Web Search Results]\n${searchResults}`;
        }
      } catch (err) {
        console.warn('[AB] Web search failed:', err instanceof Error ? err.message : err);
      }
    }

    // Process attachments
    const textAttachments = attachments.filter((a) => a && a.type !== 'image' && a.content);
    const imageAttachments = attachments.filter((a) => a && a.type === 'image' && a.content);

    let promptText = prompt;
    if (textAttachments.length > 0) {
      const fileBlocks = textAttachments
        .map((a) => `[File: ${a.name || 'attachment'}]\n\`\`\`\n${a.content}\n\`\`\``)
        .join('\n\n');
      promptText = `${fileBlocks}\n\n${promptText}`;
    }

    const userContent = imageAttachments.length > 0
      ? [
          { type: 'text', text: promptText },
          ...imageAttachments.map((img) => ({
            type: 'image_url',
            image_url: { url: img.content as string },
          })),
        ]
      : promptText;

    const messages = [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent },
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
        { error: sanitizeError(error, 'A/B run failed') },
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
        { error: sanitizeError(error, 'pick record failed') },
        500,
      );
    }
  });

  return app;
}
