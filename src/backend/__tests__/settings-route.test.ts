import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';

describe('settings route', () => {
  it('GET /api/settings returns all', async () => {
    const getAllSettings = vi.fn().mockReturnValue({ theme: 'dark', model: 'llama3' });
    const app = createApp({ getAllSettings });

    const response = await app.request('/api/settings');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { settings: Record<string, string> };
    expect(body.settings).toEqual({ theme: 'dark', model: 'llama3' });
  });

  it('GET /api/settings/:key returns single value', async () => {
    const getSetting = vi.fn().mockReturnValue('dark');
    const app = createApp({ getSetting });

    const response = await app.request('/api/settings/theme');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { key: string; value: string | null };
    expect(body).toEqual({ key: 'theme', value: 'dark' });
    expect(getSetting).toHaveBeenCalledWith('theme');
  });

  it('PUT /api/settings/:key saves value', async () => {
    const upsertSetting = vi.fn();
    const app = createApp({ upsertSetting });

    const response = await app.request('/api/settings/theme', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'light' }),
    });
    expect(response.status).toBe(200);
    expect(upsertSetting).toHaveBeenCalledWith('theme', 'light');
  });

  it('PUT /api/settings/:key allows empty string', async () => {
    const upsertSetting = vi.fn();
    const app = createApp({ upsertSetting });

    const response = await app.request('/api/settings/note', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: '' }),
    });
    expect(response.status).toBe(200);
    expect(upsertSetting).toHaveBeenCalledWith('note', '');
  });
});
