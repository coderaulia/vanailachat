import { useState, useEffect, useCallback, useRef } from 'react';
import { COLOR_SCHEME_STORAGE_KEY } from '../config/constants';
import type { ColorScheme } from '../config/constants';
import { apiExportTrainingData, apiFetchSettings, apiFetchTrainingExamples, apiFetchTrainingStats, apiUpdateSetting, isTauri } from '../lib/api';
import { useChat } from '../context/ChatContext';
import './SettingsModal.css';

interface CustomProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  models?: string;
}

interface AllSettings {
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

interface MemoryEntry {
  id: string;
  type: string;
  content: string;
  embedding: string;
  metadata: string | null;
  sourceId: string | null;
  createdAt: number;
}

type Tab = 'ai' | 'personalization' | 'behaviour' | 'appearance' | 'memories' | 'training' | 'about';

interface TrainingStats {
  pairs: number;
  explicit: number;
  edited: number;
  implicit: number;
  distillation: number;
  topChats: number;
  oldest: number | null;
  newest: number | null;
}
interface TrainingExample {
  id: string;
  chatId: string;
  chatTitle: string;
  userContent: string;
  assistantContent: string;
  rating: number;
  edited: boolean;
  createdAt: number;
}
type LlmMode = 'ollama' | 'custom' | '9router' | 'openrouter' | 'openai';

const STORAGE_KEY = 'vanaila_onboarding_done';

const COLOR_SCHEMES: { id: ColorScheme; label: string; swatches: string[] }[] = [
  { id: 'vanaila-origin', label: 'Vanaila Origin', swatches: ['#244e78', '#487fae'] },
  { id: 'catppuccin-teal', label: 'Catppuccin Teal', swatches: ['#179299', '#20b2ba'] },
  { id: 'catppuccin-rose', label: 'Catppuccin Rose', swatches: ['#d88a8a', '#f0c6c6'] },
  { id: 'catppuccin-blue', label: 'Catppuccin Blue', swatches: ['#5c7fdb', '#8caaee'] },
  { id: 'catppuccin-green', label: 'Catppuccin Green', swatches: ['#6aa857', '#a6da95'] },
  { id: 'catppuccin-peach', label: 'Catppuccin Peach', swatches: ['#e57d3c', '#fab387'] },
];

async function saveSetting(key: string, value: string) {
  if (isTauri) {
    await apiUpdateSetting(key, value);
    return;
  }
  const response = await fetch(`/api/settings/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  if (!response.ok) throw new Error(`Failed to save ${key} (HTTP ${response.status})`);
}

function useAutosave(value: string, action: () => void | Promise<void>, ready: boolean) {
  const actionRef = useRef(action);
  actionRef.current = action;
  const baseline = useRef<string | null>(null);
  const pendingValueRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (baseline.current === null) {
      baseline.current = value;
      return;
    }
    if (baseline.current === value) return;

    pendingValueRef.current = value;
    const timer = setTimeout(() => {
      baseline.current = value;
      pendingValueRef.current = null;
      void actionRef.current();
    }, 400);

    return () => {
      clearTimeout(timer);
      if (pendingValueRef.current !== null && pendingValueRef.current !== baseline.current) {
        baseline.current = pendingValueRef.current;
        pendingValueRef.current = null;
        void actionRef.current();
      }
    };
  }, [value, ready]);
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { isDarkMode, toggleTheme } = useChat();
  const [activeTab, setActiveTab] = useState<Tab>('ai');
  const settingsTabsRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<string | null>(null);

  // AI Connection
  const [llmMode, setLlmMode] = useState<LlmMode>('ollama');
  const [ollamaHost, setOllamaHost] = useState('http://localhost:11434');
  const [openaiKey, setOpenaiKey] = useState('');
  const [openrouterKey, setOpenrouterKey] = useState('');
  const [nineRouterHost, setNineRouterHost] = useState('http://localhost:20128/v1');
  const [nineRouterKey, setNineRouterKey] = useState('');
  const [customProviders, setCustomProviders] = useState<CustomProviderConfig[]>([
    { id: 'custom', name: 'Custom', baseUrl: '', apiKey: '', models: '' },
  ]);
  const [activeCustomId, setActiveCustomId] = useState<string>('custom');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');

  // Profile
  const [userName, setUserName] = useState('');
  const [userRole, setUserRole] = useState('');

  // Coding Workspace Engine
  const [codingHarness, setCodingHarness] = useState<'pi-harness' | 'deepseek-harness'>('pi-harness');
  const [codingSetupExpanded, setCodingSetupExpanded] = useState(false);
  const [piAgentDir, setPiAgentDir] = useState('');
  const [piApiKey, setPiApiKey] = useState('');
  const [piBaseUrl, setPiBaseUrl] = useState('');
  const [piModel, setPiModel] = useState('');
  const [piProvider, setPiProvider] = useState('');
  const [piSystemPrompt, setPiSystemPrompt] = useState('');
  const [piThinkingLevel, setPiThinkingLevel] = useState('medium');
  const [piToolPolicy, setPiToolPolicy] = useState('approval');
  const [deepseekApiKey, setDeepseekApiKey] = useState('');
  const [deepseekBaseUrl, setDeepseekBaseUrl] = useState('');
  const [deepseekModel, setDeepseekModel] = useState('');
  const [dshPath, setDshPath] = useState('');
  const [dshProfile, setDshProfile] = useState('');

  // Instructions
  const [baseInstructions, setBaseInstructions] = useState('');

  // Behaviour
  const [requireApproval, setRequireApproval] = useState(true);
  const [skillsInline, setSkillsInline] = useState(false);
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [modelPricing, setModelPricing] = useState('');
  const [pricingError, setPricingError] = useState<string | null>(null);

  // Appearance
  const [activeColorScheme, setActiveColorScheme] = useState<ColorScheme>(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(COLOR_SCHEME_STORAGE_KEY) : null;
    return (stored as ColorScheme) || 'vanaila-origin';
  });

  const applyColorScheme = (scheme: ColorScheme) => {
    setActiveColorScheme(scheme);
    window.localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, scheme);
    if (scheme === 'vanaila-origin') {
      document.documentElement.removeAttribute('data-color-scheme');
    } else {
      document.documentElement.setAttribute('data-color-scheme', scheme);
    }
  };

  // Memories
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(false);
  const [memoriesDeleting, setMemoriesDeleting] = useState<string | null>(null);
  const [memoriesError, setMemoriesError] = useState<string | null>(null);
  const memoriesFetched = useRef(false);

  // Training
  const [trainingStats, setTrainingStats] = useState<TrainingStats | null>(null);
  const [trainingLoading, setTrainingLoading] = useState(false);
  const [trainingExporting, setTrainingExporting] = useState(false);
  const [trainingResult, setTrainingResult] = useState<{ path: string; pairs: number; explicit: number; distilled: number; format: string } | null>(null);
  const [trainingError, setTrainingError] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<'sharegpt' | 'alpaca'>('sharegpt');
  const [includeDistillation, setIncludeDistillation] = useState(false);
  const [trainingExamples, setTrainingExamples] = useState<TrainingExample[]>([]);
  const [selectedTrainingIds, setSelectedTrainingIds] = useState<Set<string>>(new Set());
  const trainingFetched = useRef(false);

  const flash = (label: string) => {
    setSaved(label);
    setTimeout(() => setSaved(null), 1800);
  };

  // Load all settings at once on open
  useEffect(() => {
    apiFetchSettings()
      .then((s: AllSettings) => {
        if (s.ollama_host) setOllamaHost(s.ollama_host);

        // Load custom providers
        if (s.custom_openai_providers) {
          try {
            const list = JSON.parse(s.custom_openai_providers);
            if (Array.isArray(list) && list.length > 0) {
              setCustomProviders(list);
              setActiveCustomId(list[0].id);
            }
          } catch {
            // fallback
          }
        } else if (s.custom_openai_base_url || s.custom_openai_api_key || s.custom_openai_models) {
          const legacy: CustomProviderConfig = {
            id: 'custom',
            name: 'Custom',
            baseUrl: s.custom_openai_base_url || '',
            apiKey: s.custom_openai_api_key || '',
            models: s.custom_openai_models || '',
          };
          setCustomProviders([legacy]);
          setActiveCustomId('custom');
        }

        if (s.openrouter_api_key) {
          setLlmMode('openrouter');
          setOpenrouterKey(s.openrouter_api_key);
        } else if (s.custom_openai_providers || s.custom_openai_base_url || s.custom_openai_api_key || s.custom_openai_models) {
          setLlmMode('custom');
        } else if (s.nine_router_api_key) {
          setLlmMode('9router');
          setNineRouterKey(s.nine_router_api_key);
        } else if (s.openai_api_key) {
          if (s.openai_base_url?.includes('openrouter')) {
            setLlmMode('openrouter');
            setOpenrouterKey(s.openai_api_key);
          } else {
            setLlmMode('openai');
            setOpenaiKey(s.openai_api_key);
          }
        } else {
          setLlmMode('ollama');
        }
        if (s.openrouter_api_key) setOpenrouterKey(s.openrouter_api_key);
        if (s.openai_api_key && !s.openai_base_url?.includes('openrouter')) setOpenaiKey(s.openai_api_key);
        if (s.nine_router_host) setNineRouterHost(s.nine_router_host);
        if (s.nine_router_api_key) setNineRouterKey(s.nine_router_api_key);
        if (s.coding_harness === 'deepseek-harness' || s.coding_harness === 'pi-harness') {
          setCodingHarness(s.coding_harness);
        }
        if (s.pi_agent_dir) setPiAgentDir(s.pi_agent_dir);
        if (s.pi_api_key) setPiApiKey(s.pi_api_key);
        if (s.pi_base_url) setPiBaseUrl(s.pi_base_url);
        if (s.pi_model) setPiModel(s.pi_model);
        if (s.pi_provider) setPiProvider(s.pi_provider);
        if (s.pi_system_prompt) setPiSystemPrompt(s.pi_system_prompt);
        if (s.pi_thinking_level) setPiThinkingLevel(s.pi_thinking_level);
        if (s.pi_tool_policy) setPiToolPolicy(s.pi_tool_policy);
        if (s.deepseek_api_key) setDeepseekApiKey(s.deepseek_api_key);
        if (s.deepseek_base_url) setDeepseekBaseUrl(s.deepseek_base_url);
        if (s.deepseek_model) setDeepseekModel(s.deepseek_model);
        if (s.dsh_path) setDshPath(s.dsh_path);
        if (s.dsh_profile) setDshProfile(s.dsh_profile);
        if (s.user_name) setUserName(s.user_name);
        if (s.user_role) setUserRole(s.user_role);
        if (s.base_instructions) setBaseInstructions(s.base_instructions);
        // Approval defaults to on, so only an explicit 'false' turns it off.
        setRequireApproval(s.require_tool_approval !== 'false');
        setSkillsInline(s.skills_inline === 'true');
        setMemoryEnabled(s.memory_enabled !== 'false');
        if (s.model_pricing) setModelPricing(s.model_pricing);
      })
      .catch(() => {/* best-effort */})
      .finally(() => setLoading(false));
  }, []);

  // Fetch memories when tab opens
  useEffect(() => {
    if (activeTab !== 'memories' || memoriesFetched.current) return;
    setMemoriesLoading(true);
    fetch('/api/memory')
      .then((r) => r.json())
      .then((data: { memories: MemoryEntry[] }) => setMemories(data.memories ?? []))
      .catch(() => {})
      .finally(() => {
        setMemoriesLoading(false);
        memoriesFetched.current = true;
      });
  }, [activeTab]);

  // Fetch training stats when tab opens
  useEffect(() => {
    if (activeTab !== 'training' || trainingFetched.current) return;
    setTrainingLoading(true);
    Promise.all([apiFetchTrainingStats(), apiFetchTrainingExamples()])
      .then(([data, examples]) => {
        setTrainingStats(data);
        const nextExamples = examples.map((example) => ({
          id: example.id,
          chatId: example.chatId ?? example.chat_id ?? '',
          chatTitle: example.chatTitle ?? example.chat_title ?? '',
          userContent: example.userContent ?? example.user_content ?? '',
          assistantContent: example.assistantContent ?? example.assistant_content ?? '',
          rating: example.rating,
          edited: example.edited,
          createdAt: example.createdAt ?? example.created_at ?? 0,
        }));
        setTrainingExamples(nextExamples);
        setSelectedTrainingIds(new Set(nextExamples.map((example) => example.id)));
      })
      .catch(() => setTrainingError('Failed to load stats'))
      .finally(() => {
        setTrainingLoading(false);
        trainingFetched.current = true;
      });
  }, [activeTab]);

  const refreshTrainingStats = async () => {
    setTrainingLoading(true);
    setTrainingError(null);
    try {
      const [data, examples] = await Promise.all([apiFetchTrainingStats(), apiFetchTrainingExamples()]);
      setTrainingStats(data);
      const nextExamples = examples.map((example) => ({
        id: example.id,
        chatId: example.chatId ?? example.chat_id ?? '',
        chatTitle: example.chatTitle ?? example.chat_title ?? '',
        userContent: example.userContent ?? example.user_content ?? '',
        assistantContent: example.assistantContent ?? example.assistant_content ?? '',
        rating: example.rating,
        edited: example.edited,
        createdAt: example.createdAt ?? example.created_at ?? 0,
      }));
      setTrainingExamples(nextExamples);
      setSelectedTrainingIds(new Set(nextExamples.map((example) => example.id)));
    } catch {
      setTrainingError('Failed to load stats');
    } finally {
      setTrainingLoading(false);
    }
  };

  const exportTrainingData = async () => {
    setTrainingExporting(true);
    setTrainingError(null);
    setTrainingResult(null);
    try {
      const data = await apiExportTrainingData({ format: exportFormat, selectedIds: [...selectedTrainingIds] }) as { path?: string; pairs?: number; explicit?: number; distilled?: number; format?: string; error?: string };
      if (data.error) {
        setTrainingError(data.error);
        return;
      }
      if (data.path && typeof data.pairs === 'number' && data.format) {
        setTrainingResult({ path: data.path, pairs: data.pairs, explicit: data.explicit ?? data.pairs, distilled: data.distilled ?? 0, format: data.format });
      }
    } catch (err) {
      setTrainingError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setTrainingExporting(false);
    }
  };

  const refreshMemories = async () => {
    setMemoriesLoading(true);
    try {
      const r = await fetch('/api/memory');
      const data = (await r.json()) as { memories: MemoryEntry[] };
      setMemories(data.memories ?? []);
    } catch {
      // best-effort
    }
    setMemoriesLoading(false);
  };

  const deleteMemory = async (id: string) => {
    setMemoriesDeleting(id);
    try {
      await fetch(`/api/memory/${id}`, { method: 'DELETE' });
      setMemories((prev) => prev.filter((m) => m.id !== id));
    } catch {
      // best-effort
    }
    setMemoriesDeleting(null);
  };

  const addMemory = async () => {
    const content = window.prompt('What should the assistant remember?');
    if (!content?.trim()) return;
    try {
      const response = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.trim(), type: 'manual' }),
      });
      if (!response.ok) throw new Error('Could not save memory');
      const data = await response.json() as { memory?: MemoryEntry };
      if (data.memory) setMemories((prev) => [data.memory!, ...prev.filter((m) => m.id !== data.memory!.id)]);
    } catch {
      setMemoriesError('Could not save memory');
    }
  };

  const forgetAllMemories = async () => {
    if (!window.confirm('Forget all saved memories? Your chats will not be deleted.')) return;
    try {
      const response = await fetch('/api/memory', { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not delete memories');
      setMemories([]);
    } catch {
      setMemoriesError('Could not delete memories');
    }
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  /** Runs a group of writes, reporting failure instead of dropping it. */
  const persist = useCallback(async (writes: Array<[string, string]>) => {
    try {
      for (const [key, value] of writes) await saveSetting(key, value);
      flash('Saved');
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Save failed');
    }
  }, []);

  const saveOllamaHost = useCallback(
    () => persist([['ollama_host', ollamaHost]]),
    [persist, ollamaHost],
  );

  const saveOpenaiKey = useCallback(
    () => persist([
      ['openai_api_key', openaiKey.trim()],
      ['openai_base_url', 'https://api.openai.com/v1'],
    ]),
    [persist, openaiKey],
  );

  const saveOpenrouterKey = useCallback(
    () => persist([
      ['openrouter_api_key', openrouterKey.trim()],
      ['openrouter_base_url', 'https://openrouter.ai/api/v1'],
    ]),
    [persist, openrouterKey],
  );

  const saveNineRouterConfig = useCallback(
    () => persist([
      ['nine_router_host', nineRouterHost.trim()],
      ['nine_router_api_key', nineRouterKey.trim()],
    ]),
    [persist, nineRouterHost, nineRouterKey],
  );

  const saveCustomProviders = useCallback((providersToSave: CustomProviderConfig[]) => {
    const primary = providersToSave[0] ?? { id: 'custom', name: 'Custom', baseUrl: '', apiKey: '', models: '' };
    void persist([
      ['custom_openai_providers', JSON.stringify(providersToSave)],
      ['custom_openai_base_url', primary.baseUrl.trim()],
      ['custom_openai_api_key', (primary.apiKey ?? '').trim()],
      ['custom_openai_models', (primary.models ?? '').trim()],
    ]);
  }, [persist]);

  const updateCurrentCustomProvider = (field: keyof CustomProviderConfig, value: string) => {
    setCustomProviders((prev) => {
      const updated = prev.map((p) => (p.id === activeCustomId ? { ...p, [field]: value } : p));
      saveCustomProviders(updated);
      return updated;
    });
  };

  const addCustomProvider = () => {
    const newId = `custom_${Date.now()}`;
    const newProvider: CustomProviderConfig = {
      id: newId,
      name: `Provider ${customProviders.length + 1}`,
      baseUrl: '',
      apiKey: '',
      models: '',
    };
    const updated = [...customProviders, newProvider];
    setCustomProviders(updated);
    setActiveCustomId(newId);
    saveCustomProviders(updated);
  };

  const removeCustomProvider = (idToRemove: string) => {
    if (customProviders.length <= 1) return;
    const updated = customProviders.filter((p) => p.id !== idToRemove);
    setCustomProviders(updated);
    if (activeCustomId === idToRemove) {
      setActiveCustomId(updated[0]?.id || 'custom');
    }
    saveCustomProviders(updated);
  };

  const savePiAgentDir = useCallback(
    () => persist([['pi_agent_dir', piAgentDir.trim()]]),
    [persist, piAgentDir],
  );

  const savePiApiKey = useCallback(
    () => persist([['pi_api_key', piApiKey.trim()]]),
    [persist, piApiKey],
  );

  const savePiBaseUrl = useCallback(
    () => persist([['pi_base_url', piBaseUrl.trim()]]),
    [persist, piBaseUrl],
  );

  const savePiModel = useCallback(
    () => persist([['pi_model', piModel.trim()]]),
    [persist, piModel],
  );

  const savePiProvider = useCallback(
    () => persist([['pi_provider', piProvider.trim()]]),
    [persist, piProvider],
  );

  const savePiSystemPrompt = useCallback(
    () => persist([['pi_system_prompt', piSystemPrompt]]),
    [persist, piSystemPrompt],
  );

  const savePiThinkingLevel = useCallback(
    (level: string) => {
      setPiThinkingLevel(level);
      return persist([['pi_thinking_level', level]]);
    },
    [persist],
  );

  const savePiToolPolicy = useCallback(
    (policy: string) => {
      setPiToolPolicy(policy);
      return persist([['pi_tool_policy', policy]]);
    },
    [persist],
  );

  const selectCodingHarness = useCallback(
    (harness: 'pi-harness' | 'deepseek-harness') => {
      setCodingHarness(harness);
      void persist([['coding_harness', harness]]);
    },
    [persist],
  );

  const saveDeepseekApiKey = useCallback(
    () => persist([['deepseek_api_key', deepseekApiKey.trim()]]),
    [persist, deepseekApiKey],
  );

  const saveDeepseekBaseUrl = useCallback(
    () => persist([['deepseek_base_url', deepseekBaseUrl.trim()]]),
    [persist, deepseekBaseUrl],
  );

  const saveDeepseekModel = useCallback(
    () => persist([['deepseek_model', deepseekModel.trim()]]),
    [persist, deepseekModel],
  );

  const saveDshPath = useCallback(
    () => persist([['dsh_path', dshPath.trim()]]),
    [persist, dshPath],
  );

  const saveDshProfile = useCallback(
    () => persist([['dsh_profile', dshProfile.trim()]]),
    [persist, dshProfile],
  );

  // Profile fields save even when emptied, so clearing one actually sticks.
  const saveUserName = useCallback(
    () => persist([['user_name', userName.trim()]]),
    [persist, userName],
  );

  const saveUserRole = useCallback(
    () => persist([['user_role', userRole.trim()]]),
    [persist, userRole],
  );

  const saveBaseInstructions = useCallback(
    () => persist([['base_instructions', baseInstructions.trim()]]),
    [persist, baseInstructions],
  );

  const toggleApproval = useCallback(
    (next: boolean) => {
      setRequireApproval(next);
      void persist([['require_tool_approval', next ? 'true' : 'false']]);
    },
    [persist],
  );

  const toggleSkillsInline = useCallback(
    (next: boolean) => {
      setSkillsInline(next);
      void persist([['skills_inline', next ? 'true' : 'false']]);
    },
    [persist],
  );

  const toggleMemoryEnabled = useCallback((next: boolean) => {
    setMemoryEnabled(next);
    void persist([['memory_enabled', next ? 'true' : 'false']]);
  }, [persist]);

  // Saved only when it parses, so a half-typed object cannot break cost display.
  const saveModelPricing = useCallback(() => {
    const raw = modelPricing.trim();
    if (!raw) {
      setPricingError(null);
      return persist([['model_pricing', '']]);
    }

    try {
      JSON.parse(raw);
      setPricingError(null);
      return persist([['model_pricing', raw]]);
    } catch (error) {
      setPricingError(error instanceof Error ? error.message : 'Invalid JSON');
      return Promise.resolve();
    }
  }, [persist, modelPricing]);

  // Autosave every field so an Escape or backdrop dismissal cannot lose edits.
  const ready = !loading;
  useAutosave(ollamaHost, saveOllamaHost, ready);
  useAutosave(openaiKey, saveOpenaiKey, ready);
  useAutosave(openrouterKey, saveOpenrouterKey, ready);
  useAutosave(nineRouterHost, saveNineRouterConfig, ready);
  useAutosave(nineRouterKey, saveNineRouterConfig, ready);
  useAutosave(piAgentDir, savePiAgentDir, ready);
  useAutosave(piApiKey, savePiApiKey, ready);
  useAutosave(piBaseUrl, savePiBaseUrl, ready);
  useAutosave(piModel, savePiModel, ready);
  useAutosave(piProvider, savePiProvider, ready);
  useAutosave(piSystemPrompt, savePiSystemPrompt, ready);
  useAutosave(deepseekApiKey, saveDeepseekApiKey, ready);
  useAutosave(deepseekBaseUrl, saveDeepseekBaseUrl, ready);
  useAutosave(deepseekModel, saveDeepseekModel, ready);
  useAutosave(dshPath, saveDshPath, ready);
  useAutosave(dshProfile, saveDshProfile, ready);
  useAutosave(userName, saveUserName, ready);
  useAutosave(userRole, saveUserRole, ready);
  useAutosave(baseInstructions, saveBaseInstructions, ready);

  const testConnection = async () => {
    setTestStatus('testing');
    try {
      if (llmMode === 'ollama') await saveOllamaHost();
      else if (llmMode === 'openai') await saveOpenaiKey();
      else if (llmMode === 'openrouter') await saveOpenrouterKey();
      else if (llmMode === '9router') await saveNineRouterConfig();
      else if (llmMode === 'custom') saveCustomProviders(customProviders);

      const res = await fetch('/api/models');
      if (res.ok) {
        const data = (await res.json()) as { models?: string[] };
        const count = Array.isArray(data.models) ? data.models.length : 0;
        setTestStatus(count > 0 ? 'ok' : 'fail');
      } else {
        setTestStatus('fail');
      }
    } catch {
      setTestStatus('fail');
    }
    setTimeout(() => setTestStatus('idle'), 3000);
  };

  const rerunSetup = async () => {
    await saveSetting('onboarding_done', 'false');
    localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  };

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'ai',
      label: 'AI Connection',
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a4 4 0 0 1 4 4c0 1.1-.5 2.1-1.2 2.8l-.8.7v1.5h-4V9.5l-.8-.7A4 4 0 0 1 12 2z" />
          <path d="M9 18h6" />
          <path d="M10 22h4" />
          <path d="M8 14h8" />
        </svg>
      ),
    },
    {
      id: 'personalization',
      label: 'Personalization',
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      ),
    },
    {
      id: 'behaviour',
      label: 'Behaviour',
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      ),
    },
    {
      id: 'appearance',
      label: 'Appearance',
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
          <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
          <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
          <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
          <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.5 17.5 2 12 2z" />
        </svg>
      ),
    },
    {
      id: 'memories',
      label: 'Memories',
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
      ),
    },
    {
      id: 'training',
      label: 'Training',
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 18h12" />
          <path d="M6 14h12" />
          <path d="M10 2v4" />
          <path d="M14 2v4" />
          <path d="M10 2h4" />
          <path d="M8.5 6h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
        </svg>
      ),
    },
    {
      id: 'about',
      label: 'About',
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      ),
    },
  ];

  return (
    <div
      className="settings-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="settings-card">
        {/* Header */}
        <div className="settings-header">
          <h2 className="settings-title">Settings</h2>
          {saved && <span className="settings-saved-badge">✓ {saved}</span>}
          <button
            type="button"
            className="settings-close"
            aria-label="Close settings"
            onClick={onClose}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tab bar */}
        <div className="settings-tabs-wrap">
          <div ref={settingsTabsRef} className="settings-tabs" role="tablist">
            {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeTab === t.id}
              className={`settings-tab ${activeTab === t.id ? 'is-active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              <span className="settings-tab-icon">{t.icon}</span>
              <span>{t.label}</span>
            </button>
            ))}
          </div>
          <button
            type="button"
            className="settings-tabs-arrow"
            aria-label="Show more settings"
            title="Show more settings"
            onClick={() => settingsTabsRef.current?.scrollBy({ left: 220, behavior: 'smooth' })}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="settings-body">
          {loading ? (
            <div className="settings-loading">Loading…</div>
          ) : (
            <>
              {/* ── AI Connection ── */}
              {activeTab === 'ai' && (
                <div className="settings-section">
                  <div className="settings-llm-tabs">
                    <button
                      type="button"
                      className={`settings-llm-tab ${llmMode === 'ollama' ? 'is-active' : ''}`}
                      onClick={() => setLlmMode('ollama')}
                    >Ollama (Local)</button>
                    <button
                      type="button"
                      className={`settings-llm-tab ${llmMode === 'custom' ? 'is-active' : ''}`}
                      onClick={() => setLlmMode('custom')}
                    >Custom Provider{customProviders.length > 1 ? ` (${customProviders.length})` : ''}</button>
                    <button
                      type="button"
                      className={`settings-llm-tab ${llmMode === '9router' ? 'is-active' : ''}`}
                      onClick={() => setLlmMode('9router')}
                    >9Router</button>
                    <button
                      type="button"
                      className={`settings-llm-tab ${llmMode === 'openrouter' ? 'is-active' : ''}`}
                      onClick={() => setLlmMode('openrouter')}
                    >OpenRouter</button>
                    <button
                      type="button"
                      className={`settings-llm-tab ${llmMode === 'openai' ? 'is-active' : ''}`}
                      onClick={() => setLlmMode('openai')}
                    >OpenAI</button>
                  </div>

                  {llmMode === 'ollama' && (
                    <div className="settings-field">
                      <label className="settings-label">Ollama Host URL</label>
                      <input
                        className="settings-input"
                        value={ollamaHost}
                        onChange={(e) => setOllamaHost(e.target.value)}
                        onBlur={saveOllamaHost}
                        placeholder="http://localhost:11434"
                      />
                      <p className="settings-hint">Default works if Ollama is running locally. Change for remote hosts.</p>
                    </div>
                  )}

                  {llmMode === 'custom' && (
                    <div className="settings-custom-section">
                      {/* Provider subtabs */}
                      <div className="settings-custom-picker-row">
                        <div className="settings-custom-pills">
                          {customProviders.map((p, idx) => (
                            <button
                              key={p.id}
                              type="button"
                              className={`settings-custom-pill ${activeCustomId === p.id ? 'is-active' : ''}`}
                              onClick={() => setActiveCustomId(p.id)}
                            >
                              <span>{p.name || `Provider ${idx + 1}`}</span>
                              {customProviders.length > 1 && (
                                <span
                                  className="settings-custom-pill-del"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeCustomProvider(p.id);
                                  }}
                                  title="Remove provider"
                                >
                                  ✕
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="settings-custom-add-btn"
                          onClick={addCustomProvider}
                          title="Add another OpenAI-compatible provider"
                        >
                          + Add Provider
                        </button>
                      </div>

                      {(() => {
                        const current = customProviders.find((p) => p.id === activeCustomId) || customProviders[0] || {
                          id: 'custom',
                          name: 'Custom',
                          baseUrl: '',
                          apiKey: '',
                          models: '',
                        };
                        return (
                          <div className="settings-custom-fields">
                            <div className="settings-field">
                              <label className="settings-label">Provider Name</label>
                              <input
                                className="settings-input"
                                value={current.name}
                                onChange={(e) => updateCurrentCustomProvider('name', e.target.value)}
                                placeholder="e.g. Vikey AI, Groq, DeepSeek Direct, LM Studio"
                              />
                            </div>

                            <div className="settings-field">
                              <label className="settings-label">Base URL</label>
                              <input
                                className="settings-input"
                                value={current.baseUrl}
                                onChange={(e) => updateCurrentCustomProvider('baseUrl', e.target.value)}
                                placeholder="https://api.example.com/v1"
                              />
                              <p className="settings-hint">
                                Any OpenAI-compatible endpoint — Groq, Together, Fireworks, DeepSeek, Mistral, LM Studio, vLLM, etc.
                              </p>
                            </div>

                            <div className="settings-field">
                              <label className="settings-label">API Key <span className="settings-optional">(optional for local endpoints)</span></label>
                              <input
                                className="settings-input"
                                type="password"
                                value={current.apiKey || ''}
                                onChange={(e) => updateCurrentCustomProvider('apiKey', e.target.value)}
                                placeholder="sk-..."
                              />
                            </div>

                            <div className="settings-field">
                              <label className="settings-label">Custom Models (IDs)</label>
                              <input
                                className="settings-input"
                                value={current.models || ''}
                                onChange={(e) => updateCurrentCustomProvider('models', e.target.value)}
                                placeholder="gpt-4o, claude-3-7-sonnet-20250219, deepseek-chat"
                              />
                              <p className="settings-hint">
                                Comma-separated model names or IDs. Useful when the provider does not support dynamic discovery via /models.
                              </p>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {llmMode === '9router' && (
                    <div className="settings-field">
                      <label className="settings-label">9Router Host URL</label>
                      <input
                        className="settings-input"
                        value={nineRouterHost}
                        onChange={(e) => setNineRouterHost(e.target.value)}
                        onBlur={saveNineRouterConfig}
                        placeholder="http://localhost:20128/v1"
                      />
                      <p className="settings-hint">Default works if 9Router is running locally. Change for remote hosts.</p>
                    </div>
                  )}

                  {llmMode === '9router' && (
                    <div className="settings-field">
                      <label className="settings-label">9Router API Key</label>
                      <input
                        className="settings-input"
                        type="password"
                        value={nineRouterKey}
                        onChange={(e) => setNineRouterKey(e.target.value)}
                        onBlur={saveNineRouterConfig}
                        placeholder="Copy from 9Router dashboard →"
                      />
                      <p className="settings-hint">Get your API key at <a href="http://localhost:20128/dashboard" target="_blank" rel="noreferrer">9Router Dashboard</a></p>
                    </div>
                  )}

                  {llmMode === 'openrouter' && (
                    <div className="settings-field">
                      <label className="settings-label">OpenRouter API Key</label>
                      <input
                        className="settings-input"
                        type="password"
                        value={openrouterKey}
                        onChange={(e) => setOpenrouterKey(e.target.value)}
                        onBlur={saveOpenrouterKey}
                        placeholder="sk-or-..."
                      />
                      <p className="settings-hint">Access 100+ models at <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">openrouter.ai</a></p>
                    </div>
                  )}

                  {llmMode === 'openai' && (
                    <div className="settings-field">
                      <label className="settings-label">OpenAI API Key</label>
                      <input
                        className="settings-input"
                        type="password"
                        value={openaiKey}
                        onChange={(e) => setOpenaiKey(e.target.value)}
                        onBlur={saveOpenaiKey}
                        placeholder="sk-..."
                      />
                      <p className="settings-hint">Get your key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com</a></p>
                    </div>
                  )}

                  {/* Coding Workspace Engine Selection */}
                  <div className="settings-field settings-field--harness">
                    <div className="settings-harness-badge-row">
                      <label className="settings-label">Coding Workspace Engine</label>
                      {codingHarness === 'pi-harness' ? (
                        <span className="settings-harness-badge">
                          🧭 Powered by <a href="https://github.com/earendil-works/pi" target="_blank" rel="noreferrer">Pi</a>
                        </span>
                      ) : (
                        <span className="settings-harness-badge settings-dsh-badge">
                          🐋 Powered by <a href="https://github.com/deepseek-ai/deepseek-harness.git" target="_blank" rel="noreferrer">DeepSeek Harness</a>
                        </span>
                      )}
                    </div>

                    <div className="settings-harness-selector">
                      <button
                        type="button"
                        className={`settings-harness-btn ${codingHarness === 'pi-harness' ? 'is-active' : ''}`}
                        onClick={() => selectCodingHarness('pi-harness')}
                      >
                        🧭 Pi Harness
                      </button>
                      <button
                        type="button"
                        className={`settings-harness-btn ${codingHarness === 'deepseek-harness' ? 'is-active' : ''}`}
                        onClick={() => selectCodingHarness('deepseek-harness')}
                      >
                        🐋 DeepSeek Harness (dsh)
                      </button>
                    </div>

                    <button
                      type="button"
                      className="settings-setup-toggle"
                      onClick={() => setCodingSetupExpanded((expanded) => !expanded)}
                      aria-expanded={codingSetupExpanded}
                    >
                      <span>{codingSetupExpanded ? 'Hide setup' : 'Configure setup'}</span>
                      <span aria-hidden="true">{codingSetupExpanded ? '▴' : '▾'}</span>
                    </button>

                    {codingSetupExpanded && (codingHarness === 'pi-harness' ? (
                      <>
                        <p className="settings-hint" style={{ marginTop: '2px', marginBottom: '8px' }}>
                          <a href="https://github.com/earendil-works/pi" target="_blank" rel="noreferrer">Pi</a> runs through its official coding-agent SDK with read, edit, write, search, and shell tools.
                        </p>

                        <div className="settings-subfields">
                          <div className="settings-subfield">
                            <label className="settings-sublabel">Pi Provider</label>
                            <input
                              className="settings-input"
                              value={piProvider}
                              onChange={(e) => setPiProvider(e.target.value)}
                              onBlur={savePiProvider}
                              placeholder="anthropic, openai, google, or custom-id"
                            />
                            <p className="settings-subhint">Use a built-in Pi provider ID, or the provider ID from your Pi <code>models.json</code>.</p>
                          </div>

                          <div className="settings-subfield" style={{ marginTop: '8px' }}>
                            <label className="settings-sublabel">Pi Model</label>
                            <input
                              className="settings-input"
                              value={piModel}
                              onChange={(e) => setPiModel(e.target.value)}
                              onBlur={savePiModel}
                              placeholder="claude-sonnet-4-5 or gpt-5.2"
                            />
                            <p className="settings-subhint">The model ID without provider prefix; <code>provider/model</code> is also accepted when Provider is set.</p>
                          </div>

                          <div className="settings-subfield" style={{ marginTop: '8px' }}>
                            <label className="settings-sublabel">Pi API Key <span className="settings-optional">(optional)</span></label>
                            <input
                              className="settings-input"
                              type="password"
                              value={piApiKey}
                              onChange={(e) => setPiApiKey(e.target.value)}
                              onBlur={savePiApiKey}
                              placeholder="Leave blank to use Pi auth.json or environment"
                            />
                          </div>

                          <div className="settings-subfield" style={{ marginTop: '8px' }}>
                            <label className="settings-sublabel">Custom Base URL <span className="settings-optional">(optional)</span></label>
                            <input
                              className="settings-input"
                              value={piBaseUrl}
                              onChange={(e) => setPiBaseUrl(e.target.value)}
                              onBlur={savePiBaseUrl}
                              placeholder="https://openrouter.ai/api/v1"
                            />
                            <p className="settings-subhint">Adds a temporary OpenAI-compatible Pi provider. Leave blank for built-in providers.</p>
                          </div>

                          <div className="settings-subfield" style={{ marginTop: '8px' }}>
                            <label className="settings-sublabel">Thinking Level</label>
                            <select
                              className="settings-input"
                              value={piThinkingLevel}
                              onChange={(e) => void savePiThinkingLevel(e.target.value)}
                            >
                              {['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((level) => (
                                <option key={level} value={level}>{level}</option>
                              ))}
                            </select>
                          </div>

                          <div className="settings-subfield" style={{ marginTop: '8px' }}>
                            <label className="settings-sublabel">Tool Policy</label>
                            <select
                              className="settings-input"
                              value={piToolPolicy}
                              onChange={(e) => void savePiToolPolicy(e.target.value)}
                            >
                              <option value="approval">Approval for writes and commands</option>
                              <option value="readonly">Read-only mode</option>
                              <option value="autonomous">Autonomous coding</option>
                            </select>
                            <p className="settings-subhint">Approval is recommended. Read-only disables Pi’s edit, write, and shell tools.</p>
                          </div>

                          <div className="settings-subfield" style={{ marginTop: '8px' }}>
                            <label className="settings-sublabel">Pi Agent Directory <span className="settings-optional">(optional)</span></label>
                            <input
                              className="settings-input"
                              value={piAgentDir}
                              onChange={(e) => setPiAgentDir(e.target.value)}
                              onBlur={savePiAgentDir}
                              placeholder="~/.pi/agent"
                            />
                            <p className="settings-subhint">Used for Pi settings, auth, custom models, skills, and catalogs.</p>
                          </div>

                          <div className="settings-subfield" style={{ marginTop: '8px' }}>
                            <label className="settings-sublabel">Pi System Prompt <span className="settings-optional">(optional)</span></label>
                            <textarea
                              className="settings-input"
                              rows={4}
                              value={piSystemPrompt}
                              onChange={(e) => setPiSystemPrompt(e.target.value)}
                              onBlur={savePiSystemPrompt}
                              placeholder="Leave blank to use Pi’s default coding prompt"
                            />
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="settings-hint" style={{ marginTop: '2px', marginBottom: '8px' }}>
                          <a href="https://github.com/deepseek-ai/deepseek-harness.git" target="_blank" rel="noreferrer">DeepSeek Harness</a> (<code>dsh</code>) is an open-source, plugin-based agent runtime framework for autonomous coding, workspace tool execution, and planning.
                        </p>

                        <div className="settings-subfields">
                          <div className="settings-subfield">
                            <label className="settings-sublabel">DeepSeek API Key <span className="settings-optional">(optional)</span></label>
                            <input
                              className="settings-input"
                              type="password"
                              value={deepseekApiKey}
                              onChange={(e) => setDeepseekApiKey(e.target.value)}
                              onBlur={saveDeepseekApiKey}
                              placeholder="sk-... (leave blank to use active provider / environment)"
                            />
                            <p className="settings-subhint">Get your key from <a href="https://platform.deepseek.com" target="_blank" rel="noreferrer">platform.deepseek.com</a></p>
                          </div>

                          <div className="settings-subfield" style={{ marginTop: '8px' }}>
                            <label className="settings-sublabel">DeepSeek Base URL <span className="settings-optional">(optional)</span></label>
                            <input
                              className="settings-input"
                              value={deepseekBaseUrl}
                              onChange={(e) => setDeepseekBaseUrl(e.target.value)}
                              onBlur={saveDeepseekBaseUrl}
                              placeholder="https://api.deepseek.com"
                            />
                            <p className="settings-subhint">Defaults to official DeepSeek API or custom proxy endpoint.</p>
                          </div>

                          <div className="settings-subfield" style={{ marginTop: '8px' }}>
                            <label className="settings-sublabel">DeepSeek Model <span className="settings-optional">(optional)</span></label>
                            <input
                              className="settings-input"
                              value={deepseekModel}
                              onChange={(e) => setDeepseekModel(e.target.value)}
                              onBlur={saveDeepseekModel}
                              placeholder="deepseek-chat (e.g. deepseek-chat, deepseek-coder, deepseek-reasoner)"
                            />
                          </div>

                          <div className="settings-subfield" style={{ marginTop: '8px' }}>
                            <label className="settings-sublabel">DSH CLI Path / Command <span className="settings-optional">(optional)</span></label>
                            <input
                              className="settings-input"
                              value={dshPath}
                              onChange={(e) => setDshPath(e.target.value)}
                              onBlur={saveDshPath}
                              placeholder="dsh or npx @deepseek-ai/dsh (leave blank to use built-in engine)"
                            />
                            <p className="settings-subhint">Local DeepSeek Harness CLI command or executable.</p>
                          </div>

                          <div className="settings-subfield" style={{ marginTop: '8px' }}>
                            <label className="settings-sublabel">DSH Profile <span className="settings-optional">(optional)</span></label>
                            <input
                              className="settings-input"
                              value={dshProfile}
                              onChange={(e) => setDshProfile(e.target.value)}
                              onBlur={saveDshProfile}
                              placeholder="headless"
                            />
                          </div>
                        </div>
                      </>
                    ))}
                  </div>

                  <button
                    type="button"
                    className={`settings-test-btn ${testStatus}`}
                    onClick={testConnection}
                    disabled={testStatus === 'testing'}
                  >
                    {testStatus === 'idle'    && '🔌 Test Connection'}
                    {testStatus === 'testing' && '⏳ Testing…'}
                    {testStatus === 'ok'      && '✅ Connected'}
                    {testStatus === 'fail'    && '❌ Failed — check settings'}
                  </button>
                </div>
              )}

              {/* ── Profile ── */}
              {activeTab === 'personalization' && (
                <div className="settings-section">
                  <div className="settings-field">
                    <label className="settings-label">Your Name <span className="settings-optional">(optional)</span></label>
                    <input
                      className="settings-input"
                      value={userName}
                      onChange={(e) => setUserName(e.target.value)}
                      onBlur={saveUserName}
                      placeholder="e.g. Alex"
                    />
                  </div>
                  <div className="settings-field">
                    <label className="settings-label">Your Role <span className="settings-optional">(optional)</span></label>
                    <input
                      className="settings-input"
                      value={userRole}
                      onChange={(e) => setUserRole(e.target.value)}
                      onBlur={saveUserRole}
                      placeholder="e.g. Software engineer, Product manager…"
                    />
                    <p className="settings-hint">Helps the AI tailor responses to your background.</p>
                  </div>
                  <div className="settings-field">
                    <label className="settings-label">
                      Base Instructions <span className="settings-optional">(optional)</span>
                    </label>
                    <textarea
                      className="settings-textarea"
                      rows={8}
                      value={baseInstructions}
                      onChange={(e) => setBaseInstructions(e.target.value)}
                      onBlur={saveBaseInstructions}
                      placeholder={`e.g. Always respond concisely. Prefer TypeScript over JavaScript. When writing code, add comments for non-obvious logic.`}
                    />
                    <p className="settings-hint">These instructions are injected into every conversation as system context.</p>
                  </div>
                </div>
              )}

              {/* ── Behaviour ── */}
              {activeTab === 'behaviour' && (
                <div className="settings-section">
                  <div className="settings-info-card">
                    <strong>How the assistant behaves</strong>
                    <p>
                      These options control safety checks, how optional instructions are loaded,
                      and how usage costs are displayed. They do not change your saved chats.
                    </p>
                  </div>

                  <h3 className="settings-subsection-title">Safety</h3>
                  <div className="settings-field">
                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={requireApproval}
                        onChange={(e) => toggleApproval(e.target.checked)}
                      />
                      <span>Ask before making changes</span>
                    </label>
                    <p className="settings-hint">
                      When enabled, the assistant pauses before editing files, writing files, running
                      commands, or changing Git state. Turn this off only when you trust the request
                      and want coding actions to run without confirmation.
                    </p>
                  </div>

                  <h3 className="settings-subsection-title">Instructions</h3>
                  <div className="settings-field">
                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={skillsInline}
                        onChange={(e) => toggleSkillsInline(e.target.checked)}
                      />
                      <span>Always include full skill instructions</span>
                    </label>
                    <p className="settings-hint">
                      Off: the assistant sees skill names and loads the full instructions only when
                      relevant. On: every request includes every enabled skill, which can use more
                      context and cost more with metered models.
                    </p>
                  </div>

                  <h3 className="settings-subsection-title">Usage display</h3>
                  <div className="settings-field">
                    <label className="settings-label">
                      Model pricing <span className="settings-optional">(optional)</span>
                    </label>
                    <textarea
                      className="settings-textarea"
                      rows={6}
                      spellCheck={false}
                      value={modelPricing}
                      onChange={(e) => setModelPricing(e.target.value)}
                      onBlur={saveModelPricing}
                      placeholder={'{\n  "deepseek-v4-flash": { "input": 0.27, "output": 1.1 }\n}'}
                    />
                    {pricingError && <p className="settings-error">Not saved — {pricingError}</p>}
                    <p className="settings-hint">
                      Optional: enter USD per 1M tokens, keyed by model id without the provider
                      prefix. This only affects cost estimates in the interface; it never changes
                      the provider billing or request itself.
                    </p>
                  </div>
                </div>
              )}

              {/* ── Appearance ── */}
              {activeTab === 'appearance' && (
                <div className="settings-section">
                  <div className="settings-field">
                    <label className="settings-label">Interface Theme</label>
                    <p className="settings-hint">
                      Switch between Dark and Light mode across all workspaces and chats.
                    </p>
                    <div className="settings-theme-toggle-wrap">
                      <button
                        type="button"
                        className={`settings-theme-option ${isDarkMode ? 'is-selected' : ''}`}
                        onClick={() => {
                          if (!isDarkMode) toggleTheme();
                        }}
                      >
                        <div className="settings-theme-icon">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                          </svg>
                        </div>
                        <div className="settings-theme-info">
                          <span className="settings-theme-title">Dark Mode</span>
                          <span className="settings-theme-desc">Deep slate theme for low-light environments</span>
                        </div>
                        {isDarkMode && <span className="settings-scheme-active-tag">Active</span>}
                      </button>

                      <button
                        type="button"
                        className={`settings-theme-option ${!isDarkMode ? 'is-selected' : ''}`}
                        onClick={() => {
                          if (isDarkMode) toggleTheme();
                        }}
                      >
                        <div className="settings-theme-icon">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="5" />
                            <line x1="12" y1="1" x2="12" y2="3" />
                            <line x1="12" y1="21" x2="12" y2="23" />
                            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                            <line x1="1" y1="12" x2="3" y2="12" />
                            <line x1="21" y1="12" x2="23" y2="12" />
                            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                          </svg>
                        </div>
                        <div className="settings-theme-info">
                          <span className="settings-theme-title">Light Mode</span>
                          <span className="settings-theme-desc">Crisp, clean high-contrast appearance</span>
                        </div>
                        {!isDarkMode && <span className="settings-scheme-active-tag">Active</span>}
                      </button>
                    </div>
                  </div>

                  <div className="settings-field">
                    <label className="settings-label">Color Scheme</label>
                    <p className="settings-hint">
                      Choose your preferred accent color scheme. Applies across all buttons, highlights, accents, and UI elements.
                    </p>
                    <div className="settings-color-schemes-grid">
                      {COLOR_SCHEMES.map((s) => {
                        const isSelected = activeColorScheme === s.id;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            className={`settings-scheme-card ${isSelected ? 'is-selected' : ''}`}
                            onClick={() => applyColorScheme(s.id)}
                          >
                            <div className="settings-scheme-swatches">
                              {s.swatches.map((color, idx) => (
                                <span
                                  key={idx}
                                  className="settings-scheme-swatch"
                                  style={{ backgroundColor: color }}
                                />
                              ))}
                            </div>
                            <div className="settings-scheme-info">
                              <span className="settings-scheme-name">{s.label}</span>
                              {isSelected && <span className="settings-scheme-active-tag">Active</span>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Memories ── */}
              {activeTab === 'memories' && (
                <div className="settings-section">
                  <div className="settings-field">
                    <label className="settings-toggle">
                      <input type="checkbox" checked={memoryEnabled} onChange={(e) => toggleMemoryEnabled(e.target.checked)} />
                      <span>Use saved memories in chats</span>
                    </label>
                    <p className="settings-hint">
                      When enabled, relevant saved details may be added to new conversations. Turning
                      this off pauses recall and automatic saving; it does not delete existing memories.
                    </p>
                  </div>
                  <p className="settings-hint" style={{ marginBottom: 12 }}>
                    Saved details help the assistant give more relevant answers across chats. You can
                    add, inspect, or remove them here. Chats are not deleted when memories are removed.
                  </p>

                  <div className="memories-header">
                    <span className="memories-count">
                      {memories.length} {memories.length === 1 ? 'memory' : 'memories'} stored
                    </span>
                    <button
                      type="button"
                      className="settings-refresh-btn"
                      onClick={refreshMemories}
                      disabled={memoriesLoading}
                    >
                      {memoriesLoading ? '⏳ Refreshing…' : '🔄 Refresh'}
                    </button>
                    <div className="settings-button-row">
                      <button type="button" className="settings-secondary-btn" onClick={addMemory}>Add memory</button>
                      <button type="button" className="settings-secondary-btn" onClick={forgetAllMemories} disabled={memories.length === 0}>Forget all</button>
                    </div>
                  </div>

                  {memoriesError && <p className="settings-error">{memoriesError}</p>}

                  {memoriesLoading && memories.length === 0 ? (
                    <div className="memories-empty">
                      <span className="memories-empty-icon">🧩</span>
                      <p className="memories-empty-title">No memories yet</p>
                      <p className="memories-empty-hint">
                        Memories are created automatically as you chat. You can also manually add them via the API.
                      </p>
                    </div>
                  ) : (
                    <div className="memories-list">
                      {memories.map((m) => (
                        <div key={m.id} className="memories-item">
                          <div className="memories-item__meta">
                            <span className={`memories-type-badge memories-type--${m.type}`}>{m.type}</span>
                            <span className="memories-date">
                              {new Date(m.createdAt).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <p className="memories-item__content">{m.content.slice(0, 300)}{m.content.length > 300 ? '…' : ''}</p>
                          <button
                            type="button"
                            className="memories-delete-btn"
                            onClick={() => deleteMemory(m.id)}
                            disabled={memoriesDeleting === m.id}
                            title="Delete memory"
                          >
                            {memoriesDeleting === m.id ? '⏳' : '🗑️'}
                          </button>
                        </div>
                      ))}

                      {memories.length === 0 && !memoriesLoading && (
                        <div className="memories-empty">
                          <span className="memories-empty-icon">🧩</span>
                          <p className="memories-empty-title">No memories yet</p>
                          <p className="memories-empty-hint">
                            Memories are created automatically as you chat.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Training ── */}
              {activeTab === 'training' && (
                <div className="settings-section">
                  <p className="settings-hint">
                    Export your thumbs-up'd assistant messages as a dataset for LoRA fine-tuning.
                    Run <code>scripts/finetune/train_lora.py</code> on the file to produce a personal
                    model adapter that Ollama can load. See <code>scripts/finetune/README.md</code>
                    for the full pipeline.
                  </p>

                  {trainingLoading ? (
                    <p className="settings-hint">Loading…</p>
                  ) : trainingStats ? (
                    <div className="settings-training-stats">
                      <div className="settings-about-row">
                        <span className="settings-about-label">Explicit 👍 pairs</span>
                        <span className="settings-about-value"><strong>{trainingStats.pairs}</strong></span>
                      </div>
                      <div className="settings-about-row">
                        <span className="settings-about-label">Auto-positive (implicit)</span>
                        <span className="settings-about-value">{trainingStats.implicit ?? 0}</span>
                      </div>
                      <div className="settings-about-row">
                        <span className="settings-about-label">User-edited answers</span>
                        <span className="settings-about-value">{trainingStats.edited}</span>
                      </div>
                      <div className="settings-about-row">
                        <span className="settings-about-label">Distillation pairs available</span>
                        <span className="settings-about-value">{trainingStats.distillation ?? 0} from {trainingStats.topChats ?? 0} top chats</span>
                      </div>
                      {trainingStats.oldest && trainingStats.newest && (
                        <>
                          <div className="settings-about-row">
                            <span className="settings-about-label">Oldest pair</span>
                            <span className="settings-about-value">{new Date(trainingStats.oldest).toLocaleString()}</span>
                          </div>
                          <div className="settings-about-row">
                            <span className="settings-about-label">Newest pair</span>
                            <span className="settings-about-value">{new Date(trainingStats.newest).toLocaleString()}</span>
                          </div>
                        </>
                      )}

                      {trainingStats.pairs < 50 && trainingStats.pairs > 0 && (
                        <p className="settings-hint">
                          ⚠️ Only <strong>{trainingStats.pairs}</strong> pairs available.
                          Fine-tuning is most useful past ~200 examples. Keep using the app
                          and rating answers with 👍 to build the dataset.
                        </p>
                      )}
                      {trainingStats.pairs === 0 && (
                        <p className="settings-hint">
                          No positive-rated messages yet. Click 👍 on assistant replies you like
                          to populate the dataset.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="settings-hint">No stats available.</p>
                  )}

                  {trainingExamples.length > 0 && (
                    <div className="settings-training-review">
                      <div className="settings-training-review__header">
                        <div>
                          <strong>Review examples</strong>
                          <p className="settings-hint">Choose which thumbs-up answers to include. Edited answers use your correction.</p>
                        </div>
                        <button type="button" className="settings-secondary-btn" onClick={() => setSelectedTrainingIds(new Set(trainingExamples.map((example) => example.id)))}>Select all</button>
                      </div>
                      <div className="settings-training-examples">
                        {trainingExamples.map((example) => {
                          const selected = selectedTrainingIds.has(example.id);
                          return (
                            <label key={example.id} className={`settings-training-example ${selected ? 'is-selected' : ''}`}>
                              <input type="checkbox" checked={selected} onChange={() => setSelectedTrainingIds((current) => {
                                const next = new Set(current);
                                if (next.has(example.id)) next.delete(example.id); else next.add(example.id);
                                return next;
                              })} />
                              <span className="settings-training-example__body">
                                <span className="settings-training-example__meta">{example.chatTitle} · {example.edited ? 'Edited answer' : 'Thumbs-up'}</span>
                                <span className="settings-training-example__prompt">{example.userContent}</span>
                                <span className="settings-training-example__answer">{example.assistantContent}</span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      <p className="settings-hint">{selectedTrainingIds.size} of {trainingExamples.length} examples selected. Export includes chat text, so review for private information first.</p>
                    </div>
                  )}

                  <div className="settings-divider" />

                  <div className="settings-field">
                    <label className="settings-field-label" htmlFor="train-format">Export format</label>
                    <select
                      id="train-format"
                      className="settings-input"
                      value={exportFormat}
                      onChange={(e) => setExportFormat(e.target.value as 'sharegpt' | 'alpaca')}
                    >
                      <option value="sharegpt">ShareGPT — {`{messages: [...]}`} (recommended)</option>
                      <option value="alpaca">Alpaca — {`{instruction, input, output}`}</option>
                    </select>
                  </div>

                  <div className="settings-field">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={includeDistillation}
                        onChange={(e) => setIncludeDistillation(e.target.checked)}
                      />
                      <span className="settings-label">Include distillation pairs</span>
                    </label>
                    <p className="settings-hint">
                      Blends pairs from your highest-rated conversations (~30%) to reduce catastrophic forgetting.
                      {trainingStats && trainingStats.distillation > 0
                        ? ` ${trainingStats.distillation} pairs available from ${trainingStats.topChats} top chats.`
                        : ' Needs ≥2 rated messages per chat.'}
                    </p>
                  </div>

                  <div className="settings-button-row">
                    <button
                      type="button"
                      className="settings-primary-btn"
                      onClick={exportTrainingData}
                      disabled={trainingExporting || !trainingStats || selectedTrainingIds.size === 0}
                    >
                      {trainingExporting ? 'Exporting…' : 'Export dataset'}
                    </button>
                    <button
                      type="button"
                      className="settings-secondary-btn"
                      onClick={refreshTrainingStats}
                      disabled={trainingLoading}
                    >
                      Refresh
                    </button>
                  </div>

                  {trainingError && (
                    <p className="settings-error">{trainingError}</p>
                  )}

                  {trainingResult && (
                    <div className="settings-training-result">
                      <p className="settings-hint">
                        ✓ Wrote <strong>{trainingResult.pairs}</strong> pair{trainingResult.pairs === 1 ? '' : 's'}
                        {' '}({trainingResult.explicit} explicit{trainingResult.distilled > 0 ? ` + ${trainingResult.distilled} distilled` : ''}, {trainingResult.format}) to:
                      </p>
                      <code className="settings-code-block">{trainingResult.path}</code>
                      <p className="settings-hint">
                        Next: run <code>python scripts/finetune/train_lora.py --data &quot;{trainingResult.path}&quot; --base &lt;model&gt; --out data/adapters/v1</code>
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* ── About / Danger Zone ── */}
              {activeTab === 'about' && (
                <div className="settings-section">
                  <div className="settings-about-row">
                    <span className="settings-about-label">App</span>
                    <span className="settings-about-value">VanailaChat</span>
                  </div>
                  <div className="settings-about-row">
                    <span className="settings-about-label">Backend</span>
                    <span className="settings-about-value">Hono + SQLite</span>
                  </div>
                  <div className="settings-about-row">
                    <span className="settings-about-label">LLM Runtime</span>
                    <span className="settings-about-value">Ollama / OpenAI-compatible</span>
                  </div>

                  <div className="settings-divider" />

                  <div className="settings-danger-zone">
                    <p className="settings-danger-title">⚠️ Danger Zone</p>
                    <p className="settings-hint">Re-running setup will clear your current configuration and restart the onboarding wizard.</p>
                    <button
                      type="button"
                      className="settings-danger-btn"
                      onClick={rerunSetup}
                    >
                      Re-run Setup Wizard
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
