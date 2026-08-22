/**
 * Free Claude Code (FCC) Integration Engine
 *
 * Based on the open-source Free Claude Code project by alishahryar1:
 * https://github.com/alishahryar1/free-claude-code (MIT License)
 *
 * This service translates Anthropic Messages API requests (used by Claude Code
 * and other Anthropic-compatible clients) into OpenAI/Ollama compatible formats,
 * enabling Claude Code to run in the browser using existing providers
 * (Ollama, OpenRouter, 9Router, OpenAI, and Custom).
 */

import type { ProviderRegistry } from './providerRegistry.js';
import type { ChatMessage, ChatRequest, ToolDefinition } from './provider.js';

export interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | Array<{ type: string; text?: string }>;
  is_error?: boolean;
  thinking?: string;
}

export interface AnthropicMessageParam {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicCreateMessageParams {
  model: string;
  messages: AnthropicMessageParam[];
  system?: string | Array<{ type: string; text?: string }>;
  max_tokens?: number;
  temperature?: number;
  tools?: AnthropicTool[];
  stream?: boolean;
}

function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export class FreeClaudeCodeService {
  /**
   * Translates Anthropic Messages payload into standard OpenAI/Ollama compatible ChatMessages.
   */
  static translateAnthropicMessages(
    system: string | Array<{ type: string; text?: string }> | undefined,
    messages: AnthropicMessageParam[],
  ): ChatMessage[] {
    const result: ChatMessage[] = [];

    // 1. Process system prompt
    if (system) {
      const systemText =
        typeof system === 'string'
          ? system
          : Array.isArray(system)
            ? system
                .filter((b) => b.type === 'text' && typeof b.text === 'string')
                .map((b) => b.text)
                .join('\n')
            : '';
      if (systemText.trim()) {
        result.push({ role: 'system', content: systemText.trim() });
      }
    }

    // 2. Process conversation turns
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        result.push({ role: msg.role, content: msg.content });
        continue;
      }

      if (!Array.isArray(msg.content)) {
        continue;
      }

      // Check for tool_results inside a user message
      const toolResults = msg.content.filter((b) => b.type === 'tool_result');
      const textBlocks = msg.content.filter((b) => b.type === 'text');
      const toolUseBlocks = msg.content.filter((b) => b.type === 'tool_use');

      if (toolResults.length > 0) {
        // Emit tool response messages (OpenAI format: role 'tool')
        for (const tr of toolResults) {
          const contentText =
            typeof tr.content === 'string'
              ? tr.content
              : Array.isArray(tr.content)
                ? tr.content.map((b) => b.text ?? '').join('\n')
                : JSON.stringify(tr.content ?? '');

          result.push({
            role: 'tool',
            content: contentText,
            tool_call_id: tr.tool_use_id ?? '',
          });
        }
      }

      if (msg.role === 'assistant') {
        const textContent = textBlocks.map((b) => b.text ?? '').join('\n');
        const toolCalls =
          toolUseBlocks.length > 0
            ? toolUseBlocks.map((tu) => ({
                id: tu.id ?? generateId('toolu'),
                type: 'function' as const,
                function: {
                  name: tu.name ?? '',
                  arguments: (tu.input ?? {}) as Record<string, unknown>,
                },
              }))
            : undefined;

        result.push({
          role: 'assistant',
          content: textContent,
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
        });
      } else if (textBlocks.length > 0) {
        result.push({
          role: 'user',
          content: textBlocks.map((b) => b.text ?? '').join('\n'),
        });
      }
    }

