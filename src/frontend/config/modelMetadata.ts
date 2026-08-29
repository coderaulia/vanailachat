export interface ModelInfo {
  name: string;
  displayName: string;
  description: string;
  capabilities: string[];
  icon: string;
}

export interface ModelMetadata {
  architecture?: string | null;
  contextWindow?: number | null;
  parameters?: string | null;
  capabilities?: string[] | null;
  family?: string | null;
  families?: string[] | null;
  format?: string | null;
  parameterSize?: string | null;
  quantizationLevel?: string | null;
  modifiedAt?: string | null;
  size?: number | null;
  digest?: string | null;
}

export type ModelMetadataMap = Record<string, ModelMetadata>;

const CAPABILITY_LABELS: Record<string, string> = {
  chat: 'Chat',
  completion: 'Chat',
  embedding: 'Embedding',
  image: 'Image',
  insert: 'Insert',
  text: 'Text',
  tools: 'Tools',
  vision: 'Vision',
};

export const PROVIDER_DISPLAY: Record<string, { label: string; icon: string; description: string }> = {
  ollama:     { label: 'Ollama',     icon: 'Ollama', description: 'Local Ollama model' },
  openai:     { label: 'OpenAI',     icon: 'OpenAI', description: 'OpenAI model' },
  '9router':  { label: '9Router',    icon: '9Router', description: '9Router cloud model' },
  openrouter: { label: 'OpenRouter', icon: 'OpenRouter', description: 'OpenRouter model' },
  custom:     { label: 'Custom',     icon: 'Custom', description: 'OpenAI-compatible model' },
};

export const getProviderDisplayInfo = (providerId?: string): { label: string; icon: string; description: string } => {
  if (!providerId) return PROVIDER_DISPLAY.ollama;
  if (PROVIDER_DISPLAY[providerId]) return PROVIDER_DISPLAY[providerId];
  if (providerId.startsWith('custom')) {
    const rawName = providerId.replace(/^custom[-_]?/, '');
    const label = rawName ? toTitleCase(rawName) : 'Custom';
    return {
      label,
      icon: 'Custom',
      description: `${label} (OpenAI-compatible)`,
    };
  }
  return {
    label: toTitleCase(providerId),
    icon: 'Cloud',
    description: `${toTitleCase(providerId)} model`,
  };
};

/**
 * Provider IDs that address models as "prefix:model". Derived from
 * PROVIDER_DISPLAY so registering a provider in one place is enough — a missing
 * entry here silently renders every one of that provider's models as the
 * prefix itself (e.g. "custom:gpt-5.4" → "Custom").
 * Ollama is excluded: its colon is a tag separator ("llama3.2:latest").
 */
const EXTERNAL_PROVIDER_PREFIXES = new Set(
  Object.keys(PROVIDER_DISPLAY).filter((id) => id !== 'ollama'),
);

const toTitleCase = (value: string): string =>
  value
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const getModelBaseName = (name: string): string => {
  // Strip the provider prefix before the namespace so models that carry both
  // (e.g. "custom:gemini/gemini-3.5-flash") resolve to the model, not the prefix.
  let remainder = name;
  const prefixIdx = remainder.indexOf(':');
  if (prefixIdx > 0) {
    const prefix = remainder.slice(0, prefixIdx);
    if (EXTERNAL_PROVIDER_PREFIXES.has(prefix) || prefix.startsWith('custom')) {
      remainder = remainder.slice(prefixIdx + 1);
    }
  }

  const withoutNamespace = remainder.split('/').pop() || remainder;

  // Ollama tag format (e.g. "llama3.2:latest") — strip the tag
  const tagIdx = withoutNamespace.indexOf(':');
  return tagIdx > 0 ? withoutNamespace.slice(0, tagIdx) : withoutNamespace;
};

const formatDisplayName = (name: string): string => toTitleCase(getModelBaseName(name));

const formatCapability = (capability: string): string => {
  const normalized = capability.trim().toLowerCase();
  return CAPABILITY_LABELS[normalized] || toTitleCase(normalized);
};

const unique = (items: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  return items.flatMap((item) => {
    if (!item) return [];
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) return [];
    seen.add(trimmed);
    return [trimmed];
  });
};

const getCapabilityLabels = (metadata?: ModelMetadata): string[] => {
  if (!metadata) return [];

  const capabilityLabels = metadata.capabilities?.map(formatCapability) ?? [];
  const familyLabel = metadata.family || metadata.architecture
    ? toTitleCase(metadata.family || metadata.architecture || '')
    : null;

  return unique([
    ...capabilityLabels,
    familyLabel,
    metadata.parameterSize || metadata.parameters,
    metadata.quantizationLevel,
  ]).slice(0, 4);
};

