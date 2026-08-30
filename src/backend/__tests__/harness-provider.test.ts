import { describe, expect, it, vi, afterEach } from 'vitest';
import { DatabaseService } from '../services/database.js';
import { resolveHarnessProvider } from '../services/harnessProvider.js';

describe('shared coding harness provider resolution', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reuses a configured custom provider selected in Vanaila', () => {
    vi.spyOn(DatabaseService, 'getSetting').mockImplementation((key: string) => key === 'custom_openai_providers'
      ? JSON.stringify([{ id: 'custom-work', name: 'Work', baseUrl: 'https://work.example/v1', apiKey: 'secret' }])
      : null);
    expect(resolveHarnessProvider('custom-work:deepseek-coder')).toEqual({
      provider: 'custom-work', model: 'deepseek-coder', apiKey: 'secret', baseUrl: 'https://work.example/v1',
    });
  });

  it.each([
    ['openrouter:deepseek/deepseek-chat', 'openrouter', 'deepseek/deepseek-chat', 'https://openrouter.ai/api/v1'],
    ['ollama:qwen3-coder', 'ollama', 'qwen3-coder', 'http://ollama.local:11434/v1'],
    ['9router:deepseek-chat', '9router', 'deepseek-chat', 'http://9router.local/v1'],
  ])('resolves %s without Pi settings', (selected, provider, model, expectedBaseUrl) => {
    vi.spyOn(DatabaseService, 'getSetting').mockImplementation((key: string) => ({
      openrouter_api_key: 'or-secret',
      openrouter_base_url: 'https://openrouter.ai/api/v1',
      ollama_host: 'http://ollama.local:11434',
      nine_router_api_key: '9r-secret',
      nine_router_host: 'http://9router.local/v1',
    }[key] ?? null));
    const resolved = resolveHarnessProvider(selected);
    expect(resolved).toMatchObject({ provider, model, baseUrl: expectedBaseUrl });
    expect(resolved.apiKey).toBe(provider === 'ollama' ? 'ollama' : provider === 'openrouter' ? 'or-secret' : '9r-secret');
  });

  it('falls back to Ollama when no Pi configuration exists', () => {
    vi.spyOn(DatabaseService, 'getSetting').mockReturnValue(null);
    expect(resolveHarnessProvider()).toMatchObject({ provider: 'ollama', apiKey: 'ollama', model: 'deepseek-coder-v2' });
  });
});
