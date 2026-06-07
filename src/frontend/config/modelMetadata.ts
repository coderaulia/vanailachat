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

// Provider IDs that use prefix:modelname format (not Ollama tag format)
const EXTERNAL_PROVIDER_PREFIXES = new Set(['openai', '9router', 'openrouter']);

export const PROVIDER_DISPLAY: Record<string, { label: string; icon: string; description: string }> = {
  ollama:     { label: 'Ollama',     icon: '🦙', description: 'Local Ollama model' },
  openai:     { label: 'OpenAI',     icon: '✨', description: 'OpenAI model' },
  '9router':  { label: '9Router',    icon: '⚡', description: '9Router cloud model' },
  openrouter: { label: 'OpenRouter', icon: '🌐', description: 'OpenRouter model' },
};

const toTitleCase = (value: string): string =>
  value
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const getModelBaseName = (name: string): string => {
  const withoutNamespace = name.split('/').pop() || name;
  const colonIdx = withoutNamespace.indexOf(':');
  if (colonIdx > 0) {
    const prefix = withoutNamespace.slice(0, colonIdx);
    if (EXTERNAL_PROVIDER_PREFIXES.has(prefix)) {
      // External provider prefix — take the actual model name after the colon
      return withoutNamespace.slice(colonIdx + 1);
    }
    // Ollama tag format (e.g., "llama3.2:latest") — strip tag
    return withoutNamespace.slice(0, colonIdx);
  }
  return withoutNamespace;
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
