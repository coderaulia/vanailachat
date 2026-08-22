import { describe, expect, it } from 'vitest';
import {
  getContextWindowForModel,
  formatTokensCompact,
  getModelInfo,
} from '../config/modelMetadata';

describe('modelMetadata dynamic context resolution', () => {
  it('prefers metadata.contextWindow when available', () => {
    expect(
      getContextWindowForModel('some-custom-model', { contextWindow: 65536 }),
    ).toBe(65536);

    expect(
      getContextWindowForModel('openrouter:0x-alpha/model', { contextWindow: 1_000_000 }),
    ).toBe(1_000_000);
  });

  it('detects 1M context models by pattern', () => {
    expect(getContextWindowForModel('openrouter:ox-alpha')).toBe(1_000_000);
    expect(getContextWindowForModel('0x_alpha')).toBe(1_000_000);
    expect(getContextWindowForModel('gemini-2.0-flash')).toBe(1_000_000);
  });

  it('detects 200k context models by pattern', () => {
    expect(getContextWindowForModel('anthropic/claude-3.5-sonnet')).toBe(200_000);
    expect(getContextWindowForModel('claude-3-7-sonnet')).toBe(200_000);
    expect(getContextWindowForModel('o1')).toBe(200_000);
    expect(getContextWindowForModel('o3-mini')).toBe(200_000);
  });

  it('detects 128k context models by pattern', () => {
    expect(getContextWindowForModel('gpt-4o')).toBe(128_000);
    expect(getContextWindowForModel('deepseek-chat')).toBe(128_000);
  });

  it('detects 8k and 131k Ollama models by pattern', () => {
    expect(getContextWindowForModel('llama3')).toBe(8_192);
    expect(getContextWindowForModel('llama3.2')).toBe(131_072);
  });

  it('formats token numbers compactly', () => {
    expect(formatTokensCompact(1_000_000)).toBe('1M');
    expect(formatTokensCompact(1_500_000)).toBe('1.5M');
    expect(formatTokensCompact(200_000)).toBe('200K');
    expect(formatTokensCompact(128_000)).toBe('128K');
    expect(formatTokensCompact(32_768)).toBe('32,768');
    expect(formatTokensCompact(8_192)).toBe('8,192');
  });

  it('displays contextWindow in getModelInfo description if present', () => {
    const info = getModelInfo('ox-alpha', { contextWindow: 1_000_000 }, 'openrouter');
    expect(info.description).toContain('1,000,000 context');
  });
});
