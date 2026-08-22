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
      return (DatabaseService.getSetting('custom_openai_api_key') ?? process.env.CUSTOM_OPENAI_API_KEY ?? '').trim();
    } catch {
      return (process.env.CUSTOM_OPENAI_API_KEY ?? '').trim();
    }
  }

  private getBaseUrl(): string {
    try {
      const url = DatabaseService.getSetting('custom_openai_base_url') ?? process.env.CUSTOM_OPENAI_BASE_URL ?? '';
      return url.trim().replace(/\/+$/, '');
    } catch {
      return (process.env.CUSTOM_OPENAI_BASE_URL ?? '').trim().replace(/\/+$/, '');
    }
  }

  async listModels(): Promise<string[]> {
    const metadata = await this.getInstalledModelMetadata();
    return metadata.map((m) => m.name);
  }

  async getInstalledModelMetadata(): Promise<import('./ollama.js').InstalledModelMetadata[]> {
    const apiKey = this.getApiKey();
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) return [];
    try {
      const headers: Record<string, string> = {
        'HTTP-Referer': 'https://github.com/coderaulia/vanailachat',
        'X-Title': 'VanailaChat',
      };
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }
      const response = await fetch(`${baseUrl}/models`, { headers });
      if (!response.ok) return [];
      const data = (await response.json()) as {
        data?: Array<{
          id: string;
          context_length?: number;
          max_model_len?: number;
          context_window?: number;
          max_context_length?: number;
        }>;
      };

      return (data.data ?? []).map((m) => {
        const contextWindow =
          typeof m.context_length === 'number' && m.context_length > 0
            ? m.context_length
            : typeof m.max_model_len === 'number' && m.max_model_len > 0
            ? m.max_model_len
            : typeof m.context_window === 'number' && m.context_window > 0
            ? m.context_window
            : typeof m.max_context_length === 'number' && m.max_context_length > 0
            ? m.max_context_length
            : null;

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
      const response = await fetch(`${baseUrl}/models/${modelName}`, { headers });
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
