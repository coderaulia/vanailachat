/**
 * Provider credentials are kept out of API responses. The browser only ever sees
 * a mask (`••••` plus the last four characters), and a mask sent back means
 * "leave it as it is" — so forms that save a whole group of fields cannot overwrite
 * a real key with its own mask. The desktop app does the same in src-tauri.
 */

export const SECRET_SETTING_KEYS = new Set([
  'openai_api_key',
  'openrouter_api_key',
  'nine_router_api_key',
  'custom_openai_api_key',
  'pi_api_key',
  'deepseek_api_key',
]);

export const MASK_PREFIX = '••••';

/** Settings that hold a JSON list of providers, each with its own `apiKey`. */
const CUSTOM_PROVIDERS_KEY = 'custom_openai_providers';

export function maskSecret(value: string): string {
  if (!value) return '';
  return value.length >= 12 ? `${MASK_PREFIX}${value.slice(-4)}` : MASK_PREFIX;
}

export function isMasked(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(MASK_PREFIX);
}

interface ProviderLike { id?: string; apiKey?: string; [field: string]: unknown }

function parseProviders(raw: string | null | undefined): ProviderLike[] | null {
  if (!raw) return null;
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? (list as ProviderLike[]) : null;
  } catch {
    return null;
  }
}

/** A copy of `settings` that is safe to send to the browser. */
export function maskSettings(settings: Record<string, string>): Record<string, string> {
  const out = { ...settings };
  for (const key of SECRET_SETTING_KEYS) {
    if (typeof out[key] === 'string') out[key] = maskSecret(out[key]);
  }
  const providers = parseProviders(out[CUSTOM_PROVIDERS_KEY]);
  if (providers) {
    out[CUSTOM_PROVIDERS_KEY] = JSON.stringify(
      providers.map((p) => (typeof p.apiKey === 'string' ? { ...p, apiKey: maskSecret(p.apiKey) } : p)),
    );
  }
  return out;
}

export function maskSettingValue(key: string, value: string | null): string | null {
  if (value === null) return value;
  return maskSettings({ [key]: value })[key] ?? value;
}

/**
 * The value to store for an incoming write, or `null` to keep what is stored.
 * Masks are never stored: a masked secret is "unchanged", and masked keys inside
 * the custom providers list are replaced by the stored key of the same provider.
 */
export function resolveSettingWrite(key: string, value: string, stored: string | null): string | null {
  if (SECRET_SETTING_KEYS.has(key)) return isMasked(value) ? null : value;

  if (key === CUSTOM_PROVIDERS_KEY) {
    const incoming = parseProviders(value);
    if (!incoming || !incoming.some((p) => isMasked(p.apiKey))) return value;
    const known = new Map((parseProviders(stored) ?? []).map((p) => [p.id, p.apiKey ?? '']));
    return JSON.stringify(
      incoming.map((p) => (isMasked(p.apiKey) ? { ...p, apiKey: known.get(p.id) ?? '' } : p)),
    );
  }
  return value;
}

/** Setting names are short snake_case identifiers; anything else is not ours. */
export function isValidSettingKey(key: string): boolean {
  return /^[a-z][a-z0-9_]{0,63}$/.test(key);
}

export const MAX_SETTING_VALUE_CHARS = 100_000;
