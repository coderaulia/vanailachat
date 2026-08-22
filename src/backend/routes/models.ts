import { Hono } from 'hono';
import { sanitizeError } from '../helpers/index.js';
import type { AppDependencies } from '../types.js';

export function modelsRouter(dependencies: AppDependencies): Hono {
  const app = new Hono();

  app.get('/', async (context) => {
    try {
      // Ollama is optional — a missing local install must not hide cloud models
      const modelsWithMetadata = await dependencies.getInstalledModelMetadata().catch(() => []);

      // Get models from provider registry (includes multi-provider)
      const providerModels = await dependencies.providerRegistry.listAllModels();
      
      // Combine and deduplicate
      const modelMap = new Map<string, { name: string; provider: string; metadata?: Record<string, unknown> }>();
      
      // Add Ollama models
      for (const model of modelsWithMetadata) {
        modelMap.set(model.name, {
          name: model.name,
          provider: 'ollama',
          metadata: model as unknown as Record<string, unknown>,
        });
      }
      
      // Add provider registry models (skip duplicates)
      for (const providerModel of providerModels) {
        if (!modelMap.has(providerModel.name)) {
          modelMap.set(providerModel.name, {
            name: providerModel.name,
            provider: providerModel.provider,
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
        providers: models.map(m => ({ name: m.name, provider: m.provider })),
      });
    } catch (error) {
      const message = sanitizeError(error, 'Unknown error');
      return context.json({ error: message }, 500);
    }
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
