import type { LLMProvider } from './provider.js';

/**
 * Manages multiple LLM providers.
 * Routes chat requests to the correct provider based on prefix or config.
 */
export class ProviderRegistry {
  private providers = new Map<string, LLMProvider>();
  private defaultProviderId: string | null = null;

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
    }
    return this.get();
  }

  /**
   * Resolve provider AND strip known prefix from model name.
   * Only strips when the prefix matches a registered provider ID.
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
    }
    return { provider: this.get(), modelName: model };
  }

  /** Strip provider prefix from model name (e.g. "openai:gpt-4o" → "gpt-4o") */
  static stripPrefix(model: string): string {
    const colonIndex = model.indexOf(':');
    return colonIndex > 0 ? model.slice(colonIndex + 1) : model;
  }

  list(): LLMProvider[] {
    return [...this.providers.values()];
  }

  /** Gather models from all providers with provider name prefix */
  async listAllModels(): Promise<Array<{ name: string; provider: string; metadata?: unknown }>> {
    const results: Array<{ name: string; provider: string; metadata?: unknown }> = [];
    for (const [id, provider] of this.providers) {
      if (id === 'ollama') continue; // Ollama handled separately via getInstalledModelMetadata
      try {
        const models = await provider.listModels();
        for (const model of models) {
          results.push({ name: `openai:${model}`, provider: id, metadata: {} });
        }
      } catch {
        // Provider unavailable — skip
      }
    }
    return results;
  }

  getDefaultId(): string | null {
    return this.defaultProviderId;
  }
}

/** Singleton registry */
export const providerRegistry = new ProviderRegistry();
