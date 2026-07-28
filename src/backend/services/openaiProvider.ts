import type { LLMProvider, ChatRequest } from './provider.js';
import { openAIStreamToNDJSON } from './streamAdapter.js';
import { postChatCompletions, usageToOllamaFields, type OpenAIUsage } from './openAICompat.js';

/**
 * OpenAI-compatible provider (covers OpenAI, OpenRouter, Azure, etc.)
 * Expects OPENAI_API_KEY and OPENAI_BASE_URL env vars.
 */
export class OpenAIProvider implements LLMProvider {
  readonly id = 'openai';
  readonly label = 'OpenAI / OpenRouter';

  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.baseUrl = baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  }

  async listModels(): Promise<string[]> {
    if (!this.apiKey) return [];
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
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
      const response = await fetch(`${this.baseUrl}/models/${modelName}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!response.ok) return null;
      return (await response.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async isModelAvailable(modelName: string): Promise<boolean> {
    if (!this.apiKey) return false;
    const models = await this.listModels();
    return models.includes(modelName);
  }

  async chatStream(request: ChatRequest, signal?: AbortSignal): Promise<Response> {
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
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      body,
      providerLabel: 'OpenAI',
      signal,
    });

    return openAIStreamToNDJSON(sseResponse, request.model);
  }

  async chat(request: ChatRequest, signal?: AbortSignal): Promise<Record<string, unknown>> {
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
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
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
        ...(firstChoice?.message?.tool_calls ? { tool_calls: firstChoice.message.tool_calls } : {}),
      },
      done: true,
      ...usageToOllamaFields(data.usage),
    };
  }
}
