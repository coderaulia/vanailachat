export const MODEL_ROLE_MAP = {
  general: ['llama3.1', 'qwen3.5', 'gemma4'],
  coding: ['qwen3.5', 'llama3.1'],
  vision: ['flux2-klein', 'gemma4'],
  creative: ['flux2-klein'],
  content: ['llama3.1', 'gemma4'],
} as const;

export type ModelRole = keyof typeof MODEL_ROLE_MAP;

export const MODEL_ROLE_LABELS: Record<ModelRole, string> = {
  general: 'General',
  coding: 'Coding',
  vision: 'Vision',
  creative: 'Creative',
  content: 'Content',
};
