import { OllamaService } from './ollama.js';
import { parseOllamaError } from '../helpers/index.js';
import type { ChatMessage, ChatRequest, LLMProvider } from './provider.js';

/**
 * Ollama implementation of the LLMProvider interface.
 * Handles Ollama-specific API format (/api/chat, /api/generate) and model validation.
 */
export class OllamaProvider implements LLMProvider {
  readonly id = 'ollama';
  readonly label = 'Ollama (Local)';

  private fetchFn: typeof fetch;

  constructor(fetchImpl?: typeof fetch) {
    this.fetchFn = fetchImpl ?? fetch;
  }

  private getBaseUrl(): string {
    return OllamaService.getBaseUrl();
  }

  async listModels(): Promise<string[]> {
    return OllamaService.getInstalledModels();
  }

  async getModelDetails(modelName: string): Promise<Record<string, unknown> | null> {
    try {
      const details = await OllamaService.getModelDetails(modelName);
      return details as unknown as Record<string, unknown> | null;
    } catch {
      return null;
    }
  }

  async getInstalledModelMetadata() {
    return OllamaService.getInstalledModelMetadata();
  }

  async isModelAvailable(modelName: string): Promise<boolean> {
    const models = await this.listModels();
    return models.includes(modelName);
  }

  /**
   * Send a streaming request to Ollama's /api/chat endpoint.
   * Returns the upstream Response with NDJSON body.
   */
  async chatStream(request: ChatRequest, signal?: AbortSignal): Promise<Response> {
    const ollamaUrl = this.getBaseUrl();

    // Check if this is an image-only model that needs /api/generate
    const capabilities = await this.resolveCapabilities(request.model);
    const isImageModel = capabilities.includes('image');
    const isChatModel =
      capabilities.length === 0 ||
      capabilities.includes('chat') ||
      (capabilities.includes('text') && !isImageModel);

    if (isImageModel && !isChatModel) {
      return this.generateAsStream(request, ollamaUrl, signal);
    }

    return this.fetchFn(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model: request.model,
        stream: true,
        messages: request.messages,
        tools: request.tools && request.tools.length > 0 ? request.tools : undefined,
      }),
    });
  }

  async chat(request: ChatRequest, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const ollamaUrl = this.getBaseUrl();

    const capabilities = await this.resolveCapabilities(request.model);
    const isImageModel = capabilities.includes('image');
    const isChatModel =
      capabilities.length === 0 ||
      capabilities.includes('chat') ||
      (capabilities.includes('text') && !isImageModel);

    if (isImageModel && !isChatModel) {
      const genResponse = await this.fetchFn(`${ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          model: request.model,
          prompt: this.extractLastUserPrompt(request.messages),
          stream: false,
        }),
      });

      if (!genResponse.ok) {
        throw new Error(parseOllamaError(await genResponse.text()));
      }

      const genPayload = (await genResponse.json()) as Record<string, unknown>;
      const images = (genPayload.images as string[]) || [];
      const imageMarkdown = images
        .map((img: string) => `![Generated Image](data:image/png;base64,${img})`)
        .join('\n\n');

      return {
        model: request.model,
        message: {
          role: 'assistant',
          content: genPayload.response
            ? `${genPayload.response}\n\n${imageMarkdown}`
            : imageMarkdown,
        },
        done: true,
      };
    }

    const response = await this.fetchFn(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model: request.model,
        stream: false,
        messages: request.messages,
        tools: request.tools && request.tools.length > 0 ? request.tools : undefined,
      }),
    });

    if (!response.ok) {
      throw new Error(parseOllamaError(await response.text()));
    }

    return (await response.json()) as Record<string, unknown>;
  }

  private async resolveCapabilities(model: string): Promise<string[]> {
    try {
      const details = (await this.getModelDetails(model)) as { capabilities?: string[] } | null;
      return Array.isArray(details?.capabilities) ? details.capabilities : [];
    } catch {
      return [];
    }
  }

  private extractLastUserPrompt(messages: ChatMessage[]): string {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) throw new Error('No user message found for image generation');
    return lastUser.content;
  }

  /**
   * Convert a /api/generate response into a stream that looks like /api/chat NDJSON.
   * Used for image-only models that don't support the chat API.
   */
  private async generateAsStream(
    request: ChatRequest,
    ollamaUrl: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    const genResponse = await this.fetchFn(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model: request.model,
        prompt: this.extractLastUserPrompt(request.messages),
        stream: false,
      }),
    });

    if (!genResponse.ok) {
      throw new Error(parseOllamaError(await genResponse.text()));
    }

    const genPayload = (await genResponse.json()) as Record<string, unknown>;
    const images = (genPayload.images as string[]) || [];
    const imageMarkdown = images
      .map((img: string) => `![Generated Image](data:image/png;base64,${img})`)
      .join('\n\n');

    const content = genPayload.response
      ? `${genPayload.response}\n\n${imageMarkdown}`
      : imageMarkdown;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              model: request.model,
              message: { role: 'assistant', content },
              done: true,
            }) + '\n',
          ),
        );
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }
}
