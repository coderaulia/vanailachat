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
 * OpenRouter provider — routes to 100+ models via OpenRouter's API.
 * Uses openrouter_api_key (or legacy openrouter-configured openai_api_key) / OPENROUTER_API_KEY env.
 */
export class OpenRouterProvider implements LLMProvider {
  readonly id = 'openrouter';
  readonly label = 'OpenRouter';

  constructor() {}

  private getApiKey(): string {
    try {
      const directKey = DatabaseService.getSetting('openrouter_api_key');
      if (directKey?.trim()) return directKey.trim();
      const legacyBaseUrl = DatabaseService.getSetting('openai_base_url');
      if (legacyBaseUrl?.includes('openrouter')) {
        const legacyKey = DatabaseService.getSetting('openai_api_key');
        if (legacyKey?.trim()) return legacyKey.trim();
      }
      return (process.env.OPENROUTER_API_KEY ?? '').trim();
    } catch {
      return (process.env.OPENROUTER_API_KEY ?? '').trim();
    }
  }

  private getBaseUrl(): string {
    try {
      const url = DatabaseService.getSetting('openrouter_base_url') ?? process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
      return url.trim().replace(/\/+$/, '');
    } catch {
      return (process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1').trim().replace(/\/+$/, '');
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
      const response = await appFetch(`${baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://github.com/coderaulia/vanailachat',
          'X-Title': 'VanailaChat',
        },
      });
      if (!response.ok) return [];
      const data = (await response.json()) as {
        data?: Array<{
          id: string;
          name?: string;
          context_length?: number;
          top_provider?: { context_length?: number; max_completion_tokens?: number };
          architecture?: { modality?: string; instruct_type?: string };
          pricing?: Record<string, unknown>;
        }>;
      };

      return (data.data ?? []).map((m) => {
        const contextWindow =
          typeof m.context_length === 'number' && m.context_length > 0
            ? m.context_length
            : typeof m.top_provider?.context_length === 'number' && m.top_provider.context_length > 0
            ? m.top_provider.context_length
            : null;

        const isVision =
          typeof m.architecture?.modality === 'string' &&
          m.architecture.modality.toLowerCase().includes('image');

        return {
          name: m.id,
          model: m.id,
          contextWindow,
          capabilities: isVision ? ['chat', 'vision', 'tools'] : ['chat', 'tools'],
          architecture: m.architecture?.instruct_type ?? null,
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
    if (!this.getApiKey() || !this.getBaseUrl()) return false;
    const models = await this.listModels();
    return models.includes(modelName);
  }

  async chatStream(request: ChatRequest, signal?: AbortSignal): Promise<Response> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('OpenRouter API key not configured. Please add your API key in Settings → AI Connection (or set OPENROUTER_API_KEY in .env)');
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
      providerLabel: 'OpenRouter',
      signal,
    });

    return openAIStreamToNDJSON(sseResponse, request.model);
  }

  async chat(request: ChatRequest, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('OpenRouter API key not configured. Please add your API key in Settings → AI Connection (or set OPENROUTER_API_KEY in .env)');
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
      providerLabel: 'OpenRouter',
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
