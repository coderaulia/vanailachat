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

const toTitleCase = (value: string): string =>
  value
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const getModelBaseName = (name: string): string => {
  const withoutNamespace = name.split('/').pop() || name;
  return withoutNamespace.split(':')[0] || withoutNamespace;
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

const getDescription = (metadata?: ModelMetadata): string => {
  if (!metadata) return 'Ollama model';

  const parameterSize = metadata.parameterSize || metadata.parameters;
  const architecture = metadata.architecture || metadata.family;
  const details = unique([
    parameterSize ? `${parameterSize} parameters` : null,
    metadata.quantizationLevel ? `${metadata.quantizationLevel} quantization` : null,
    architecture ? `${toTitleCase(architecture)} architecture` : null,
    metadata.contextWindow ? `${metadata.contextWindow.toLocaleString()} context` : null,
  ]);

  return details.length > 0 ? details.join(' - ') : 'Ollama model';
};

const getIcon = (metadata?: ModelMetadata): string => {
  const capabilities = metadata?.capabilities?.map((capability) => capability.toLowerCase()) ?? [];
  return capabilities.some((capability) => capability === 'image' || capability === 'vision') ? '🎨' : '🤖';
};

export const getModelInfo = (
  modelName: string | null | undefined,
  metadata?: ModelMetadata
): ModelInfo => {
  const name = modelName || '';
  if (!name) return { name: '', displayName: 'Select Model', description: '', capabilities: [], icon: '🤖' };

  return {
    name,
    displayName: formatDisplayName(name),
    description: getDescription(metadata),
    capabilities: getCapabilityLabels(metadata),
    icon: getIcon(metadata),
  };
};
