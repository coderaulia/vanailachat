import type { ContextWindow } from '../types/chat';

export const DEFAULT_CONTEXT_WINDOW: ContextWindow = { current: 0, total: 32768 };
export const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.';
export const MAX_CONVERSATION_HISTORY = 20;
export const THEME_STORAGE_KEY = 'vanaila-theme';
export const MODEL_STORAGE_KEY = 'vanaila-model';
export const DEFAULT_MODEL_ROLE = 'general';
