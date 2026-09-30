export interface CustomProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  models?: string;
}

export interface AllSettings {
  ollama_host?: string;
  openai_api_key?: string;
  openai_base_url?: string;
  openrouter_api_key?: string;
  openrouter_base_url?: string;
  nine_router_host?: string;
  nine_router_api_key?: string;
  custom_openai_providers?: string;
  custom_openai_base_url?: string;
  custom_openai_api_key?: string;
  custom_openai_models?: string;
  coding_harness?: string;
  pi_agent_dir?: string;
  pi_api_key?: string;
  pi_base_url?: string;
  pi_model?: string;
  pi_provider?: string;
  pi_system_prompt?: string;
  pi_thinking_level?: string;
  pi_tool_policy?: string;
  deepseek_api_key?: string;
  deepseek_base_url?: string;
  deepseek_model?: string;
  dsh_path?: string;
  dsh_profile?: string;
  user_name?: string;
  user_role?: string;
  base_instructions?: string;
  require_tool_approval?: string;
  skills_inline?: string;
  memory_enabled?: string;
  model_pricing?: string;
  onboarding_done?: string;
}

export type SettingKey = keyof AllSettings;
export type SettingWrites = Array<[SettingKey, string]>;

export interface MemoryEntry {
  id: string;
  type: string;
  content: string;
  embedding: string;
  metadata: string | null;
  sourceId: string | null;
  createdAt: number;
}

export type Tab = 'ai' | 'personalization' | 'behaviour' | 'appearance' | 'memories' | 'training' | 'about';

export interface TrainingStats {
  pairs: number;
  explicit: number;
  edited: number;
  implicit: number;
  distillation: number;
  topChats: number;
  oldest: number | null;
  newest: number | null;
}

export interface TrainingExample {
  id: string;
  chatId: string;
  chatTitle: string;
  userContent: string;
  assistantContent: string;
  rating: number;
  edited: boolean;
  createdAt: number;
}

export type LlmMode = 'ollama' | 'custom' | '9router' | 'openrouter' | 'openai';
