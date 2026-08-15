/**
 * Utility to convert OpenAI SSE (Server-Sent Events) streaming into
 * Ollama-compatible NDJSON lines for the agent loop in chat.ts.
 *
 * OpenAI chunks: data: {"choices":[{"delta":{"content":"..."}}]}\n\n
 * Ollama NDJSON:  {"message":{"content":"..."}}\n
 */

interface SSEDelta {
  content?: string;
  tool_calls?: Array<{
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
    type?: string;
  }>;
}

interface SSEChoice {
  delta?: SSEDelta;
  finish_reason?: string;
}

interface SSEUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface SSEChunk {
  choices?: SSEChoice[];
  model?: string;
  usage?: SSEUsage | null;
}

export function openAIStreamToNDJSON(
  openAIResponse: Response,
  model: string,
): Response {
  const originalBody = openAIResponse.body;
  if (!originalBody) {
    throw new Error('No response body from OpenAI stream');
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const reader = originalBody.getReader();
  let buffer = '';
  let mergedToolCalls: Record<number, {
    id?: string;
    type?: string;
    function: { name?: string; arguments: string };
  }> = {};

  // OpenAI reports token usage in a trailing chunk that carries no choices,
  // and only when stream_options.include_usage was requested. Ollama instead
  // ends with {done:true, prompt_eval_count, eval_count}, which is the shape
  // the frontend reads — so hold the usage and translate it on close.
  let usage: SSEUsage | null = null;

  const takeMergedToolCalls = () => {
    const calls = Object.entries(mergedToolCalls).map(([index, tc]) => {
      let args: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(tc.function.arguments || '{}') as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        }
      } catch (error) {
        console.warn(
          '[STREAM] Tool arguments were not valid JSON; returning an empty object so the model can retry:',
          error instanceof Error ? error.message : 'unknown error',
        );
      }

      return {
        id: tc.id || `call_stream_${index}`,
        type: tc.type || 'function',
        function: {
          name: tc.function.name,
          arguments: args,
        },
      };
    });
    mergedToolCalls = {};
    return calls;
  };

  const stream = new ReadableStream({
    async pull(controller) {
      const closeWithUsage = () => {
        if (Object.keys(mergedToolCalls).length > 0) {
          controller.enqueue(encoder.encode(JSON.stringify({
            model,
            message: { role: 'assistant', tool_calls: takeMergedToolCalls() },
            done: false,
          }) + '\n'));
        }
        const final: Record<string, unknown> = { model, done: true };
        if (usage) {
          if (typeof usage.prompt_tokens === 'number') final.prompt_eval_count = usage.prompt_tokens;
          if (typeof usage.completion_tokens === 'number') final.eval_count = usage.completion_tokens;
          final.usage = usage;
        }
        controller.enqueue(encoder.encode(JSON.stringify(final) + '\n'));
        controller.close();
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          closeWithUsage();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;

          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') {
            closeWithUsage();
            return;
          }

          try {
            const chunk: SSEChunk = JSON.parse(dataStr);

            // The usage chunk arrives with an empty choices array, so capture
            // it before the choice guard below discards the chunk.
            if (chunk.usage) {
              usage = chunk.usage;
            }

            const choice = chunk.choices?.[0];
            if (!choice) continue;

            const ollamaChunk: Record<string, unknown> = {
              model: chunk.model || model,
              done: false,
            };

            const delta = choice.delta;
            if (!delta) continue;

            const message: Record<string, unknown> = {};

            if (delta.content) {
              message.content = delta.content;
              message.role = 'assistant';
            }

            // OpenAI streams tool calls incrementally across chunks
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!mergedToolCalls[idx]) {
                  mergedToolCalls[idx] = {
                    id: tc.id,
                    type: tc.type,
                    function: { name: tc.function?.name, arguments: tc.function?.arguments ?? '' },
                  };
                } else {
                  if (tc.function?.name) mergedToolCalls[idx].function.name = tc.function.name;
                  if (tc.function?.arguments)
                    mergedToolCalls[idx].function.arguments += tc.function.arguments;
                  if (tc.id) mergedToolCalls[idx].id = tc.id;
                }
              }
            }

            // Emit tool_calls once the turn ends. Any finish_reason counts:
            // OpenAI-compatible providers signal 'tool_calls' (or 'length'),
            // not 'stop', when the model asks for a tool — keying on 'stop'
            // alone dropped the accumulated calls entirely.
            if (choice.finish_reason && Object.keys(mergedToolCalls).length > 0) {
              message.tool_calls = takeMergedToolCalls();
            }

            if (Object.keys(message).length > 0) {
              ollamaChunk.message = message;
              controller.enqueue(encoder.encode(JSON.stringify(ollamaChunk) + '\n'));
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
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
