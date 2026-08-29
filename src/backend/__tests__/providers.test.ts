import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseService } from '../services/database.js';
import { OpenRouterProvider } from '../services/openRouterProvider.js';
import { OpenAIProvider } from '../services/openaiProvider.js';
import { CustomOpenAIProvider } from '../services/customOpenAIProvider.js';

function freshDb(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vanaila-prov-')), 'test.sqlite');
}

function resetSingleton() {
  (DatabaseService as unknown as { db: { close: () => void } | null }).db?.close();
  (DatabaseService as unknown as { db: unknown }).db = null;
}

describe('LLM Providers database settings and model resolution', () => {
  const originalFetch = globalThis.fetch;
  let dbPath: string;

  beforeEach(() => {
    dbPath = freshDb();
    resetSingleton();
    DatabaseService.initialize(dbPath);
  });

  afterEach(() => {
    resetSingleton();
    try {
      if (fs.existsSync(dbPath)) fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {
      // best-effort
    }
    globalThis.fetch = originalFetch;
  });

  it('OpenRouterProvider dynamically reads openrouter_api_key from DB and lists models', async () => {
    DatabaseService.upsertSetting('openrouter_api_key', 'sk-or-v1-testkey');
    DatabaseService.upsertSetting('openrouter_base_url', 'https://openrouter.ai/api/v1/');

    let capturedUrl = '';
    let capturedHeaders: HeadersInit | undefined;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = init?.headers;
      return new Response(
        JSON.stringify({
          data: [{ id: 'anthropic/claude-3.5-sonnet' }, { id: 'openai/gpt-4o' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const provider = new OpenRouterProvider();
    const models = await provider.listModels();

    expect(capturedUrl).toBe('https://openrouter.ai/api/v1/models');
    const headers = capturedHeaders as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-or-v1-testkey');
    expect(headers['HTTP-Referer']).toBe('https://github.com/coderaulia/vanailachat');
    expect(models).toEqual(['anthropic/claude-3.5-sonnet', 'openai/gpt-4o']);
  });

  it('OpenAIProvider dynamically reads openai_api_key from DB and lists models', async () => {
    DatabaseService.upsertSetting('openai_api_key', 'sk-proj-testkey');
    DatabaseService.upsertSetting('openai_base_url', 'https://api.openai.com/v1');

    let capturedUrl = '';
    let capturedHeaders: HeadersInit | undefined;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = init?.headers;
      return new Response(
        JSON.stringify({
          data: [{ id: 'gpt-4o' }, { id: 'o1' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const provider = new OpenAIProvider();
    const models = await provider.listModels();

    expect(capturedUrl).toBe('https://api.openai.com/v1/models');
    const headers = capturedHeaders as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-proj-testkey');
    expect(models).toEqual(['gpt-4o', 'o1']);
  });

  it('CustomOpenAIProvider supports keyless local server (LM Studio/vLLM)', async () => {
    DatabaseService.upsertSetting('custom_openai_base_url', 'http://localhost:1234/v1');
    DatabaseService.upsertSetting('custom_openai_api_key', '');

    let capturedUrl = '';
    let capturedHeaders: HeadersInit | undefined;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = init?.headers;
      return new Response(
        JSON.stringify({
          data: [{ id: 'local-model-1' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const provider = new CustomOpenAIProvider();
    const models = await provider.listModels();

    expect(capturedUrl).toBe('http://localhost:1234/v1/models');
    const headers = capturedHeaders as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
    expect(models).toEqual(['local-model-1']);
    expect(await provider.isModelAvailable('local-model-1')).toBe(true);
  });

  it('CustomOpenAIProvider falls back to custom_openai_models when remote discovery fails', async () => {
    DatabaseService.upsertSetting('custom_openai_base_url', 'https://api.vikey.ai/v1');
    DatabaseService.upsertSetting('custom_openai_api_key', 'vk-test-key');
    DatabaseService.upsertSetting('custom_openai_models', 'gpt-4o, claude-3-7-sonnet, deepseek-chat');

    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    }) as typeof fetch;

    const provider = new CustomOpenAIProvider();
    const models = await provider.listModels();

    expect(models).toEqual(['gpt-4o', 'claude-3-7-sonnet', 'deepseek-chat']);
    expect(await provider.isModelAvailable('claude-3-7-sonnet')).toBe(true);
    expect(await provider.isModelAvailable('non-existent-model')).toBe(false);
  });

  it('CustomOpenAIProvider sanitizes base URL containing /chat/completions suffix', async () => {
    DatabaseService.upsertSetting('custom_openai_base_url', 'https://api.vikey.ai/v1/chat/completions/');
    DatabaseService.upsertSetting('custom_openai_api_key', 'vk-test-key');
    DatabaseService.upsertSetting('custom_openai_models', 'gpt-4o');

    let capturedUrl = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({
          data: [{ id: 'remote-model-1' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const provider = new CustomOpenAIProvider();
    const models = await provider.listModels();

    expect(capturedUrl).toBe('https://api.vikey.ai/v1/models');
    expect(models).toContain('remote-model-1');
    expect(models).toContain('gpt-4o');
  });

  it('OpenRouterProvider extracts context_length including 1M context models', async () => {
    DatabaseService.upsertSetting('openrouter_api_key', 'sk-or-v1-testkey');
    DatabaseService.upsertSetting('openrouter_base_url', 'https://openrouter.ai/api/v1');

    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: '0x-alpha/model',
              name: 'Ox Alpha',
              context_length: 1000000,
              architecture: { modality: 'text->text' },
            },
            {
              id: 'anthropic/claude-3.5-sonnet',
              name: 'Claude 3.5 Sonnet',
              context_length: 200000,
              architecture: { modality: 'text+image->text' },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const provider = new OpenRouterProvider();
    const metadata = await provider.getInstalledModelMetadata();

    expect(metadata).toHaveLength(2);
    expect(metadata[0]).toMatchObject({
      name: '0x-alpha/model',
      contextWindow: 1000000,
    });
    expect(metadata[1]).toMatchObject({
      name: 'anthropic/claude-3.5-sonnet',
      contextWindow: 200000,
      capabilities: ['chat', 'vision', 'tools'],
    });
  });

  it('CustomOpenAIProvider.getAllProviders parses custom_openai_providers JSON', () => {
    DatabaseService.upsertSetting(
      'custom_openai_providers',
      JSON.stringify([
        { id: 'custom-vikey', name: 'Vikey AI', baseUrl: 'https://api.vikey.ai/v1', apiKey: 'vk-1', models: 'gpt-5.5' },
        { id: 'custom-groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'gq-1', models: 'llama-3.3' },
      ]),
    );

    const providers = CustomOpenAIProvider.getAllProviders();
    expect(providers).toHaveLength(2);
    expect(providers[0].id).toBe('custom-vikey');
    expect(providers[0].label).toBe('Vikey AI');
    expect(providers[1].id).toBe('custom-groq');
    expect(providers[1].label).toBe('Groq');
  });

  it('OpenAIProvider returns empty list when no OpenAI API key is set', async () => {
    DatabaseService.upsertSetting('openai_api_key', '');
    const provider = new OpenAIProvider();
    const models = await provider.listModels();
    expect(models).toEqual([]);
  });

  it('OpenAIProvider ignores OpenRouter keys and endpoints', async () => {
    DatabaseService.upsertSetting('openai_api_key', 'sk-or-v1-test-openrouter-key');
    DatabaseService.upsertSetting('openai_base_url', 'https://openrouter.ai/api/v1');
    const provider = new OpenAIProvider();
    const models = await provider.listModels();
    expect(models).toEqual([]);
  });
});
