// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useModelManager } from '../hooks/useModelManager';

// Mock fetch
global.fetch = vi.fn();

describe('useModelManager hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] }),
    });
  });

  it('detects coding task from prompt', () => {
    const { result } = renderHook(() => useModelManager('write a python script', false));
    expect(result.current.shouldShowRoleSuggestion).toBe(true);
    expect(result.current.suggestedRoleLabel).toBe('Coding');
  });

  it('detects creative task from prompt', () => {
    const { result } = renderHook(() => useModelManager('draw a cat', false));
    expect(result.current.shouldShowRoleSuggestion).toBe(true);
    expect(result.current.suggestedRoleLabel).toBe('Creative');
  });

  it('detects vision task from attachment', () => {
    const { result } = renderHook(() => useModelManager('what is in this?', true));
    expect(result.current.shouldShowRoleSuggestion).toBe(true);
    expect(result.current.suggestedRoleLabel).toBe('Vision');
  });

  it('fetches models on mount', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ models: ['llama3', 'codellama'] }),
    });

    const { result } = renderHook(() => useModelManager('', false));
    
    // Initial state
    expect(result.current.availableModels).toEqual([]);

    // Wait for fetch
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(result.current.availableModels).toEqual(['llama3', 'codellama']);
  });
});
