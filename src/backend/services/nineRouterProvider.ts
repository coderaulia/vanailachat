import type { LLMProvider } from './provider.js';
import { openAIStreamToNDJSON } from './streamAdapter.js';
import { postChatCompletions, usageToOllamaFields, type OpenAIUsage } from './openAICompat.js';
import { DatabaseService } from './database.js';

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
      return DatabaseService.getSetting('nine_router_api_key') ?? process.env.NINE_ROUTER_API_KEY ?? '';
    } catch {
      return process.env.NINE_ROUTER_API_KEY ?? '';
    }
  }

  private getBaseUrl(): string {
    try {
      return DatabaseService.getSetting('nine_router_host') ?? process.env.NINE_ROUTER_BASE_URL ?? 'http://localhost:20128/v1';
    } catch {
      return process.env.NINE_ROUTER_BASE_URL ?? 'http://localhost:20128/v1';
    }
  }

  async listModels(): Promise<string[]> {
    const apiKey = this.getApiKey();
    if (!apiKey) return [];
    try {
      const response = await fetch(`${this.getBaseUrl()}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) return [];
      const data = (await response.json()) as { data?: Array<{ id: string }> };
      return data.data?.map((m) => m.id) ?? [];
    } catch {
      return [];
    }
  }

  async getModelDetails(modelName: string): Promise<Record<string, unknown> | null> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/models/${modelName}`, {
        headers: { Authorization: `Bearer ${this.getApiKey()}` },
      });
      if (!response.ok) return null;
      return (await response.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async isModelAvailable(modelName: string): Promise<boolean> {
    if (!this.getApiKey()) return false;
    const models = await this.listModels();
    return models.includes(modelName);
  }

  async chatStream(
    request: { model: string; messages: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: unknown }>; tools?: unknown[] },
    signal?: AbortSignal,
  ): Promise<Response> {
    const openaiMessages = request.messages.map((m) => {
      const msg: Record<string, unknown> = { role: m.role, content: m.content };
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      return msg;
    });

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
      providerLabel: '9Router',
      signal,
    });

    return openAIStreamToNDJSON(sseResponse, request.model);
  }

  async chat(
    request: { model: string; messages: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: unknown }>; tools?: unknown[] },
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const openaiMessages = request.messages.map((m) => {
      const msg: Record<string, unknown> = { role: m.role, content: m.content };
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      return msg;
    });

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
        ...(firstChoice?.message?.tool_calls ? { tool_calls: firstChoice.message.tool_calls } : {}),
      },
      done: true,
      ...usageToOllamaFields(data.usage),
    };
  }
}
