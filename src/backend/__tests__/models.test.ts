import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { ProviderRegistry } from '../services/providerRegistry';

describe('models route', () => {
  it('orders providers as Ollama, custom, then remaining providers with labels', async () => {
    const registry = new ProviderRegistry();
    const provider = (id: string, label: string) => ({
      id,
      label,
      listModels: async () => [`model-${id}`],
      getModelDetails: async () => null,
      isModelAvailable: async () => true,
      chatStream: async () => new Response(),
      chat: async () => ({}),
    });
    registry.register(provider('openai', 'OpenAI'));
    registry.register(provider('custom-178', 'DeepSeek'));
    registry.register(provider('ollama', 'Ollama'));

    const models = await registry.listAllModels();

    expect(models.map((model) => model.provider)).toEqual([
      'ollama',
      'custom-178',
      'openai',
    ]);
    expect(models.find((model) => model.provider === 'custom-178')?.providerLabel).toBe('DeepSeek');
  });

  it('returns installed models with metadata keyed by model name', async () => {
    const app = createApp({
      // Empty registry keeps the test off the machine's configured cloud providers
      providerRegistry: new ProviderRegistry(),
      getInstalledModelMetadata: async () => [
        {
          name: 'llama3',
          model: 'llama3',
          modifiedAt: null,
          size: null,
          digest: null,
          architecture: 'llama',
          contextWindow: 8192,
          parameters: '8B',
          capabilities: ['completion'],
          family: 'llama',
          families: ['llama'],
          format: 'gguf',
          parameterSize: '8B',
          quantizationLevel: 'Q4_0',
        },
      ],
    });

    const response = await app.request('/api/models');
    const payload = (await response.json()) as {
      models: string[];
      metadata: Record<string, { parameterSize?: string; contextWindow?: number }>;
    };

    expect(response.status).toBe(200);
    expect(payload.models).toEqual(['llama3']);
    expect(payload.metadata.llama3).toMatchObject({
      parameterSize: '8B',
      contextWindow: 8192,
    });
  });

  it('still lists cloud models when Ollama is unavailable', async () => {
    const registry = new ProviderRegistry();
    registry.register({
      id: 'custom',
      label: 'Custom',
      listModels: async () => ['gpt-4o'],
      getModelDetails: async () => null,
      isModelAvailable: async () => true,
      chatStream: async () => new Response(),
      chat: async () => ({}),
    });

    const app = createApp({
      providerRegistry: registry,
      getInstalledModelMetadata: async () => {
        throw new Error('spawn ollama ENOENT');
      },
    });

    const response = await app.request('/api/models');
    const payload = (await response.json()) as { models: string[] };

    expect(response.status).toBe(200);
    expect(payload.models).toEqual(['custom:gpt-4o']);
  });
});
