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
  ollama:     { label: 'Ollama',     icon: '🦙', description: 'Local Ollama model' },
  openai:     { label: 'OpenAI',     icon: '✨', description: 'OpenAI model' },
  '9router':  { label: '9Router',    icon: '⚡', description: '9Router cloud model' },
  openrouter: { label: 'OpenRouter', icon: '🌐', description: 'OpenRouter model' },
  custom:     { label: 'Custom',     icon: '🧩', description: 'OpenAI-compatible model' },
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
  if (prefixIdx > 0 && EXTERNAL_PROVIDER_PREFIXES.has(remainder.slice(0, prefixIdx))) {
    remainder = remainder.slice(prefixIdx + 1);
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
  if (!metadata) {
    return PROVIDER_DISPLAY[provider ?? 'ollama']?.description ?? 'Local model';
  }

  const parameterSize = metadata.parameterSize || metadata.parameters;
  const architecture = metadata.architecture || metadata.family;
  const details = unique([
    parameterSize ? `${parameterSize} parameters` : null,
    metadata.quantizationLevel ? `${metadata.quantizationLevel} quantization` : null,
    architecture ? `${toTitleCase(architecture)} architecture` : null,
    metadata.contextWindow ? `${metadata.contextWindow.toLocaleString()} context` : null,
  ]);

  return details.length > 0 ? details.join(' - ') : (PROVIDER_DISPLAY[provider ?? 'ollama']?.description ?? 'Local model');
};

const getIcon = (metadata?: ModelMetadata, provider?: string): string => {
  const capabilities = metadata?.capabilities?.map((capability) => capability.toLowerCase()) ?? [];
  if (capabilities.some((capability) => capability === 'image' || capability === 'vision')) return '🎨';
  return PROVIDER_DISPLAY[provider ?? 'ollama']?.icon ?? '🤖';
};

export const getModelInfo = (
  modelName: string | null | undefined,
  metadata?: ModelMetadata,
  provider?: string,
): ModelInfo => {
  const name = modelName || '';
  if (!name) return { name: '', displayName: 'Select Model', description: '', capabilities: [], icon: '🤖' };

  return {
    name,
    displayName: formatDisplayName(name),
    description: getDescription(metadata, provider),
    capabilities: getCapabilityLabels(metadata),
    icon: getIcon(metadata, provider),
  };
};
