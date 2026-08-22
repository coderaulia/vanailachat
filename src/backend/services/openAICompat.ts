/**
 * Shared bits for the OpenAI-compatible providers (OpenAI, 9Router, custom).
 *
 * Token accounting is the reason this exists: an OpenAI-style stream reports
 * usage only when the caller asks for it via stream_options.include_usage, and
 * reports it in the OpenAI field names. The rest of the app speaks Ollama's
 * prompt_eval_count / eval_count, so both halves are translated here.
 */

export interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface OpenAICompatibleMessage {
  role: string;
  content: unknown;
  tool_call_id?: string;
  tool_calls?: unknown;
}

/**
 * Keep compatibility payloads strict. Some gateways reject an explicitly
 * empty tool_calls array even though JavaScript treats that array as truthy.
 */
export function toOpenAICompatibleMessage(
  message: OpenAICompatibleMessage,
): Record<string, unknown> {
  const content = message.role === 'tool' && typeof message.content !== 'string'
    ? JSON.stringify(message.content ?? {})
    : message.content;
  const result: Record<string, unknown> = {
    role: message.role,
    content,
  };

  if (message.tool_call_id) result.tool_call_id = message.tool_call_id;
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    result.tool_calls = message.tool_calls.map((toolCall) => {
      if (!toolCall || typeof toolCall !== 'object') return toolCall;
      const record = toolCall as Record<string, unknown>;
      const fn = record.function;
      if (!fn || typeof fn !== 'object') return toolCall;

      const functionRecord = fn as Record<string, unknown>;
      const args = functionRecord.arguments;
      return {
        ...record,
        function: {
          ...functionRecord,
          // OpenAI-compatible APIs require a JSON-encoded string here. The
          // internal/Ollama representation uses an object for execution.
          arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
        },
      };
    });
  }

  return result;
}

export function hasToolCalls(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Map OpenAI usage onto the Ollama-shaped fields the frontend reads, keeping
 * the original object too so either accessor works.
 */
export function usageToOllamaFields(usage: OpenAIUsage | null | undefined): Record<string, unknown> {
  if (!usage) {
    return {};
  }

  const fields: Record<string, unknown> = { usage };
  if (typeof usage.prompt_tokens === 'number') fields.prompt_eval_count = usage.prompt_tokens;
  if (typeof usage.completion_tokens === 'number') fields.eval_count = usage.completion_tokens;
  return fields;
}

/**
 * POST to /chat/completions, asking for usage on streaming calls.
 *
 * Not every OpenAI-compatible gateway accepts stream_options — some older or
 * self-hosted ones reject unknown fields with a 400. When that happens the
 * request is retried once without it, so an unsupported gateway degrades to
 * "no token counts" instead of failing the whole chat.
 */
export async function postChatCompletions(options: {
  baseUrl: string;
  apiKey: string;
  body: Record<string, unknown>;
  providerLabel: string;
  signal?: AbortSignal;
}): Promise<Response> {
  const { baseUrl, apiKey, body, providerLabel, signal } = options;

  const streaming = body.stream === true;
  const requestBody = streaming
    ? { ...body, stream_options: { include_usage: true } }
    : body;

  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '');
  const trimmedKey = (apiKey || '').trim();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://github.com/coderaulia/vanailachat',
    'X-Title': 'VanailaChat',
  };

  if (trimmedKey) {
    headers['Authorization'] = `Bearer ${trimmedKey}`;
  }

  const send = (payload: Record<string, unknown>) =>
    fetch(`${normalizedBaseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify(payload),
    });

  let response = await send(requestBody);

  if (!response.ok && response.status === 400 && streaming) {
    const errorText = await response.clone().text();
    const streamOptionsRejected = /stream[_ -]?options|include[_ -]?usage/i.test(errorText);
    if (streamOptionsRejected) {
      console.warn(
        `[${providerLabel}] stream_options rejected (400); retrying without usage reporting`,
      );
      response = await send(body);
    }
  }

  // Handle OpenRouter credit reservation limit (402 Payment Required: "can only afford X tokens")
  if (!response.ok && (response.status === 402 || response.status === 400)) {
    const errorText = await response.clone().text();
    const affordMatch = /can only afford (\d+)/i.exec(errorText);
    if (affordMatch) {
      const affordable = Math.max(100, parseInt(affordMatch[1], 10) - 20);
      console.warn(
        `[${providerLabel}] Token credit reservation exceeded; retrying with max_tokens: ${affordable}`,
      );
      response = await send({ ...requestBody, max_tokens: affordable });
    }
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${providerLabel} API error: ${response.status} ${errorText}`);
  }

  return response;
}
