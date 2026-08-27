import type { LLMProvider, ChatRequest } from './provider.js';
import { openAIStreamToNDJSON } from './streamAdapter.js';
import {
  hasToolCalls,
  postChatCompletions,
  toOpenAICompatibleMessage,
  usageToOllamaFields,
  type OpenAIUsage,
} from './openAICompat.js';
import { DatabaseService } from './database.js';
import { appFetch } from './httpClient.js';

/**
 * OpenAI-compatible provider (covers OpenAI, Azure, etc.)
 * Uses database settings with fallback to OPENAI_API_KEY and OPENAI_BASE_URL env vars.
 */
export class OpenAIProvider implements LLMProvider {
  readonly id = 'openai';
  readonly label = 'OpenAI';

  private configuredApiKey?: string;
  private configuredBaseUrl?: string;

  constructor(apiKey?: string, baseUrl?: string) {
    this.configuredApiKey = apiKey;
    this.configuredBaseUrl = baseUrl;
  }

  private getApiKey(): string {
    if (this.configuredApiKey !== undefined) return this.configuredApiKey.trim();
    try {
      const stored = DatabaseService.getSetting('openai_api_key');
      if (stored?.trim() && !stored.startsWith('sk-or-')) return stored.trim();
      const envKey = (process.env.OPENAI_API_KEY ?? '').trim();
      if (envKey && !envKey.startsWith('sk-or-')) return envKey;
      return '';
    } catch {
      const envKey = (process.env.OPENAI_API_KEY ?? '').trim();
      return envKey.startsWith('sk-or-') ? '' : envKey;
    }
  }

  private getBaseUrl(): string {
    if (this.configuredBaseUrl !== undefined) return this.configuredBaseUrl.trim().replace(/\/+$/, '');
    try {
      const url = DatabaseService.getSetting('openai_base_url') ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
      const clean = url.trim().replace(/\/+$/, '');
      if (clean.includes('openrouter.ai')) {
        return 'https://api.openai.com/v1';
      }
      return clean;
    } catch {
      return (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
    }
  }

  async listModels(): Promise<string[]> {
    const metadata = await this.getInstalledModelMetadata();
    return metadata.map((m) => m.name);
  }

  async getInstalledModelMetadata(): Promise<import('./ollama.js').InstalledModelMetadata[]> {
    const apiKey = this.getApiKey();
    const baseUrl = this.getBaseUrl();
    if (!baseUrl || !apiKey) return [];
    try {
      const headers: Record<string, string> = {
        'HTTP-Referer': 'https://github.com/coderaulia/vanailachat',
        'X-Title': 'VanailaChat',
      };
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }
      const response = await appFetch(`${baseUrl}/models`, { headers });
      if (!response.ok) return [];
      const data = (await response.json()) as {
        data?: Array<{
          id: string;
          context_length?: number;
          max_model_len?: number;
        }>;
      };

      return (data.data ?? []).map((m) => {
        let contextWindow: number | null =
          typeof m.context_length === 'number' && m.context_length > 0
            ? m.context_length
            : typeof m.max_model_len === 'number' && m.max_model_len > 0
            ? m.max_model_len
            : null;

        if (!contextWindow) {
          const id = m.id.toLowerCase();
          if (id.includes('o1') || id.includes('o3')) {
            contextWindow = 200_000;
          } else if (id.includes('gpt-4o') || id.includes('gpt-4-turbo') || id.includes('gpt-4.5')) {
            contextWindow = 128_000;
          } else if (id.includes('gpt-4')) {
            contextWindow = 8_192;
          } else if (id.includes('gpt-3.5')) {
            contextWindow = 16_384;
          }
        }

        return {
          name: m.id,
          model: m.id,
          contextWindow,
          capabilities: ['chat', 'tools'],
          architecture: null,
          parameters: null,
          family: null,
          families: null,
          format: null,
          parameterSize: null,
          quantizationLevel: null,
          modifiedAt: null,
          size: null,
          digest: null,
        };
      });
    } catch {
      return [];
    }
  }

  async getModelDetails(modelName: string): Promise<Record<string, unknown> | null> {
    const baseUrl = this.getBaseUrl();
    const apiKey = this.getApiKey();
    if (!baseUrl) return null;
    try {
      const headers: Record<string, string> = {
        'HTTP-Referer': 'https://github.com/coderaulia/vanailachat',
        'X-Title': 'VanailaChat',
      };
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }
      const response = await appFetch(`${baseUrl}/models/${modelName}`, { headers });
      if (!response.ok) return null;
      return (await response.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async isModelAvailable(modelName: string): Promise<boolean> {
    if (!this.getBaseUrl()) return false;
    const models = await this.listModels();
    return models.includes(modelName);
  }

  async chatStream(request: ChatRequest, signal?: AbortSignal): Promise<Response> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('OpenAI API key not configured. Please add your API key in Settings → AI Connection (or set OPENAI_API_KEY in .env)');
    }

    const openaiMessages = request.messages.map(toOpenAICompatibleMessage);

    const body: Record<string, unknown> = {
      model: request.model,
      stream: true,
      messages: openaiMessages,
    };

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools;
      body.tool_choice = 'auto';
    }

    const sseResponse = await postChatCompletions({
      baseUrl: this.getBaseUrl(),
      apiKey,
      body,
      providerLabel: 'OpenAI',
      signal,
    });

    return openAIStreamToNDJSON(sseResponse, request.model);
  }

  async chat(request: ChatRequest, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('OpenAI API key not configured. Please add your API key in Settings → AI Connection (or set OPENAI_API_KEY in .env)');
    }

    const openaiMessages = request.messages.map(toOpenAICompatibleMessage);

    const body: Record<string, unknown> = {
      model: request.model,
      messages: openaiMessages,
    };

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools;
      body.tool_choice = 'auto';
    }

    const response = await postChatCompletions({
      baseUrl: this.getBaseUrl(),
      apiKey,
      body,
      providerLabel: 'OpenAI',
      signal,
    });

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string; tool_calls?: unknown } }>;
      usage?: OpenAIUsage;
    };
    const firstChoice = data.choices?.[0];

    return {
      model: request.model,
      message: {
        role: 'assistant',
        content: firstChoice?.message?.content ?? '',
        ...(hasToolCalls(firstChoice?.message?.tool_calls)
          ? { tool_calls: firstChoice.message.tool_calls }
          : {}),
      },
      done: true,
      ...usageToOllamaFields(data.usage),
    };
  }
}
