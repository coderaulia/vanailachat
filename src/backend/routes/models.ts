import { Hono } from 'hono';
import { sanitizeError } from '../helpers/index.js';
import type { AppDependencies } from '../types.js';

/** Ollama model references: `name`, `name:tag`, `namespace/name:tag`. */
export function isValidModelName(name: string): boolean {
  return name.length > 0 && name.length <= 200 && /^[a-zA-Z0-9][a-zA-Z0-9._\-/:]*$/.test(name) && !name.includes('..');
}

export function modelsRouter(dependencies: AppDependencies): Hono {
  const app = new Hono();

  app.get('/', async (context) => {
    try {
      // Ollama is optional — a missing local install must not hide cloud models
      const modelsWithMetadata = await dependencies.getInstalledModelMetadata().catch(() => []);

      // Get models from provider registry (includes multi-provider)
      const providerModels = await dependencies.providerRegistry.listAllModels();
      
      // Combine and deduplicate
      const modelMap = new Map<string, {
        name: string;
        provider: string;
        providerLabel: string;
        metadata?: Record<string, unknown>;
      }>();
      
      // Add Ollama models
      for (const model of modelsWithMetadata) {
        modelMap.set(model.name, {
          name: model.name,
          provider: 'ollama',
          providerLabel: 'Ollama',
          metadata: model as unknown as Record<string, unknown>,
        });
      }
      
      // Add provider registry models (skip duplicates)
      for (const providerModel of providerModels) {
        if (!modelMap.has(providerModel.name)) {
          modelMap.set(providerModel.name, {
            name: providerModel.name,
            provider: providerModel.provider,
            providerLabel: providerModel.providerLabel,
            metadata: (providerModel.metadata as Record<string, unknown>) ?? {},
          });
        }
      }
      
      const models = Array.from(modelMap.values());
      const metadata = Object.fromEntries(
        models.map((model) => [model.name, model.metadata ?? {}])
      );

      return context.json({
        models: models.map(m => m.name),
        metadata,
        providers: models.map(m => ({
          name: m.name,
          provider: m.provider,
          providerLabel: m.providerLabel,
        })),
      });
    } catch (error) {
      const message = sanitizeError(error, 'Unknown error');
      return context.json({ error: message }, 500);
    }
  });

  /**
   * POST /api/models/pull — download an Ollama model, streaming Ollama's own
   * NDJSON progress lines ({status, completed, total}) straight through so
   * the browser can draw a progress bar. An {error} line ends the stream.
   */
  app.post('/pull', async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as { name?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!isValidModelName(name)) {
      return context.json({ error: 'A valid model name is required, e.g. llama3.2:3b' }, 400);
    }

    let upstream: Response;
    try {
      upstream = await dependencies.fetchFn(`${dependencies.getBaseUrl()}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, stream: true }),
        signal: context.req.raw.signal,
      });
    } catch (error) {
      return context.json({ error: sanitizeError(error, 'Ollama is not reachable') }, 502);
    }
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => '');
      return context.json({ error: detail || `Ollama returned HTTP ${upstream.status}` }, 502);
    }

    return new Response(upstream.body, {
      headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' },
    });
  });

  app.get('/details', async (context) => {
    const model = context.req.query('model');
    if (!model) {
      return context.json({ error: 'Model required' }, 400);
    }

    try {
      const details = await dependencies.getModelDetails(model);
      return context.json({ model, ...(details as object) });
    } catch (error) {
      const message = sanitizeError(error, 'Unknown error');
      return context.json({ error: message }, 500);
    }
  });

  return app;
}
