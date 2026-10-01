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

  describe('credentials', () => {
    const put = (app: ReturnType<typeof createApp>, key: string, value: unknown) =>
      app.request(`/api/settings/${key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) });

    it('never returns a stored key, only a mask', async () => {
      const providers = JSON.stringify([{ id: 'custom', name: 'Mock', baseUrl: 'http://x', apiKey: 'sk-live-1234567890abcd' }]);
      const getAllSettings = vi.fn().mockReturnValue({
        openai_api_key: 'sk-live-1234567890abcd',
        pi_api_key: 'short',
        openrouter_api_key: '',
        custom_openai_providers: providers,
        ollama_host: 'http://localhost:11434',
      });
      const app = createApp({ getAllSettings, getSetting: vi.fn().mockReturnValue('sk-live-1234567890abcd') });

      const { settings } = (await (await app.request('/api/settings')).json()) as { settings: Record<string, string> };
      expect(settings.openai_api_key).toBe('••••abcd');
      expect(settings.pi_api_key).toBe('••••');
      expect(settings.openrouter_api_key).toBe('');
      expect(settings.ollama_host).toBe('http://localhost:11434');
      expect(JSON.parse(settings.custom_openai_providers)[0].apiKey).toBe('••••abcd');
      expect(JSON.stringify(settings)).not.toContain('sk-live');

      const single = (await (await app.request('/api/settings/openai_api_key')).json()) as { value: string };
      expect(single.value).toBe('••••abcd');
    });

    it('treats a masked key sent back as unchanged, and stores a new or cleared one', async () => {
      const upsertSetting = vi.fn();
      const app = createApp({ upsertSetting });

      expect((await put(app, 'openai_api_key', '••••abcd')).status).toBe(200);
      expect(upsertSetting).not.toHaveBeenCalled();

      await put(app, 'openai_api_key', 'sk-new-key');
      expect(upsertSetting).toHaveBeenLastCalledWith('openai_api_key', 'sk-new-key');
      await put(app, 'openai_api_key', '');
      expect(upsertSetting).toHaveBeenLastCalledWith('openai_api_key', '');
    });

    it('keeps the stored key of a custom provider when the list is saved with masks', async () => {
      const stored = JSON.stringify([
        { id: 'custom', name: 'A', baseUrl: 'http://a', apiKey: 'key-for-a-123456' },
        { id: 'custom_2', name: 'B', baseUrl: 'http://b', apiKey: 'key-for-b-654321' },
      ]);
      const upsertSetting = vi.fn();
      const app = createApp({ upsertSetting, getSetting: vi.fn().mockReturnValue(stored) });

      await put(app, 'custom_openai_providers', JSON.stringify([
        { id: 'custom', name: 'A renamed', baseUrl: 'http://a', apiKey: '••••3456' },
        { id: 'custom_2', name: 'B', baseUrl: 'http://b', apiKey: 'replaced-key' },
        { id: 'custom_3', name: 'C', baseUrl: 'http://c', apiKey: '••••zzzz' },
      ]));

      const saved = JSON.parse(upsertSetting.mock.calls[0][1] as string) as Array<{ id: string; name: string; apiKey: string }>;
      expect(saved.map((p) => [p.id, p.name, p.apiKey])).toEqual([
        ['custom', 'A renamed', 'key-for-a-123456'],
        ['custom_2', 'B', 'replaced-key'],
        ['custom_3', 'C', ''],
      ]);
    });
  });

  it('rejects odd setting names and non-string values', async () => {
    const upsertSetting = vi.fn();
    const app = createApp({ upsertSetting });
    const put = (key: string, value: unknown) =>
      app.request(`/api/settings/${key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) });

    expect((await put('Bad-Name', 'x')).status).toBe(400);
    expect((await put('theme', 42)).status).toBe(400);
    expect((await put('theme', null)).status).toBe(400);
    expect((await put('note', 'x'.repeat(100_001))).status).toBe(413);
    expect(upsertSetting).not.toHaveBeenCalled();
  });
});
