import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import type { AppDependencies } from '../types.js';
import { sanitizeError } from '../helpers/index.js';

function validateWorkspacePath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const resolved = path.resolve(value);
  try {
    return fs.statSync(resolved).isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

export function codingRouter(dependencies: AppDependencies): Hono {
  const app = new Hono();

  app.get('/harnesses', async (context) => {
    try {
      return context.json({ harnesses: await dependencies.codingHarnesses.list() });
    } catch (error) {
      return context.json({ error: sanitizeError(error, 'Unable to check coding harnesses') }, 500);
    }
  });

  app.get('/sessions/:chatId', (context) => {
    try {
      return context.json({ session: dependencies.getCodingSession(context.req.param('chatId')) });
    } catch (error) {
      return context.json({ error: sanitizeError(error, 'Unable to load coding session') }, 500);
    }
  });

  app.post('/sessions', async (context) => {
    try {
      const body = await context.req.json() as { chatId?: unknown; harness?: unknown; workspacePath?: unknown };
      if (typeof body.chatId !== 'string' || !body.chatId.trim()) {
        return context.json({ error: 'chatId is required' }, 400);
      }
      if (typeof body.harness !== 'string' || !dependencies.codingHarnesses.get(body.harness)) {
        return context.json({ error: 'Unknown coding harness' }, 400);
      }
      const workspacePath = validateWorkspacePath(body.workspacePath);
      if (!workspacePath) return context.json({ error: 'A valid workspace directory is required' }, 400);

      return context.json({ session: dependencies.upsertCodingSession({
        chatId: body.chatId, harness: body.harness, workspacePath, status: 'ready',
      }) }, 201);
    } catch (error) {
      return context.json({ error: sanitizeError(error, 'Unable to save coding session') }, 500);
    }
  });

  return app;
}
