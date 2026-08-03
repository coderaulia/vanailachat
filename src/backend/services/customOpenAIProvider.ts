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
      return DatabaseService.getSetting('custom_openai_api_key') ?? process.env.CUSTOM_OPENAI_API_KEY ?? '';
    } catch {
      return process.env.CUSTOM_OPENAI_API_KEY ?? '';
    }
  }

  private getBaseUrl(): string {
    try {
      return DatabaseService.getSetting('custom_openai_base_url') ?? process.env.CUSTOM_OPENAI_BASE_URL ?? '';
    } catch {
      return process.env.CUSTOM_OPENAI_BASE_URL ?? '';
    }
  }

  async listModels(): Promise<string[]> {
    const apiKey = this.getApiKey();
    const baseUrl = this.getBaseUrl();
    if (!apiKey || !baseUrl) return [];
    try {
      const response = await fetch(`${baseUrl}/models`, {
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
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) return null;
    try {
      const response = await fetch(`${baseUrl}/models/${modelName}`, {
        headers: { Authorization: `Bearer ${this.getApiKey()}` },
      });
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
