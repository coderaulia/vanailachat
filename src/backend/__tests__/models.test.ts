import { describe, expect, it } from 'vitest';
import { createApp } from '../app';

describe('models route', () => {
  it('returns installed models with metadata keyed by model name', async () => {
    const app = createApp({
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
});
