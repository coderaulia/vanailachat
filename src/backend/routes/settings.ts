import { Hono } from 'hono';
import { sanitizeError } from '../helpers/index.js';
import type { AppDependencies } from '../types.js';
import {
  MAX_SETTING_VALUE_CHARS,
  isValidSettingKey,
  maskSettingValue,
  maskSettings,
  resolveSettingWrite,
} from '../services/secrets.js';

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
      // Credentials never leave the server; the form shows a mask instead.
      return context.json({ settings: maskSettings(settings) });
    } catch {
      return context.json({ settings: {} });
    }
  });

  /** Get a single setting */
  app.get('/:key', (context) => {
    const key = context.req.param('key');
    try {
      const value = dependencies.getSetting(key);
      return context.json({ key, value: maskSettingValue(key, value) });
    } catch {
      return context.json({ key, value: null });
    }
  });

  /** Set a setting */
  app.put('/:key', async (context) => {
    const key = context.req.param('key');
    if (!isValidSettingKey(key)) {
      return context.json({ error: 'Invalid setting name' }, 400);
    }
    try {
      const body = await context.req.json<{ value: unknown }>();
      if (typeof body.value !== 'string') {
        return context.json({ error: 'value must be a string' }, 400);
      }
      if (body.value.length > MAX_SETTING_VALUE_CHARS) {
        return context.json({ error: 'value is too large' }, 413);
      }
      const toStore = resolveSettingWrite(key, body.value, dependencies.getSetting(key));
      // A masked secret means "unchanged": acknowledge without touching the stored key.
      if (toStore === null) return context.json({ key, value: body.value });
      dependencies.upsertSetting(key, toStore);
      // Provider credentials and hosts live here, so a saved key must drop the
      // cached model listings rather than wait out their TTL.
      dependencies.providerRegistry.invalidateModelCaches();
      return context.json({ key, value: maskSettingValue(key, toStore) });
    } catch (error) {
      return context.json({ error: sanitizeError(error, 'Save failed') }, 500);
    }
  });

  return app;
}
