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

  app.post('/run', async (context) => {
    try {
      const body = await context.req.json() as { chatId?: unknown; prompt?: unknown; mode?: unknown; model?: unknown };
      if (typeof body.chatId !== 'string' || typeof body.prompt !== 'string' || !body.prompt.trim()) {
        return context.json({ error: 'chatId and prompt are required' }, 400);
      }
      const prompt = body.prompt;
      const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;
      const session = dependencies.getCodingSession(body.chatId);
      if (!session) return context.json({ error: 'Create a coding workspace first' }, 400);
      const harness = dependencies.codingHarnesses.get(session.harness);
      if (!harness) return context.json({ error: 'Coding harness is unavailable' }, 503);
      const mode = body.mode === 'plan' ? 'plan' : 'implement';
      const controller = new AbortController();
      const stream = new ReadableStream({
        async start(streamController) {
          const encoder = new TextEncoder();
          const emit = (event: unknown) => streamController.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          try {
            for await (const event of harness.run({
              prompt,
              cwd: session.workspacePath,
              sessionId: session.harnessSessionId,
              mode,
              model,
              signal: controller.signal,
              onApproval: (approval) => emit({ approval_request: approval }),
            })) {
              if (event.type === 'session') {
                dependencies.upsertCodingSession({ ...session, harnessSessionId: event.sessionId, status: 'running' });
              }
              emit({ coding_event: event });
            }
            dependencies.upsertCodingSession({ ...session, status: 'ready' });
            streamController.close();
          } catch (error) {
            dependencies.upsertCodingSession({ ...session, status: 'error' });
            emit({ error: sanitizeError(error, 'Claude Code run failed') });
            streamController.close();
          }
        },
        cancel() { controller.abort(); },
      });
      return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } });
    } catch (error) {
      return context.json({ error: sanitizeError(error, 'Unable to start Claude Code') }, 500);
    }
  });

  return app;
}
