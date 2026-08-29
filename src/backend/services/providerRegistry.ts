import type { LLMProvider } from './provider.js';
import { CustomOpenAIProvider } from './customOpenAIProvider.js';

/**
 * How long provider model listings and metadata stay fresh. These are remote
 * HTTP calls for every provider except Ollama, and they sat on the chat hot
 * path — each turn paid a full model-list fetch plus a details fetch before
 * the completion could even start.
 */
const MODEL_CACHE_TTL_MS = 60_000;

interface CacheEntry<T> { value: T; expiresAt: number }

/**
 * Manages multiple LLM providers.
 * Routes chat requests to the correct provider based on prefix or config.
 *
 * Caches are per-instance: the registry is rebuilt by each createApp() call,
 * so tests never share cached state.
 */
export class ProviderRegistry {
  private providers = new Map<string, LLMProvider>();
  private defaultProviderId: string | null = null;

  private modelListCache = new Map<string, CacheEntry<string[]>>();
  private modelDetailsCache = new Map<string, CacheEntry<Record<string, unknown> | null>>();

  private static fresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
    return entry !== undefined && entry.expiresAt > Date.now();
  }

  /** Model list for one provider, cached so repeated turns don't refetch it. */
  async listModelsCached(provider: LLMProvider): Promise<string[]> {
    const hit = this.modelListCache.get(provider.id);
    if (ProviderRegistry.fresh(hit)) return hit.value;

    const models = await provider.listModels();
    this.modelListCache.set(provider.id, {
      value: models,
      expiresAt: Date.now() + MODEL_CACHE_TTL_MS,
    });
    return models;
  }

  /**
   * Availability check served from the cached listing. Ollama is asked
   * directly — it is a local call, and its provider tracks pulled models.
   */
  async isModelAvailableCached(provider: LLMProvider, modelName: string): Promise<boolean> {
    if (provider.id === 'ollama') return provider.isModelAvailable(modelName);
    const models = await this.listModelsCached(provider);
    return models.includes(modelName);
  }

  /** Model metadata (capabilities drive tool gating), cached per model. */
  async getModelDetailsCached(
    provider: LLMProvider,
    modelName: string,
  ): Promise<Record<string, unknown> | null> {
    const key = `${provider.id}:${modelName}`;
    const hit = this.modelDetailsCache.get(key);
    if (ProviderRegistry.fresh(hit)) return hit.value;

    const details = await provider.getModelDetails(modelName);
    this.modelDetailsCache.set(key, {
      value: details,
      expiresAt: Date.now() + MODEL_CACHE_TTL_MS,
    });
    return details;
  }

  /** Drops cached listings/metadata so a newly configured provider is seen. */
  invalidateModelCaches(): void {
    this.modelListCache.clear();
    this.modelDetailsCache.clear();
  }

  register(provider: LLMProvider): void {
    this.providers.set(provider.id, provider);
    if (!this.defaultProviderId) {
      this.defaultProviderId = provider.id;
    }
  }

  setDefault(providerId: string): void {
    if (!this.providers.has(providerId)) {
      throw new Error(`Unknown provider: ${providerId}`);
    }
    this.defaultProviderId = providerId;
  }

  get(providerId?: string): LLMProvider {
    // Explicit provider
    if (providerId && this.providers.has(providerId)) {
      return this.providers.get(providerId)!;
    }
    if (providerId && (providerId === 'custom' || providerId.startsWith('custom'))) {
      const allCustom = CustomOpenAIProvider.getAllProviders();
      const matched = allCustom.find((p) => p.id === providerId);
      if (matched) return matched;
      if (this.providers.has('custom')) return this.providers.get('custom')!;
    }
    // Default
    if (this.defaultProviderId) {
      return this.providers.get(this.defaultProviderId)!;
    }
    // Fallback to first registered
    const first = this.providers.values().next();
    if (first.done) throw new Error('No providers registered');
    return first.value;
  }

  /** Resolve provider from model name prefix (e.g. "openai:gpt-4o" → openai provider).
   *  Only strips known provider prefixes; leaves Ollama tags (like "qwen3.5:latest") intact. */
  getByModel(model: string): LLMProvider {
    const colonIndex = model.indexOf(':');
    if (colonIndex > 0) {
      const prefix = model.slice(0, colonIndex);
      const provider = this.providers.get(prefix);
      if (provider) return provider;
      if (prefix === 'custom' || prefix.startsWith('custom')) {
        const allCustom = CustomOpenAIProvider.getAllProviders();
        const matched = allCustom.find((p) => p.id === prefix);
        if (matched) return matched;
        if (this.providers.has('custom')) return this.providers.get('custom')!;
      }
    }
    return this.get();
  }

  /**
   * Resolve provider AND strip known prefix from model name.
   * Only strips when the prefix matches a registered provider ID or custom provider.
   * Handles Ollama tag colons correctly (e.g. "qwen3.5:latest" stays as-is).
   */
  resolveModel(model: string): { provider: LLMProvider; modelName: string } {
    const colonIndex = model.indexOf(':');
    if (colonIndex > 0) {
      const prefix = model.slice(0, colonIndex);
      const provider = this.providers.get(prefix);
      if (provider) {
        return { provider, modelName: model.slice(colonIndex + 1) };
      }
      if (prefix === 'custom' || prefix.startsWith('custom')) {
        const allCustom = CustomOpenAIProvider.getAllProviders();
        const matched = allCustom.find((p) => p.id === prefix);
        if (matched) {
          return { provider: matched, modelName: model.slice(colonIndex + 1) };
        }
        if (this.providers.has('custom')) {
          return { provider: this.providers.get('custom')!, modelName: model.slice(colonIndex + 1) };
        }
      }
    }
    return { provider: this.get(), modelName: model };
  }

  /** Strip provider prefix from model name (e.g. "openai:gpt-4o" → "gpt-4o") */
  static stripPrefix(model: string): string {
    const colonIndex = model.indexOf(':');
    return colonIndex > 0 ? model.slice(colonIndex + 1) : model;
  }

  list(): LLMProvider[] {
    const registered = [...this.providers.values()];
    const customProvider = this.providers.get('custom');
    if (customProvider instanceof CustomOpenAIProvider) {
      const customProviders = CustomOpenAIProvider.getAllProviders();
      const map = new Map<string, LLMProvider>();
      for (const p of registered) {
        if (p.id !== 'custom') map.set(p.id, p);
      }
      for (const cp of customProviders) {
        map.set(cp.id, cp);
      }
      return [...map.values()];
    }
    return registered;
  }

  /**
   * Gather models from all providers with provider name prefix.
   * Providers are queried concurrently — serially awaiting each one made this
   * endpoint cost the sum of every provider's latency.
   */
  async listAllModels(): Promise<Array<{ name: string; provider: string; metadata?: Record<string, unknown> }>> {
    const hasCustom = this.providers.has('custom');
    const nonCustomEntries = [...this.providers].filter(([id]) => id !== 'ollama' && id !== 'custom');
    
    let entries: Array<[string, LLMProvider]> = nonCustomEntries;
    if (hasCustom) {
      const customProvider = this.providers.get('custom')!;
      if (customProvider instanceof CustomOpenAIProvider) {
        const customProviders = CustomOpenAIProvider.getAllProviders();
        entries = [...entries, ...customProviders.map((cp): [string, LLMProvider] => [cp.id, cp])];
      } else {
        entries = [...entries, ['custom', customProvider]];
      }
    }

    const settled = await Promise.allSettled(
      entries.map(async ([, provider]) => {
        if (typeof provider.getInstalledModelMetadata === 'function') {
          return await provider.getInstalledModelMetadata();
        }
        const modelNames = await this.listModelsCached(provider);
        return modelNames.map((name) => ({
          name,
          model: name,
          contextWindow: null,
          capabilities: ['chat'],
        }));
      }),
    );

    return settled.flatMap((outcome, index) => {
      // Provider unavailable — skip
      if (outcome.status !== 'fulfilled') return [];
      const id = entries[index][0];
      return outcome.value.map((meta) => {
        const rawName = meta.name;
        const prefixedName = `${id}:${rawName}`;
        return {
          name: prefixedName,
          provider: id,
          metadata: {
            ...meta,
            name: prefixedName,
            model: prefixedName,
          },
        };
      });
    });
  }

  getDefaultId(): string | null {
    return this.defaultProviderId;
  }
}

/** Singleton registry */
export const providerRegistry = new ProviderRegistry();
