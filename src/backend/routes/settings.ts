import { Hono } from 'hono';
import type { AppDependencies } from '../types.js';

/**
 * Settings store using a simple key-value table.
 * Built on top of the existing SQLite database.
 */

export function settingsRouter(dependencies: AppDependencies): Hono {
  const app = new Hono();

  /** Get all settings */
  app.get('/', (context) => {
    try {
      const settings = dependencies.getAllSettings();
      return context.json({ settings });
    } catch {
      return context.json({ settings: {} });
    }
  });

  /** Get a single setting */
  app.get('/:key', (context) => {
    const key = context.req.param('key');
    try {
      const value = dependencies.getSetting(key);
      return context.json({ key, value });
    } catch {
      return context.json({ key, value: null });
    }
  });

  /** Set a setting */
  app.put('/:key', async (context) => {
    const key = context.req.param('key');
    try {
      const body = await context.req.json<{ value: string }>();
      if (!body.value && body.value !== '') {
        return context.json({ error: 'value required' }, 400);
      }
      dependencies.upsertSetting(key, body.value);
      return context.json({ key, value: body.value });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Save failed' }, 500);
    }
  });

  return app;
}