    return result;
  }

  /**
   * Translates Anthropic tool definitions into OpenAI function tool definitions.
   */
  static translateAnthropicTools(tools: AnthropicTool[] | undefined): ToolDefinition[] | undefined {
    if (!tools || tools.length === 0) return undefined;
    return tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description ?? '',
        parameters: (t.input_schema ?? { type: 'object', properties: {}, required: [] }) as ToolDefinition['function']['parameters'],
      },
    }));
  }

  /**
   * Converts a provider chat stream into an Anthropic Server-Sent Events (SSE) stream.
   */
  static createAnthropicStream(
    providerResponse: Response,
    modelName: string,
    signal?: AbortSignal,
  ): Response {
    const msgId = generateId('msg');
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const emitEvent = (event: string, data: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        // 1. Initial message_start event
        emitEvent('message_start', {
          type: 'message_start',
          message: {
            id: msgId,
            type: 'message',
            role: 'assistant',
            model: modelName,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 100, output_tokens: 0 },
          },
        });

        let textBlockStarted = false;
        let textBlockIndex = 0;
        let currentBlockIndex = 0;
        let outputTokens = 0;
        const activeToolBlocks = new Map<number, { id: string; name: string }>();

        try {
          if (!providerResponse.body) {
            emitEvent('message_stop', { type: 'message_stop' });
            controller.close();
            return;
          }

          const reader = providerResponse.body.getReader();
          let buffer = '';

          while (true) {
            if (signal?.aborted) break;

            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;

              // Support NDJSON and SSE lines
              let jsonStr = trimmed;
              if (trimmed.startsWith('data: ')) {
                jsonStr = trimmed.slice(6).trim();
                if (jsonStr === '[DONE]') continue;
              }

              let chunk: Record<string, unknown>;
              try {
                chunk = JSON.parse(jsonStr) as Record<string, unknown>;
              } catch {
                continue;
              }

              // Extract text delta
              let textDelta = '';
              const choices = chunk.choices as Array<{
                delta?: { content?: string; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> };
                message?: { content?: string; tool_calls?: unknown[] };
              }> | undefined;

              const delta = choices?.[0]?.delta;
              if (typeof delta?.content === 'string' && delta.content.length > 0) {
                textDelta = delta.content;
              } else if (typeof chunk.response === 'string' && chunk.response.length > 0) {
                textDelta = chunk.response; // Ollama format
              } else if (typeof chunk.content === 'string' && chunk.content.length > 0) {
                textDelta = chunk.content;
              }

              if (textDelta) {
                if (!textBlockStarted) {
                  textBlockStarted = true;
                  textBlockIndex = currentBlockIndex++;
                  emitEvent('content_block_start', {
                    type: 'content_block_start',
                    index: textBlockIndex,
                    content_block: { type: 'text', text: '' },
                  });
                }
                outputTokens += Math.ceil(textDelta.length / 4);
                emitEvent('content_block_delta', {
                  type: 'content_block_delta',
                  index: textBlockIndex,
                  delta: { type: 'text_delta', text: textDelta },
                });
              }

              // Extract tool call deltas
              const toolCalls = delta?.tool_calls;
              if (Array.isArray(toolCalls)) {
                for (const tc of toolCalls) {
                  const tcIdx = tc.index ?? 0;
                  if (!activeToolBlocks.has(tcIdx)) {
                    // Close previous text block if open
                    if (textBlockStarted) {
                      emitEvent('content_block_stop', {
                        type: 'content_block_stop',
                        index: textBlockIndex,
                      });
                      textBlockStarted = false;
                    }

                    const blockIdx = currentBlockIndex++;
                    const toolId = tc.id || generateId('toolu');
                    const toolName = tc.function?.name || 'tool';
                    activeToolBlocks.set(tcIdx, { id: toolId, name: toolName });

                    emitEvent('content_block_start', {
                      type: 'content_block_start',
                      index: blockIdx,
                      content_block: {
                        type: 'tool_use',
                        id: toolId,
                        name: toolName,
                        input: {},
                      },
                    });
                  }

                  if (tc.function?.arguments) {
                    const blockIdx = currentBlockIndex - 1;
                    emitEvent('content_block_delta', {
                      type: 'content_block_delta',
                      index: blockIdx,
                      delta: {
                        type: 'input_json_delta',
                        partial_json: tc.function.arguments,
                      },
                    });
                  }
                }
              }
            }
          }

          // Close active blocks
          if (textBlockStarted) {
            emitEvent('content_block_stop', {
              type: 'content_block_stop',
              index: textBlockIndex,
            });
          }

          for (let i = 0; i < activeToolBlocks.size; i++) {
            emitEvent('content_block_stop', {
              type: 'content_block_stop',
              index: textBlockIndex + 1 + i,
            });
          }

          const hasToolCalls = activeToolBlocks.size > 0;
          emitEvent('message_delta', {
            type: 'message_delta',
            delta: {
              stop_reason: hasToolCalls ? 'tool_use' : 'end_turn',
              stop_sequence: null,
            },
            usage: { output_tokens: Math.max(1, outputTokens) },
          });

          emitEvent('message_stop', { type: 'message_stop' });
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'x-free-claude-code-version': '1.0.0',
        'x-fcc-source': 'https://github.com/alishahryar1/free-claude-code',
      },
    });
  }

  /**
   * Dispatches an Anthropic create message request to the appropriate provider.
   */
  static async handleAnthropicMessage(
    params: AnthropicCreateMessageParams,
    providerRegistry: ProviderRegistry,
    signal?: AbortSignal,
  ): Promise<Response> {
    let requestedModel = params.model;

    // If model has no prefix and starts with claude-, resolve to connected provider model
    if (!requestedModel.includes(':')) {
      const allProviders = providerRegistry.list();
      const openRouter = allProviders.find((p) => p.id === 'openrouter');
      const nineRouter = allProviders.find((p) => p.id === 'nine_router' || p.id === '9router');

      if (openRouter) {
        requestedModel = `openrouter:anthropic/${requestedModel}`;
      } else if (nineRouter) {
        requestedModel = `9router:${requestedModel}`;
      }
    }

    const { provider, modelName } = providerRegistry.resolveModel(requestedModel);

    const openaiMessages = this.translateAnthropicMessages(params.system, params.messages);
    const openaiTools = this.translateAnthropicTools(params.tools);

    const chatRequest: ChatRequest = {
      model: modelName,
      messages: openaiMessages,
      tools: openaiTools,
      stream: true,
    };

    const providerStreamResponse = await provider.chatStream(chatRequest, signal);
    return this.createAnthropicStream(providerStreamResponse, requestedModel, signal);
  }
}
