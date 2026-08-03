/**
 * Per-model token pricing, in USD per 1M tokens.
 *
 * Token counts alone don't answer the question that actually matters on a
 * metered provider — "what did that cost?" — so the counts the stream already
 * reports are turned into money here.
 *
 * Rates are matched by substring against the model id, longest pattern first,
 * because ids arrive decorated in practice ("deepseek-chat", "openai/gpt-4o",
 * "gpt-4o-2024-11-20"). Anything unmatched returns null and the UI shows
 * tokens only rather than inventing a number.
 */
export interface TokenRate {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
}

/**
 * Published list prices as of the last update. Providers change these — treat
 * the display as an estimate, not an invoice.
 */
const RATES: Array<[pattern: string, rate: TokenRate]> = [
  // DeepSeek
  ['deepseek-reasoner', { input: 0.55, output: 2.19 }],
  ['deepseek-chat', { input: 0.27, output: 1.1 }],
  // OpenAI
  ['gpt-4o-mini', { input: 0.15, output: 0.6 }],
  ['gpt-4o', { input: 2.5, output: 10 }],
  ['gpt-4.1-mini', { input: 0.4, output: 1.6 }],
  ['gpt-4.1', { input: 2, output: 8 }],
  ['o3-mini', { input: 1.1, output: 4.4 }],
  // Anthropic
  ['claude-3-5-haiku', { input: 0.8, output: 4 }],
  ['claude-haiku', { input: 1, output: 5 }],
  ['claude-sonnet', { input: 3, output: 15 }],
  ['claude-opus', { input: 15, output: 75 }],
  // Google
  ['gemini-2.0-flash', { input: 0.1, output: 0.4 }],
  ['gemini-1.5-pro', { input: 1.25, output: 5 }],
];

/**
 * User-supplied rates, keyed by model id, loaded from the `model_pricing`
 * setting. A gateway can serve any model under any name at its own prices —
 * "custom:deepseek-v4-flash" is not something a built-in table can know — so
 * these take precedence over everything below.
 */
let overrides: Record<string, TokenRate> = {};

export function setPricingOverrides(raw: unknown): void {
  const parsed: Record<string, TokenRate> = {};

  if (raw && typeof raw === 'object') {
    for (const [model, value] of Object.entries(raw as Record<string, unknown>)) {
      const rate = value as { input?: unknown; output?: unknown };
      if (typeof rate?.input === 'number' && typeof rate?.output === 'number') {
        parsed[normalizeModelId(model)] = { input: rate.input, output: rate.output };
      }
    }
  }

  overrides = parsed;
}

/**
 * Strip the provider prefix the app attaches to model ids
 * ("custom:deepseek-v4-flash" -> "deepseek-v4-flash"), otherwise nothing
 * matches for any non-Ollama provider.
 */
export function normalizeModelId(model: string): string {
  const lower = model.toLowerCase().trim();

  // Ollama tags also use ':' ("llama3:8b"), so only known provider prefixes
  // are stripped rather than everything before the first colon.
  for (const prefix of ['custom:', 'openai:', 'ninerouter:', 'nine:', 'ollama:']) {
    if (lower.startsWith(prefix)) return lower.slice(prefix.length);
  }

  return lower;
}

/** Models served from the user's own machine cost nothing per token. */
const LOCAL_MARKERS = ['llama', 'qwen', 'mistral', 'phi', 'gemma', 'nomic', 'codellama', 'deepseek-r1:'];

export function isLocalModel(model: string): boolean {
  const id = normalizeModelId(model);
  // An explicit Ollama-style tag ("llama3:8b") is always local.
  return LOCAL_MARKERS.some((marker) => id.includes(marker));
}

/** Rate for a model, or null when the model is local or simply unknown. */
export function getTokenRate(model: string | null | undefined): TokenRate | null {
  if (!model) return null;

  const id = normalizeModelId(model);

  // An explicit override wins even for a model that looks local.
  if (overrides[id]) return overrides[id];

  if (isLocalModel(id)) return null;

  const match = [...RATES]
    .sort((a, b) => b[0].length - a[0].length)
    .find(([pattern]) => id.includes(pattern));

  return match ? match[1] : null;
}

/** Cost in USD for a turn, or null when the model has no known rate. */
export function estimateCost(
  model: string | null | undefined,
  promptTokens: number | null | undefined,
  completionTokens: number | null | undefined,
): number | null {
  const rate = getTokenRate(model);
  if (!rate) return null;

  const input = ((promptTokens ?? 0) / 1_000_000) * rate.input;
  const output = ((completionTokens ?? 0) / 1_000_000) * rate.output;
  return input + output;
}

/**
 * Format a cost for a dense UI. Sub-cent amounts are the common case for a
 * single turn, and rounding them to "$0.00" would read as free.
 */
export function formatCost(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
