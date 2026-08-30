import { DatabaseService } from './database.js';
import { parseCustomProvidersConfig } from './customOpenAIProvider.js';

export interface HarnessProviderConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
}

function readSetting(key: string, envKey?: string): string {
  try {
    return DatabaseService.getSetting(key)?.trim() || (envKey ? process.env[envKey]?.trim() || '' : '');
  } catch {
    return envKey ? process.env[envKey]?.trim() || '' : '';
  }
}

function cleanBaseUrl(value: string, suffix = ''): string {
  const clean = value.trim().replace(/\/+$/, '');
  return suffix && !clean.endsWith(suffix) ? clean + suffix : clean;
}

/** Resolve Vanaila's selected provider/model for either coding harness. */
export function resolveHarnessProvider(selectedModel?: string, piProvider?: string, piModel?: string): HarnessProviderConfig {
  const selected = selectedModel?.trim() || piModel?.trim() || '';
  const separator = selected.indexOf(':');
  const prefix = separator > 0 ? selected.slice(0, separator) : '';
  const model = separator > 0 ? selected.slice(separator + 1) : selected;

  const requestedProvider = piProvider?.trim() || prefix;
  const custom = parseCustomProvidersConfig().find((provider) => provider.id === requestedProvider);
  if (custom?.baseUrl) {
    const selectedModelName = model || custom.models?.split(/[,\n]+/).map((item) => item.trim()).find(Boolean) || 'deepseek-chat';
    return { provider: custom.id, model: selectedModelName, apiKey: custom.apiKey?.trim() || 'custom-key', baseUrl: cleanBaseUrl(custom.baseUrl).replace(/\/chat\/completions\/?$/, '') };
  }

  if (prefix === 'openrouter') {
    const apiKey = readSetting('openrouter_api_key', 'OPENROUTER_API_KEY');
    const baseUrl = cleanBaseUrl(readSetting('openrouter_base_url', 'OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1');
    return { provider: 'openrouter', model: model.includes('/') ? model : 'deepseek/' + (model || 'deepseek-chat'), apiKey, baseUrl };
  }

  if (prefix === '9router') {
    return { provider: '9router', model: model || 'deepseek-chat', apiKey: readSetting('nine_router_api_key', 'NINE_ROUTER_API_KEY'), baseUrl: cleanBaseUrl(readSetting('nine_router_host', 'NINE_ROUTER_BASE_URL') || 'http://localhost:20128/v1') };
  }

  if (prefix === 'ollama' || (piProvider?.trim() || '') === 'ollama' || !prefix && !piProvider) {
    return { provider: 'ollama', model: model || 'deepseek-coder-v2', apiKey: 'ollama', baseUrl: cleanBaseUrl(readSetting('ollama_host', 'OLLAMA_HOST') || 'http://localhost:11434', '/v1') };
  }

  const provider = piProvider?.trim() || prefix;
  return { provider, model: model || 'deepseek-chat', apiKey: readSetting('pi_api_key', 'PI_API_KEY'), baseUrl: cleanBaseUrl(readSetting('pi_base_url', 'PI_BASE_URL')) };
}
