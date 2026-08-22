/**
 * Free Claude Code (FCC) API Route
 *
 * Provides the Anthropic Messages API endpoint (/api/fcc/v1/messages)
 * powered by alishahryar1/free-claude-code integration:
 * https://github.com/alishahryar1/free-claude-code
 */

import { Hono } from 'hono';
import { FreeClaudeCodeService } from '../services/freeClaudeCodeService.js';
import type { AnthropicCreateMessageParams } from '../services/freeClaudeCodeService.js';
import type { AppDependencies } from '../types.js';
import { sanitizeError } from '../helpers/index.js';

export function freeClaudeCodeRouter(dependencies: AppDependencies): Hono {
  const app = new Hono();

  // Status and attribution endpoint
  app.get('/status', (context) => {
    const configuredKey = dependencies.getSetting('anthropic_api_key');
    const externalFccUrl = dependencies.getSetting('fcc_server_url') || process.env.FCC_SERVER_URL;
    return context.json({
      engine: 'Free Claude Code (FCC)',
      source: 'https://github.com/alishahryar1/free-claude-code',
      credit: 'alishahryar1/free-claude-code (MIT License)',
      mode: configuredKey ? 'direct-anthropic' : externalFccUrl ? 'external-fcc' : 'integrated-fcc',
      externalFccUrl: externalFccUrl || null,
      activeProviders: dependencies.providerRegistry.list().map((p) => p.id),
    });
  });

  // Liveness and health probes for Claude Code / Anthropic SDK
  const handleProbe = (context: import('hono').Context) => {
    return context.json({ status: 'ok', service: 'free-claude-code', version: '1.0.0' }, 200);
  };

  app.on(['GET', 'HEAD'], '/', handleProbe);
  app.on(['GET', 'HEAD'], '/health', handleProbe);
  app.on(['GET', 'HEAD'], '/hello', handleProbe);
  app.on(['GET', 'HEAD'], '/api/hello', handleProbe);

  // Claude telemetry & event logging stubs
  const handleEventLogging = (context: import('hono').Context) => context.json({ status: 'ok' }, 200);
  app.post('/api/event_logging/batch', handleEventLogging);
  app.post('/event_logging/batch', handleEventLogging);
  app.post('/api/event_logging', handleEventLogging);
  app.post('/event_logging', handleEventLogging);

  // Account / organization stubs
  const handleAccount = (context: import('hono').Context) =>
    context.json({
      account: {
        id: 'fcc-local-account',
        name: 'Free Claude Code User',
        email: 'local@vanaila.internal',
        subscription_type: 'max',
      },
    }, 200);

  app.get('/api/account', handleAccount);
  app.get('/account', handleAccount);
  app.get('/api/organizations', (context) => context.json({ data: [{ id: 'fcc-org', name: 'Local Workspace' }] }));
  app.get('/organizations', (context) => context.json({ data: [{ id: 'fcc-org', name: 'Local Workspace' }] }));

  // Anthropic list models endpoint
  const handleListModels = async (context: import('hono').Context) => {
    try {
      const allModels = await dependencies.providerRegistry.listAllModels();
      const models = allModels.map((m) => ({
        id: m.name,
        type: 'model',
        display_name: m.name,
        created_at: Math.floor(Date.now() / 1000),
      }));

      return context.json({
        data: models,
        has_more: false,
      });
    } catch (error) {
      return context.json({ error: sanitizeError(error, 'Unable to list models') }, 500);
    }
  };

  app.get('/models', handleListModels);
  app.get('/v1/models', handleListModels);

  // Anthropic create message endpoint
  const handleCreateMessage = async (context: import('hono').Context) => {
    try {
      const body = (await context.req.json()) as AnthropicCreateMessageParams;
      if (!body.model || !body.messages) {
        return context.json(
          {
            type: 'error',
            error: { type: 'invalid_request_error', message: 'model and messages are required' },
          },
          400,
        );
      }

      // Extract latest user message for memory recall/storage
      const lastUserMsg = body.messages.slice().reverse().find((m) => m.role === 'user');
      let userText = '';
      if (lastUserMsg) {
        userText = typeof lastUserMsg.content === 'string'
          ? lastUserMsg.content
          : Array.isArray(lastUserMsg.content)
            ? lastUserMsg.content
                .filter((b) => b.type === 'text' && typeof b.text === 'string')
                .map((b) => b.text)
                .join('\n')
            : '';
      }

      if (userText.trim()) {
        try {
          const queryVec = await dependencies.embedOrNull(userText);
          const memories = queryVec
            ? dependencies.searchMemories(queryVec, 3, 0.3)
            : dependencies.searchMemoriesByKeyword(userText, 3, 0.2);

          if (memories.length > 0) {
            const memoryBlock = memories
              .map((m, i) => `[Memory ${i + 1} (relevance: ${m.score})] ${m.content}`)
              .join('\n\n');
            const systemStr = typeof body.system === 'string'
              ? body.system
              : Array.isArray(body.system)
                ? body.system.map((s) => s.text ?? '').join('\n')
                : '';
            body.system = systemStr
              ? `${systemStr}\n\n[Relevant Memories]\n${memoryBlock}`
              : `[Relevant Memories]\n${memoryBlock}`;
          }

          // Inject active skills
          const enabledSkills = dependencies.listEnabledSkills();
          if (enabledSkills.length > 0) {
            const inlineSkills = dependencies.getSetting('skills_inline') === 'true';
            const skillsSection = inlineSkills
              ? enabledSkills.map((s) => `[Skill: ${s.name}]\n${s.content}`).join('\n\n')
              : `[Active Skills & Guidelines]\n` +
                enabledSkills.map((s) => `- ${s.name}: ${s.description || s.content.slice(0, 120)}`).join('\n');
            const currSystem = typeof body.system === 'string'
              ? body.system
              : Array.isArray(body.system)
                ? body.system.map((s) => s.text ?? '').join('\n')
                : '';
            body.system = currSystem ? `${currSystem}\n\n${skillsSection}` : skillsSection;
          }

          if (userText.trim().length >= 20) {
            dependencies.upsertMemory({
              type: 'conversation',
              content: userText.slice(0, 4000),
              embedding: queryVec,
              metadata: JSON.stringify({ role: 'user', source: 'fcc', model: body.model }),
            });
          }
        } catch (memErr) {
          console.warn('[FCC MEMORY] Failed to recall/save memory:', memErr);
        }
      }

      // Check if user configured an external fcc-server URL
      const externalFccUrl =
        dependencies.getSetting('fcc_server_url') || process.env.FCC_SERVER_URL;
      if (externalFccUrl && externalFccUrl.trim()) {
        const cleanBase = externalFccUrl.trim().replace(/\/+$/, '');
        const targetUrl = cleanBase.endsWith('/v1') ? `${cleanBase}/messages` : `${cleanBase}/v1/messages`;

        const authHeader = context.req.header('authorization') || context.req.header('x-api-key');
        const forwardHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          'anthropic-version': context.req.header('anthropic-version') || '2023-06-01',
        };
        if (authHeader) {
          forwardHeaders['Authorization'] = authHeader;
          forwardHeaders['x-api-key'] = authHeader;
        }

        const externalResponse = await fetch(targetUrl, {
          method: 'POST',
          headers: forwardHeaders,
          body: JSON.stringify(body),
        });

        return new Response(externalResponse.body, {
          status: externalResponse.status,
          headers: externalResponse.headers,
        });
      }

      // Default: Use integrated Free Claude Code proxy engine
      return await FreeClaudeCodeService.handleAnthropicMessage(
        body,
        dependencies.providerRegistry,
      );
    } catch (error) {
      const message = sanitizeError(error, 'Free Claude Code proxy error');
      return context.json(
        {
          type: 'error',
          error: { type: 'api_error', message },
        },
        500,
      );
    }
  };

  app.post('/messages', handleCreateMessage);
  app.post('/v1/messages', handleCreateMessage);

  return app;
}
