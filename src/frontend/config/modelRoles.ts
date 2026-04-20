export const MODEL_ROLE_MAP = {
  general: ['llama3', 'qwen3.5', 'gemma4'],
  coding: ['qwen3.5', 'qwen3-coder'],
  vision: ['llava', 'gemma4'],
  content: ['llama3', 'gemma4'],
} as const;

export type ModelRole = keyof typeof MODEL_ROLE_MAP;

export const MODEL_ROLE_LABELS: Record<ModelRole, string> = {
  general: 'General',
  coding: 'Coding',
  vision: 'Vision',
  content: 'Content',
};
