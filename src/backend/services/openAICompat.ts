import { setDefaultResultOrder } from 'node:dns';
import { setGlobalDispatcher, EnvHttpProxyAgent } from 'undici';
import { appFetch } from './httpClient.js';

try {
  setDefaultResultOrder('ipv4first');
} catch {
  // best-effort
}

try {
  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;
  if (proxyUrl) {
    setGlobalDispatcher(new EnvHttpProxyAgent());
  }
} catch {
  // best-effort proxy setup
}

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

export interface OpenAICompatibleMessage {
  role: string;
  content: unknown;
  images?: string[];
  tool_call_id?: string;
  tool_calls?: unknown;
}

function toDataUrl(image: string): string {
  if (image.startsWith('data:') || image.startsWith('http://') || image.startsWith('https://')) {
    return image;
  }
  if (image.startsWith('/9j/')) return `data:image/jpeg;base64,${image}`;
  if (image.startsWith('iVBORw0KGgo')) return `data:image/png;base64,${image}`;
  if (image.startsWith('UklGR')) return `data:image/webp;base64,${image}`;
  if (image.startsWith('R0lGOD')) return `data:image/gif;base64,${image}`;
  return `data:image/png;base64,${image}`;
}

/**
 * Keep compatibility payloads strict. Some gateways reject an explicitly
 * empty tool_calls array even though JavaScript treats that array as truthy.
 */
export function toOpenAICompatibleMessage(
  message: OpenAICompatibleMessage,
): Record<string, unknown> {
  let content = message.role === 'tool' && typeof message.content !== 'string'
    ? JSON.stringify(message.content ?? {})
    : message.content;

  if (Array.isArray(message.images) && message.images.length > 0) {
    const text = typeof content === 'string' ? content : '';
    const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
    if (text) {
      parts.push({ type: 'text', text });
    }
    for (const img of message.images) {
      if (typeof img === 'string' && img.trim()) {
        parts.push({
          type: 'image_url',
          image_url: { url: toDataUrl(img.trim()) },
        });
      }
    }
    content = parts;
  }

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

  const normalizedBaseUrl = baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions\/?$/, '')
    .replace(/\/+$/, '');
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
    appFetch(`${normalizedBaseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify(payload),
    });

  let response: Response;
  try {
    response = await send(requestBody);
  } catch (error) {
    console.error(`[${providerLabel}] Outbound fetch error:`, error);
    const errorRecord = error as Record<string, unknown>;
    const message = error instanceof Error ? error.message : String(error);
    const causeObj = errorRecord?.cause;
    let causeDetail = '';
    if (causeObj instanceof Error) {
      causeDetail = `${causeObj.name}: ${causeObj.message}`;
    } else if (causeObj && typeof causeObj === 'object') {
      try {
        causeDetail = JSON.stringify(causeObj);
      } catch {
        causeDetail = String(causeObj);
      }
    } else if (causeObj) {
      causeDetail = String(causeObj);
    }

    const isTimeout = message.includes('ETIMEDOUT') || causeDetail.includes('ETIMEDOUT');
    if (isTimeout) {
      throw new Error(
        `[${providerLabel}] Connection timed out connecting to ${normalizedBaseUrl}. Please check your network connection, proxy settings, or endpoint URL.`,
      );
    }
    const finalReason = causeDetail || message || 'Network connection failed';
    throw new Error(`[${providerLabel}] Failed to connect to ${normalizedBaseUrl}: ${finalReason}`);
  }

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
    let errorText = await response.text();
    try {
      const parsed = JSON.parse(errorText) as { error?: { message?: string } | string; message?: string };
      if (parsed.error && typeof parsed.error === 'object' && parsed.error.message) {
        errorText = parsed.error.message;
      } else if (typeof parsed.error === 'string') {
        errorText = parsed.error;
      } else if (typeof parsed.message === 'string') {
        errorText = parsed.message;
      }
    } catch {
      // keep raw error text
    }
    throw new Error(`${providerLabel} error: ${errorText} (HTTP ${response.status})`);
  }

  return response;
}
