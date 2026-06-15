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
 *                                        body: { format?: 'sharegpt' | 'alpaca' }
 *                                        returns: { path, pairs, format }
 *
 * The exported file is consumed by an external LoRA trainer (Unsloth,
 * Llama-Factory, axolotl). See scripts/finetune/README.md for the
 * recommended pipeline.
 */
export function trainingRouter(dependencies: AppDependencies): Hono {
  const app = new Hono();

  /** Output directory for exports — at repo root by default. */
  const exportDir = path.resolve(process.cwd(), 'data', 'training');

  app.get('/stats', (context) => {
    try {
      const pairs = dependencies.listTrainingPairs();
      const edited = pairs.filter((p) => p.edited).length;
      const oldest = pairs.length > 0 ? pairs[0].createdAt : null;
      const newest = pairs.length > 0 ? pairs[pairs.length - 1].createdAt : null;
      return context.json({
        pairs: pairs.length,
        edited,
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
    try {
      const body = (await context.req.json().catch(() => ({}))) as {
        format?: 'sharegpt' | 'alpaca';
      };
      if (body.format === 'alpaca' || body.format === 'sharegpt') {
        format = body.format;
      }
    } catch {
      // empty body is fine
    }

    try {
      const pairs = dependencies.listTrainingPairs();
      if (pairs.length === 0) {
        return context.json(
          { error: 'No positive-rated training pairs found. Rate some assistant messages with thumbs-up first.' },
          400,
        );
      }

      await fs.mkdir(exportDir, { recursive: true });

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `train-${format}-${stamp}.jsonl`;
      const filePath = path.join(exportDir, filename);

      const lines = pairs.map((p) => {
        if (format === 'alpaca') {
          return JSON.stringify({
            instruction: p.userContent,
            input: '',
            output: p.assistantContent,
          });
        }
        // sharegpt
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
        pairs: pairs.length,
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
