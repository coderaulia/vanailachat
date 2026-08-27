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
 * 9Router provider — OpenAI-compatible API proxy that routes to 40+ AI providers.
 * Endpoint: http://localhost:20128/v1 (configurable via settings DB).
 * Uses a dashboard-issued API key stored in the settings key-value store.
 */
export class NineRouterProvider implements LLMProvider {
  readonly id = '9router';
  readonly label = '9Router';

  constructor() {}

  private getApiKey(): string {
    try {
      return (DatabaseService.getSetting('nine_router_api_key') ?? process.env.NINE_ROUTER_API_KEY ?? '').trim();
    } catch {
      return (process.env.NINE_ROUTER_API_KEY ?? '').trim();
    }
  }

  private getBaseUrl(): string {
    try {
      const url = DatabaseService.getSetting('nine_router_host') ?? process.env.NINE_ROUTER_BASE_URL ?? 'http://localhost:20128/v1';
      return url.trim().replace(/\/+$/, '');
    } catch {
      return (process.env.NINE_ROUTER_BASE_URL ?? 'http://localhost:20128/v1').trim().replace(/\/+$/, '');
    }
  }

  async listModels(): Promise<string[]> {
    const apiKey = this.getApiKey();
    const baseUrl = this.getBaseUrl();
    if (!apiKey || !baseUrl) return [];
    try {
      const response = await appFetch(`${baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://github.com/coderaulia/vanailachat',
          'X-Title': 'VanailaChat',
        },
      });
      if (!response.ok) return [];
      const data = (await response.json()) as { data?: Array<{ id: string }> };
      return data.data?.map((m) => m.id) ?? [];
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
    if (!this.getApiKey() || !this.getBaseUrl()) return false;
    const models = await this.listModels();
    return models.includes(modelName);
  }

  async chatStream(
    request: { model: string; messages: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: unknown }>; tools?: unknown[] },
    signal?: AbortSignal,
  ): Promise<Response> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('9Router API key not configured. Please add your API key in Settings → AI Connection (or set NINE_ROUTER_API_KEY in .env)');
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
      providerLabel: '9Router',
      signal,
    });

    return openAIStreamToNDJSON(sseResponse, request.model);
  }

  async chat(
    request: { model: string; messages: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: unknown }>; tools?: unknown[] },
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('9Router API key not configured. Please add your API key in Settings → AI Connection (or set NINE_ROUTER_API_KEY in .env)');
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
      providerLabel: '9Router',
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
