import { useState, useEffect, useMemo, useCallback } from 'react';
import { ModelRole, MODEL_ROLE_MAP, MODEL_ROLE_LABELS } from '../config/modelRoles';
import { MODEL_STORAGE_KEY, DEFAULT_MODEL_ROLE } from '../config/constants';
import type { ModelMetadata, ModelMetadataMap } from '../config/modelMetadata';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getModelName = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return null;
  if (typeof value.name === 'string') return value.name;
  if (typeof value.model === 'string') return value.model;
  return null;
};

const normalizeModelsResponse = (data: unknown): { models: string[]; metadata: ModelMetadataMap } => {
  const metadata: ModelMetadataMap = {};

  if (Array.isArray(data)) {
    return {
      models: data.filter((model): model is string => typeof model === 'string'),
      metadata,
    };
  }

  if (!isRecord(data)) return { models: [], metadata };

  const rawModels = Array.isArray(data.models) ? data.models : [];
  const models = rawModels.flatMap((model) => {
    const name = getModelName(model);
    if (!name) return [];
    if (isRecord(model)) {
      metadata[name] = model as ModelMetadata;
    }
    return [name];
  });

  if (isRecord(data.metadata)) {
    for (const [name, modelMetadata] of Object.entries(data.metadata)) {
      if (isRecord(modelMetadata)) {
        metadata[name] = modelMetadata as ModelMetadata;
      }
    }
  }

  return {
    models: models.length > 0 ? models : Object.keys(metadata),
    metadata,
  };
};

const getSuggestedRole = (p: string, hasImage: boolean): ModelRole | null => {
  if (hasImage) return 'vision';
  const lowered = p.toLowerCase();
  const hasCodeFence = lowered.includes('```');
  const hasFileExtension = /\b[\w-]+\.(ts|tsx|js|jsx|py|go|rs|java|cpp|c|cs|rb|php|html|css|json)\b/.test(lowered);
  const hasCodingKeyword = /\b(debug|refactor|write|design|implement|function|class)\b/.test(lowered);
  const hasImageKeyword = /\b(image|draw|generate|paint|visualize|picture|photo|sketch|flux)\b/.test(lowered);

  if (hasImageKeyword) return 'creative';
  if (hasCodeFence || hasFileExtension || hasCodingKeyword) return 'coding';
  return null;
};

export function useModelManager(prompt: string, hasImageAttachment: boolean = false) {
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelMetadata, setModelMetadata] = useState<ModelMetadataMap>({});
  const [selectedModel, setSelectedModelState] = useState('');
  const [selectedRole, setSelectedRole] = useState<ModelRole>(DEFAULT_MODEL_ROLE);
  const [dismissedSuggestionPrompt, setDismissedSuggestionPrompt] = useState<string | null>(null);

  const getRoleRecommendedModels = useCallback((role: ModelRole): string[] => {
    if (!Array.isArray(availableModels)) return [];
    const recommended = MODEL_ROLE_MAP[role];
    return availableModels.filter((m) =>
      recommended.some((r) => m.toLowerCase().includes(r.toLowerCase()))
    );
  }, [availableModels]);

  const fetchModels = useCallback(async () => {
    try {
      const response = await fetch('/api/models');
      if (response.ok) {
        const data = await response.json();
        const { models, metadata } = normalizeModelsResponse(data);
        setAvailableModels(models);
        setModelMetadata(metadata);
      }
    } catch (error) {
      console.error('Failed to fetch models:', error);
    }
  }, []);

  useEffect(() => {
    const savedModel = localStorage.getItem(MODEL_STORAGE_KEY);
    if (savedModel) {
      setSelectedModelState(savedModel);
    }
    fetchModels();
    const interval = setInterval(fetchModels, 300_000);
    return () => clearInterval(interval);
  }, [fetchModels]);

  const filteredAvailableModels = useMemo(() => availableModels, [availableModels]);

  useEffect(() => {
    if (availableModels.length === 0) return;

    // If no model selected, or selected model is not in the full list of available models,
    // then we need to pick a default.
    if (!selectedModel || !availableModels.includes(selectedModel)) {
      const defaultModel = filteredAvailableModels.length > 0
        ? filteredAvailableModels[0]
        : availableModels[0];

      if (defaultModel) {
        setSelectedModelState(defaultModel);
      }
    }
  }, [availableModels, filteredAvailableModels, selectedModel]);

  const suggestedRole = useMemo(() => getSuggestedRole(prompt, hasImageAttachment), [prompt, hasImageAttachment]);
  const shouldShowRoleSuggestion = useMemo(
    () =>
      Boolean(prompt.trim()) &&
      suggestedRole !== null &&
      suggestedRole !== selectedRole &&
      dismissedSuggestionPrompt !== prompt,
    [dismissedSuggestionPrompt, prompt, selectedRole, suggestedRole]
  );

  const suggestedRoleLabel = suggestedRole ? MODEL_ROLE_LABELS[suggestedRole] : '';
  const suggestedModels = useMemo(
    () => (suggestedRole ? getRoleRecommendedModels(suggestedRole) : []),
    [getRoleRecommendedModels, suggestedRole]
  );
  const suggestedModelName =
    suggestedModels[0] || (suggestedRole ? MODEL_ROLE_MAP[suggestedRole][0] : '');

  const setSelectedModel = (model: string) => {
    setSelectedModelState(model);
    localStorage.setItem(MODEL_STORAGE_KEY, model);
  };

  return {
    availableModels,
    modelMetadata,
    selectedModel,
    selectedRole,
    filteredAvailableModels,
    shouldShowRoleSuggestion,
    suggestedRoleLabel,
    suggestedModelName,
    dismissedSuggestionPrompt,
    setSelectedModel,
    setSelectedRole,
    setDismissedSuggestionPrompt,
    fetchModels,
    getRoleRecommendedModels,
  };
}
