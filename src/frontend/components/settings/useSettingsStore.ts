import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { apiFetchSettings, apiUpdateSetting } from '../../lib/api';
import type { AllSettings, CustomProviderConfig, LlmMode, SettingKey, SettingWrites } from './types';

const AUTOSAVE_DELAY_MS = 400;

export const SETTING_DEFAULTS: AllSettings = {
  ollama_host: 'http://localhost:11434',
  nine_router_host: 'http://localhost:20128/v1',
  coding_harness: 'pi-harness',
  pi_thinking_level: 'medium',
  pi_tool_policy: 'approval',
};

const DEFAULT_CUSTOM_PROVIDER: CustomProviderConfig = { id: 'custom', name: 'Custom', baseUrl: '', apiKey: '', models: '' };

/** Picks the provider tab that matches whatever the user configured last. */
export function detectLlmMode(s: AllSettings): LlmMode {
  if (s.openrouter_api_key) return 'openrouter';
  if (s.custom_openai_providers || s.custom_openai_base_url || s.custom_openai_api_key || s.custom_openai_models) return 'custom';
  if (s.nine_router_api_key) return '9router';
  if (s.openai_api_key) return s.openai_base_url?.includes('openrouter') ? 'openrouter' : 'openai';
  return 'ollama';
}

/** Fills defaults and moves a legacy OpenRouter key out of the OpenAI slot. */
export function normalizeSettings(s: AllSettings): AllSettings {
  const out: AllSettings = { ...s };
  for (const [key, fallback] of Object.entries(SETTING_DEFAULTS) as Array<[SettingKey, string]>) {
    if (!out[key]) out[key] = fallback;
  }
  if (out.coding_harness !== 'pi-harness' && out.coding_harness !== 'deepseek-harness') out.coding_harness = 'pi-harness';
  if (s.openai_base_url?.includes('openrouter')) {
    if (!s.openrouter_api_key) out.openrouter_api_key = s.openai_api_key ?? '';
    out.openai_api_key = '';
  }
  return out;
}

export function parseCustomProviders(s: AllSettings): CustomProviderConfig[] {
  if (s.custom_openai_providers) {
    try {
      const list = JSON.parse(s.custom_openai_providers) as unknown;
      if (Array.isArray(list) && list.length > 0) return list as CustomProviderConfig[];
    } catch {
      // fall through to the legacy single-provider keys
    }
  }
  if (s.custom_openai_base_url || s.custom_openai_api_key || s.custom_openai_models) {
    return [{
      ...DEFAULT_CUSTOM_PROVIDER,
      baseUrl: s.custom_openai_base_url || '',
      apiKey: s.custom_openai_api_key || '',
      models: s.custom_openai_models || '',
    }];
  }
  return [DEFAULT_CUSTOM_PROVIDER];
}

/** The list is canonical; the legacy keys mirror its first entry for older readers. */
export function customProviderWrites(list: CustomProviderConfig[]): SettingWrites {
  const primary = list[0] ?? DEFAULT_CUSTOM_PROVIDER;
  return [
    ['custom_openai_providers', JSON.stringify(list)],
    ['custom_openai_base_url', primary.baseUrl.trim()],
    ['custom_openai_api_key', (primary.apiKey ?? '').trim()],
    ['custom_openai_models', (primary.models ?? '').trim()],
  ];
}

interface BindOptions {
  /** Defaults to trimming the value before it is saved. */
  trim?: boolean;
  /** Fields in the same group are saved together, e.g. a host and its key. */
  group?: string;
  writes?: (value: string) => SettingWrites;
}

/**
 * Holds every setting in one map and autosaves edits, so dismissing the modal
 * (Escape, backdrop) or switching tabs never loses a pending change.
 */
export function useSettingsStore() {
  const [values, setValues] = useState<AllSettings>(SETTING_DEFAULTS);
  const [initialMode, setInitialMode] = useState<LlmMode>('ollama');
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<string | null>(null);
  const pending = useRef(new Map<string, SettingWrites>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    apiFetchSettings()
      .then((s: AllSettings) => {
        setInitialMode(detectLlmMode(s));
        setValues(normalizeSettings(s));
      })
      .catch(() => {/* best-effort */})
      .finally(() => setLoading(false));
  }, []);

  const flash = useCallback((label: string) => {
    setSaved(label);
    setTimeout(() => setSaved(null), 1800);
  }, []);

  /** Runs a group of writes, reporting failure instead of dropping it. */
  const persist = useCallback(async (writes: SettingWrites) => {
    try {
      for (const [key, value] of writes) await apiUpdateSetting(key, value);
      flash('Saved');
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Save failed');
    }
  }, [flash]);

  const flush = useCallback((group: string) => {
    const timer = timers.current.get(group);
    if (timer) clearTimeout(timer);
    timers.current.delete(group);
    const writes = pending.current.get(group);
    if (!writes) return Promise.resolve();
    pending.current.delete(group);
    return persist(writes);
  }, [persist]);

  useEffect(() => {
    const pendingGroups = pending.current;
    return () => {
      for (const group of [...pendingGroups.keys()]) void flush(group);
    };
  }, [flush]);

  /** Updates local values only; nothing is written until a save call. */
  const setLocal = useCallback((changes: AllSettings) => {
    setValues((prev) => ({ ...prev, ...changes }));
  }, []);

  /** Updates values and schedules a debounced save of `writes`. */
  const edit = useCallback((changes: AllSettings, writes: SettingWrites, group: string) => {
    setValues((prev) => ({ ...prev, ...changes }));
    pending.current.set(group, writes);
    const existing = timers.current.get(group);
    if (existing) clearTimeout(existing);
    timers.current.set(group, setTimeout(() => void flush(group), AUTOSAVE_DELAY_MS));
  }, [flush]);

  /** Updates values and saves immediately (toggles, selects). */
  const saveNow = useCallback((changes: AllSettings, writes: SettingWrites) => {
    setValues((prev) => ({ ...prev, ...changes }));
    return persist(writes);
  }, [persist]);

  const bindText = (key: SettingKey, options: BindOptions = {}) => {
    const group = options.group ?? key;
    return {
      value: values[key] ?? '',
      onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const value = e.target.value;
        const writes = options.writes
          ? options.writes(value)
          : [[key, options.trim === false ? value : value.trim()]] as SettingWrites;
        edit({ [key]: value }, writes, group);
      },
      onBlur: () => void flush(group),
    };
  };

  return { values, initialMode, loading, saved, persist, flush, setLocal, edit, saveNow, bindText };
}

export type SettingsStore = ReturnType<typeof useSettingsStore>;
