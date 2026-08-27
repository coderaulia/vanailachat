import type { LLMProvider } from './provider.js';
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
 * Custom OpenAI-compatible provider — points at any provider that speaks the
 * OpenAI /chat/completions format (Groq, Together, Fireworks, DeepSeek,
 * Mistral, LM Studio, vLLM, etc). Base URL + API key are user-configured via
 * the settings DB (or env var fallback), like 9Router.
 */
export class CustomOpenAIProvider implements LLMProvider {
  readonly id = 'custom';
  readonly label = 'Custom (OpenAI-compatible)';

  constructor() {}

  private getApiKey(): string {
    try {
      return (DatabaseService.getSetting('custom_openai_api_key') ?? process.env.CUSTOM_OPENAI_API_KEY ?? '').trim();
    } catch {
      return (process.env.CUSTOM_OPENAI_API_KEY ?? '').trim();
    }
  }

  private getBaseUrl(): string {
    try {
      const url = DatabaseService.getSetting('custom_openai_base_url') ?? process.env.CUSTOM_OPENAI_BASE_URL ?? '';
      return url.trim().replace(/\/+$/, '').replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '');
    } catch {
      return (process.env.CUSTOM_OPENAI_BASE_URL ?? '')
        .trim()
        .replace(/\/+$/, '')
        .replace(/\/chat\/completions\/?$/, '')
        .replace(/\/+$/, '');
    }
  }

  private getCustomModels(): string[] {
    let raw = '';
    try {
      raw = DatabaseService.getSetting('custom_openai_models') ?? process.env.CUSTOM_OPENAI_MODELS ?? '';
    } catch {
      raw = process.env.CUSTOM_OPENAI_MODELS ?? '';
    }
    return raw
      .split(/[,\n]+/)
      .map((m) => m.trim())
      .filter(Boolean);
  }

  async listModels(): Promise<string[]> {
    const metadata = await this.getInstalledModelMetadata();
    return metadata.map((m) => m.name);
  }

  async getInstalledModelMetadata(): Promise<import('./ollama.js').InstalledModelMetadata[]> {
    const apiKey = this.getApiKey();
    const baseUrl = this.getBaseUrl();
    const configuredModels = this.getCustomModels();

    if (!baseUrl && configuredModels.length === 0) return [];

    const discoveredMap = new Map<string, import('./ollama.js').InstalledModelMetadata>();

    // 1. If base URL is configured, try dynamic discovery via GET /models
    if (baseUrl) {
      try {
        const headers: Record<string, string> = {
          'HTTP-Referer': 'https://github.com/coderaulia/vanailachat',
          'X-Title': 'VanailaChat',
        };
        if (apiKey) {
          headers.Authorization = `Bearer ${apiKey}`;
        }
        const response = await appFetch(`${baseUrl}/models`, { headers });
        if (response.ok) {
          const data = (await response.json()) as {
            data?: Array<{
              id?: string;
              name?: string;
              context_length?: number;
              max_model_len?: number;
              context_window?: number;
              max_context_length?: number;
            }>;
          } | Array<{ id?: string; name?: string }>;

          const rawList = Array.isArray(data)
            ? data
            : Array.isArray(data.data)
            ? data.data
            : [];

          for (const m of rawList) {
            const id = m.id || m.name;
            if (!id) continue;
            const modelRecord = m as Record<string, unknown>;
            const contextWindow =
              typeof modelRecord.context_length === 'number' && modelRecord.context_length > 0
                ? modelRecord.context_length
                : typeof modelRecord.max_model_len === 'number' && modelRecord.max_model_len > 0
                ? modelRecord.max_model_len
                : typeof modelRecord.context_window === 'number' && modelRecord.context_window > 0
                ? modelRecord.context_window
                : typeof modelRecord.max_context_length === 'number' && modelRecord.max_context_length > 0
                ? modelRecord.max_context_length
                : null;

            discoveredMap.set(id, {
              name: id,
              model: id,
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
            });
          }
        }
      } catch {
        // Fall back to configured models if remote discovery fails
      }
    }

    // 2. Merge user-configured custom models (or use as fallback)
    for (const modelName of configuredModels) {
      if (!discoveredMap.has(modelName)) {
        discoveredMap.set(modelName, {
          name: modelName,
          model: modelName,
          contextWindow: null,
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
        });
      }
    }

    return Array.from(discoveredMap.values());
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
    const configuredModels = this.getCustomModels();
    if (configuredModels.includes(modelName)) return true;
    if (!this.getBaseUrl()) return false;
    const models = await this.listModels();
    return models.includes(modelName);
  }

  async chatStream(
    request: { model: string; messages: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: unknown }>; tools?: unknown[] },
    signal?: AbortSignal,
  ): Promise<Response> {
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
      apiKey: this.getApiKey(),
      body,
      providerLabel: 'Custom provider',
      signal,
    });

    return openAIStreamToNDJSON(sseResponse, request.model);
  }

  async chat(
    request: { model: string; messages: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: unknown }>; tools?: unknown[] },
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
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
      apiKey: this.getApiKey(),
      body,
      providerLabel: 'Custom provider',
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