const getDescription = (metadata?: ModelMetadata, provider?: string): string => {
  const providerInfo = getProviderDisplayInfo(provider);
  if (!metadata) {
    return providerInfo.description;
  }

  const parameterSize = metadata.parameterSize || metadata.parameters;
  const architecture = metadata.architecture || metadata.family;
  const details = unique([
    parameterSize ? `${parameterSize} parameters` : null,
    metadata.quantizationLevel ? `${metadata.quantizationLevel} quantization` : null,
    architecture ? `${toTitleCase(architecture)} architecture` : null,
    metadata.contextWindow ? `${metadata.contextWindow.toLocaleString()} context` : null,
  ]);

  return details.length > 0 ? details.join(' - ') : providerInfo.description;
};

const getIcon = (metadata?: ModelMetadata, provider?: string): string => {
  const capabilities = metadata?.capabilities?.map((capability) => capability.toLowerCase()) ?? [];
  if (capabilities.some((capability) => capability === 'image' || capability === 'vision')) return 'Vision';
  return getProviderDisplayInfo(provider).icon;
};

export const getModelInfo = (
  modelName: string | null | undefined,
  metadata?: ModelMetadata,
  provider?: string,
): ModelInfo => {
  const name = modelName || '';
  if (!name) return { name: '', displayName: 'Select Model', description: '', capabilities: [], icon: 'Model' };

  return {
    name,
    displayName: formatDisplayName(name),
    description: getDescription(metadata, provider),
    capabilities: getCapabilityLabels(metadata),
    icon: getIcon(metadata, provider),
  };
};

/**
 * Fallback pattern lookup table for known models across Ollama, OpenRouter, and cloud providers
 * when contextWindow is not explicitly supplied in metadata.
 */
const KNOWN_MODEL_CONTEXT_WINDOWS: Array<{ pattern: RegExp; contextWindow: number }> = [
  // 1M+ context models (Ox Alpha, 0x, Gemini, etc.)
  { pattern: /(?:ox|0x)[-_]?alpha/i, contextWindow: 1_000_000 },
  { pattern: /gemini-(?:1\.5|2\.0|2\.5)/i, contextWindow: 1_000_000 },
  // 200k context models (Claude 3.x, o1, o3)
  { pattern: /claude-(?:3|3\.5|3-5|3\.7|3-7)/i, contextWindow: 200_000 },
  { pattern: /\b(?:o1|o3|o1-mini|o1-preview|o3-mini)\b/i, contextWindow: 200_000 },
  // 128k context models (GPT-4o, DeepSeek, Mistral Large, Qwen 2.5, Llama 3.1/3.2/3.3)
  { pattern: /gpt-4o/i, contextWindow: 128_000 },
  { pattern: /gpt-4-turbo/i, contextWindow: 128_000 },
  { pattern: /gpt-4\.5/i, contextWindow: 128_000 },
  { pattern: /deepseek/i, contextWindow: 128_000 },
  { pattern: /mistral-large|codestral/i, contextWindow: 128_000 },
  { pattern: /qwen2\.5|qwen-2\.5/i, contextWindow: 131_072 },
  { pattern: /llama-?3\.[123]|llama3\.[123]/i, contextWindow: 131_072 },
  // 32k context models
  { pattern: /qwen/i, contextWindow: 32_768 },
  { pattern: /mistral|mixtral/i, contextWindow: 32_768 },
  // 8k context models
  { pattern: /llama-?3\b|llama3\b/i, contextWindow: 8_192 },
  { pattern: /gpt-4\b/i, contextWindow: 8_192 },
];

/**
 * Returns the effective context window (in tokens) for a given model.
 * Prioritizes actual metadata provided by Ollama/OpenRouter/OpenAI before falling back
 * to model name heuristics and default 32768.
 */
export function getContextWindowForModel(
  modelName?: string | null,
  metadata?: ModelMetadata,
): number {
  if (typeof metadata?.contextWindow === 'number' && metadata.contextWindow > 0) {
    return metadata.contextWindow;
  }
  if (!modelName) return 32_768;

  for (const entry of KNOWN_MODEL_CONTEXT_WINDOWS) {
    if (entry.pattern.test(modelName)) {
      return entry.contextWindow;
    }
  }

  return 32_768;
}

/**
 * Compact formatter for large token numbers (e.g., 1000000 -> "1M", 128000 -> "128K", 32768 -> "32768").
 */
export function formatTokensCompact(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${tokens % 1_000_000 === 0 ? m : m.toFixed(1)}M`;
  }
  if (tokens >= 10_000 && tokens % 1_000 === 0) {
    return `${tokens / 1_000}K`;
  }
  return tokens.toLocaleString();
}

