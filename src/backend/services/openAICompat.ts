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

  const send = (payload: Record<string, unknown>) =>
    fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal,
      body: JSON.stringify(payload),
    });

  let response = await send(requestBody);

  if (!response.ok && response.status === 400 && streaming) {
    console.warn(
      `[${providerLabel}] stream_options rejected (400); retrying without usage reporting`,
    );
    response = await send(body);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${providerLabel} API error: ${response.status} ${errorText}`);
  }

  return response;
}
