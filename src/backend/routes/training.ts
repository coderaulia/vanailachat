import { Hono } from 'hono';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { AppDependencies } from '../types.js';

/**
 * Fine-tune training data export.
 *
 * Endpoints:
 *   GET  /api/training/stats           — counts of available training pairs
 *   POST /api/training/export          — write JSONL dataset to disk
 *     body: {
 *       format?: 'sharegpt' | 'alpaca',
 *       includeDistillation?: boolean,  // blend pairs from top-rated chats
 *       distillationRatio?: number,     // fraction of output to fill with distilled pairs (0–1, default 0.3)
 *     }
 *     returns: { path, pairs, format, explicit, distilled }
 *
 * See scripts/finetune/README.md for the recommended pipeline.
 */
export function trainingRouter(dependencies: AppDependencies): Hono {
  const app = new Hono();

  const exportDir = path.resolve(process.cwd(), 'data', 'training');

  app.get('/stats', (context) => {
    try {
      const pairs = dependencies.listTrainingPairs();
      const explicit = pairs.filter((p) => !p.edited).length;
      const edited = pairs.filter((p) => p.edited).length;
      const oldest = pairs.length > 0 ? pairs[0].createdAt : null;
      const newest = pairs.length > 0 ? pairs[pairs.length - 1].createdAt : null;

      // Distillation preview: top-scoring chats + their pair count
      const topChatIds = dependencies.listHighScoringChats(20);
      const distillationPairs = dependencies.listDistillationPairs(topChatIds);
      // Implicit auto-positive pairs (a subset of the total)
      const implicit = pairs.length - explicit - edited;

      return context.json({
        pairs: pairs.length,
        explicit,
        edited,
        implicit: Math.max(0, implicit),
        distillation: distillationPairs.length,
        topChats: topChatIds.length,
        oldest,
        newest,
      });
    } catch (error) {
      return context.json(
        { error: error instanceof Error ? error.message : 'stats failed' },
        500,
      );
    }
  });

  app.post('/export', async (context) => {
    let format: 'sharegpt' | 'alpaca' = 'sharegpt';
    let includeDistillation = false;
    let distillationRatio = 0.3;

    try {
      const body = (await context.req.json().catch(() => ({}))) as {
        format?: 'sharegpt' | 'alpaca';
        includeDistillation?: boolean;
        distillationRatio?: number;
      };
      if (body.format === 'alpaca' || body.format === 'sharegpt') format = body.format;
      if (typeof body.includeDistillation === 'boolean') includeDistillation = body.includeDistillation;
      if (typeof body.distillationRatio === 'number' && body.distillationRatio > 0 && body.distillationRatio < 1) {
        distillationRatio = body.distillationRatio;
      }
    } catch {
      // empty body is fine
    }

    try {
      const explicitPairs = dependencies.listTrainingPairs();
      if (explicitPairs.length === 0) {
        return context.json(
          { error: 'No positive-rated training pairs found. Rate some assistant messages with thumbs-up first.' },
          400,
        );
      }

      let distilledPairs: typeof explicitPairs = [];
      if (includeDistillation) {
        const topChatIds = dependencies.listHighScoringChats(20);
        distilledPairs = dependencies.listDistillationPairs(topChatIds);
        // Remove any pairs already covered by explicit to avoid duplicates
        const explicitMsgSet = new Set(explicitPairs.map((p) => p.userContent + '\x00' + p.assistantContent));
        distilledPairs = distilledPairs.filter(
          (p) => !explicitMsgSet.has(p.userContent + '\x00' + p.assistantContent),
        );
        // Cap distillation to the requested ratio
        const targetDistilled = Math.round((explicitPairs.length * distillationRatio) / (1 - distillationRatio));
        if (distilledPairs.length > targetDistilled) {
          distilledPairs = distilledPairs.slice(0, targetDistilled);
        }
      }

      // Shuffle distilled pairs in so they're interleaved, not all at end
      const allPairs = [...explicitPairs];
      for (let i = 0; i < distilledPairs.length; i++) {
        const insertAt = Math.floor(Math.random() * (allPairs.length + 1));
        allPairs.splice(insertAt, 0, distilledPairs[i]);
      }

      await fs.mkdir(exportDir, { recursive: true });

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `train-${format}-${stamp}.jsonl`;
      const filePath = path.join(exportDir, filename);

      const lines = allPairs.map((p) => {
        if (format === 'alpaca') {
          return JSON.stringify({
            instruction: p.userContent,
            input: '',
            output: p.assistantContent,
          });
        }
        return JSON.stringify({
          messages: [
            { role: 'user', content: p.userContent },
            { role: 'assistant', content: p.assistantContent },
          ],
        });
      });

      await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8');

      return context.json({
        path: filePath,
        pairs: allPairs.length,
        explicit: explicitPairs.length,
        distilled: distilledPairs.length,
        format,
        filename,
      });
    } catch (error) {
      return context.json(
        { error: error instanceof Error ? error.message : 'export failed' },
        500,
      );
    }
  });

  return app;
}
