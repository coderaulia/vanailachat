import { describe, expect, it } from 'vitest';
import { estimateCost, formatCost, getTokenRate, isLocalModel, normalizeModelId, setPricingOverrides } from '../config/modelPricing';

describe('getTokenRate', () => {
  it('matches ids that arrive decorated with prefixes or dates', () => {
    expect(getTokenRate('openai/gpt-4o')).toEqual({ input: 2.5, output: 10 });
    expect(getTokenRate('gpt-4o-2024-11-20')).toEqual({ input: 2.5, output: 10 });
  });

  it('prefers the longest matching pattern', () => {
    // "gpt-4o-mini" must not be priced as "gpt-4o".
    expect(getTokenRate('gpt-4o-mini')).toEqual({ input: 0.15, output: 0.6 });
    expect(getTokenRate('claude-3-5-haiku-20241022')).toEqual({ input: 0.8, output: 4 });
  });

  it('returns null for local and unknown models', () => {
    expect(getTokenRate('llama3:8b')).toBeNull();
    expect(getTokenRate('qwen2.5-coder')).toBeNull();
    expect(getTokenRate('some-model-nobody-has-heard-of')).toBeNull();
    expect(getTokenRate(null)).toBeNull();
  });
});

describe('isLocalModel', () => {
  it('recognises models served from the user machine', () => {
    expect(isLocalModel('llama3:8b')).toBe(true);
    expect(isLocalModel('mistral-nemo')).toBe(true);
    expect(isLocalModel('deepseek-chat')).toBe(false);
  });
});

describe('estimateCost', () => {
  it('prices input and output separately', () => {
    // 1M in at $0.27 + 1M out at $1.10
    expect(estimateCost('deepseek-chat', 1_000_000, 1_000_000)).toBeCloseTo(1.37, 5);
  });

  it('scales down to realistic single-turn sizes', () => {
    const cost = estimateCost('deepseek-chat', 9_200, 300);
    expect(cost).toBeCloseTo(0.0024840 + 0.00033, 6);
  });

  it('treats missing counts as zero rather than failing', () => {
    expect(estimateCost('deepseek-chat', null, undefined)).toBe(0);
  });

  it('returns null when the model has no known rate', () => {
    expect(estimateCost('llama3:8b', 5000, 500)).toBeNull();
  });
});

describe('formatCost', () => {
  it('keeps sub-cent amounts visible instead of rounding to $0.00', () => {
    expect(formatCost(0.0028)).toBe('$0.0028');
    expect(formatCost(0.42)).toBe('$0.420');
    expect(formatCost(12.5)).toBe('$12.50');
    expect(formatCost(0)).toBe('$0');
  });
});

describe('provider-prefixed ids', () => {
  it('strips the provider prefix before matching', () => {
    expect(normalizeModelId('custom:deepseek-chat')).toBe('deepseek-chat');
    expect(getTokenRate('custom:deepseek-chat')).toEqual({ input: 0.27, output: 1.1 });
  });

  it('keeps Ollama tags intact', () => {
    // "llama3:8b" is a tag, not a provider prefix.
    expect(normalizeModelId('llama3:8b')).toBe('llama3:8b');
    expect(getTokenRate('llama3:8b')).toBeNull();
  });
});

describe('pricing overrides', () => {
  it('prices a gateway model the built-in table has never heard of', () => {
    expect(getTokenRate('custom:deepseek-v4-flash')).toBeNull();

    setPricingOverrides({ 'deepseek-v4-flash': { input: 0.3, output: 1.2 } });

    expect(getTokenRate('custom:deepseek-v4-flash')).toEqual({ input: 0.3, output: 1.2 });
    expect(estimateCost('custom:deepseek-v4-flash', 1_000_000, 0)).toBeCloseTo(0.3, 5);

    setPricingOverrides({});
  });

  it('ignores malformed override entries', () => {
    setPricingOverrides({ 'x-model': { input: 'free', output: 2 }, 'y-model': null });
    expect(getTokenRate('x-model')).toBeNull();
    setPricingOverrides({});
  });
});
