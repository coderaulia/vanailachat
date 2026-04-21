import { Hono } from 'hono';
import type { AppDependencies } from '../types.js';

export function modelsRouter(dependencies: AppDependencies): Hono {
  const app = new Hono();

  app.get('/', async (context) => {
    try {
      const models = await dependencies.getInstalledModels();
      return context.json({ models });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
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
      const message = error instanceof Error ? error.message : 'Unknown error';
      return context.json({ error: message }, 500);
    }
  });

  return app;
}
