export const MODEL_ROLE_MAP = {
  general: ['llama3.1', 'qwen3', 'gemma4', 'glm4', 'kimi'],
  coding: ['qwen3', 'llama3.1', 'glm4'],
  vision: ['flux2-klein', 'gemma4'],
  creative: ['flux2-klein', 'kimi'],
  content: ['llama3.1', 'gemma4', 'qwen3'],
} as const;

export type ModelRole = keyof typeof MODEL_ROLE_MAP;

export const MODEL_ROLE_LABELS: Record<ModelRole, string> = {
  general: 'General',
  coding: 'Coding',
  vision: 'Vision',
  creative: 'Creative',
  content: 'Content',
};
