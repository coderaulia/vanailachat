import { useState, useEffect, useMemo } from 'react';
import { ModelRole, MODEL_ROLE_MAP, MODEL_ROLE_LABELS } from '../config/modelRoles';
import { MODEL_STORAGE_KEY, DEFAULT_MODEL_ROLE } from '../config/constants';

export function useModelManager(prompt: string) {
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModelState] = useState('');
  const [selectedRole, setSelectedRole] = useState<ModelRole>(DEFAULT_MODEL_ROLE);
  const [dismissedSuggestionPrompt, setDismissedSuggestionPrompt] = useState<string | null>(null);

  const getRoleRecommendedModels = (role: ModelRole): string[] => {
    if (!Array.isArray(availableModels)) return [];
    const recommended = MODEL_ROLE_MAP[role];
    return availableModels.filter((m) =>
      recommended.some((r) => m.toLowerCase().includes(r.toLowerCase()))
    );
  };

  const fetchModels = async () => {
    try {
      const response = await fetch('/api/models');
      if (response.ok) {
        const data = await response.json();
        const models = Array.isArray(data) ? data : Array.isArray(data.models) ? data.models : [];
        setAvailableModels(models);
      }
    } catch (error) {
      console.error('Failed to fetch models:', error);
    }
  };

  useEffect(() => {
    const savedModel = localStorage.getItem(MODEL_STORAGE_KEY);
    if (savedModel) {
      setSelectedModelState(savedModel);
    }
    fetchModels();
  }, []);

  const filteredAvailableModels = useMemo(() => {
    const recommended = getRoleRecommendedModels(selectedRole);
    return recommended.length > 0 ? recommended : availableModels;
  }, [availableModels, selectedRole]);

  useEffect(() => {
    if (filteredAvailableModels.length === 0) return;
    if (!selectedModel || !filteredAvailableModels.includes(selectedModel)) {
      setSelectedModelState(filteredAvailableModels[0]);
    }
  }, [filteredAvailableModels, selectedModel]);

  const getSuggestedRole = (p: string): ModelRole | null => {
    const lowered = p.toLowerCase();
    const hasCodeFence = lowered.includes('```');
    const hasFileExtension = /\b[\w-]+\.(ts|tsx|js|jsx|py|go|rs|java|cpp|c|cs|rb|php|html|css|json)\b/.test(lowered);
    const hasCodingKeyword = /\b(debug|refactor|write|design)\b/.test(lowered);
    if (hasCodeFence || hasFileExtension || hasCodingKeyword) return 'coding';
    return null;
  };

  const suggestedRole = useMemo(() => getSuggestedRole(prompt), [prompt]);
  const shouldShowRoleSuggestion = useMemo(
    () =>
      Boolean(prompt.trim()) &&
      suggestedRole !== null &&
      suggestedRole !== selectedRole &&
      dismissedSuggestionPrompt !== prompt,
    [dismissedSuggestionPrompt, prompt, selectedRole, suggestedRole]
  );

  const suggestedRoleLabel = suggestedRole ? MODEL_ROLE_LABELS[suggestedRole] : '';
  const suggestedModels = suggestedRole ? getRoleRecommendedModels(suggestedRole) : [];
  const suggestedModelName =
    suggestedModels[0] || (suggestedRole ? MODEL_ROLE_MAP[suggestedRole][0] : '');

  const setSelectedModel = (model: string) => {
    setSelectedModelState(model);
    localStorage.setItem(MODEL_STORAGE_KEY, model);
  };

  return {
    availableModels,
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
