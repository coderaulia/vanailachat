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
      const body = await context.req.json() as {
        chatId?: unknown;
        prompt?: unknown;
        mode?: unknown;
        model?: unknown;
        autoApprove?: unknown;
      };
      if (typeof body.chatId !== 'string' || typeof body.prompt !== 'string' || !body.prompt.trim()) {
        return context.json({ error: 'chatId and prompt are required' }, 400);
      }
      const prompt = body.prompt;
      const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;
      const autoApprove = typeof body.autoApprove === 'boolean' ? body.autoApprove : undefined;
      const session = dependencies.getCodingSession(body.chatId);
      if (!session) return context.json({ error: 'Create a coding workspace first' }, 400);
      const harness = dependencies.codingHarnesses.get(session.harness);
      if (!harness) return context.json({ error: 'Coding harness is unavailable' }, 503);
      const mode = body.mode === 'plan' ? 'plan' : 'implement';

      // ── Persistent Chat Memories for Coding Mode ────────────────────────────
      let promptWithMemory = prompt;
      const chatRecord = dependencies.getChat(body.chatId);
      try {
        const queryVec = await dependencies.embedOrNull(prompt);
        const memories = queryVec
          ? dependencies.searchMemories(queryVec, 3, 0.3)
          : dependencies.searchMemoriesByKeyword(prompt, 3, 0.2);

        if (memories.length > 0) {
          const memoryBlock = memories
            .map((m, i) => `[Memory ${i + 1} (relevance: ${m.score})] ${m.content}`)
            .join('\n\n');
          promptWithMemory = `[Relevant Memories & Context]\n${memoryBlock}\n\n[User Request]\n${prompt}`;
        }

        // Inject active skills
        const enabledSkills = dependencies.listEnabledSkills();
        if (enabledSkills.length > 0) {
          const inlineSkills = dependencies.getSetting('skills_inline') === 'true';
          const skillsBlock = inlineSkills
            ? enabledSkills.map((s) => `[Skill: ${s.name}]\n${s.content}`).join('\n\n')
            : `[Active Skills & Guidelines]\n` +
              enabledSkills.map((s) => `- ${s.name}: ${s.description || s.content.slice(0, 120)}`).join('\n');
          promptWithMemory = `${skillsBlock}\n\n${promptWithMemory}`;
        }

        if (prompt.trim().length >= 20) {
          dependencies.upsertMemory({
            type: 'conversation',
            content: prompt.slice(0, 4000),
            embedding: queryVec,
            metadata: JSON.stringify({
              role: 'user',
              mode: 'coding',
              chatId: body.chatId,
              chatTitle: chatRecord?.title ?? null,
            }),
            sourceId: body.chatId,
          });
        }
      } catch (error) {
        console.error('[CODING CONTEXT] Memory/skills recall failed:', error);
      }

      const controller = new AbortController();
      let fullAssistantText = '';

      const stream = new ReadableStream({
        async start(streamController) {
          const encoder = new TextEncoder();
          const emit = (event: unknown) => streamController.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          try {
            for await (const event of harness.run({
              prompt: promptWithMemory,
              cwd: session.workspacePath,
              sessionId: session.harnessSessionId,
              mode,
              model,
              autoApprove,
              signal: controller.signal,
              onApproval: (approval) => emit({ approval_request: approval }),
            })) {
              if (event.type === 'session') {
                dependencies.upsertCodingSession({ ...session, harnessSessionId: event.sessionId, status: 'running' });
              }
              if (event.type === 'text' && event.text) {
                fullAssistantText += event.text;
              }
              emit({ coding_event: event });
            }
            dependencies.upsertCodingSession({ ...session, status: 'ready' });

            // Persist assistant summary memory for coding mode
            if (fullAssistantText.trim().length >= 40) {
              try {
                const ansVec = await dependencies.embedOrNull(fullAssistantText.slice(0, 2000));
                dependencies.upsertMemory({
                  type: 'conversation',
                  content: fullAssistantText.slice(0, 4000),
                  embedding: ansVec,
                  metadata: JSON.stringify({
                    role: 'assistant',
                    mode: 'coding',
                    chatId: body.chatId,
                    chatTitle: chatRecord?.title ?? null,
                  }),
                  sourceId: body.chatId,
                });
              } catch (err) {
                console.warn('[CODING MEMORY] Assistant memory store failed:', err);
              }
            }

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
