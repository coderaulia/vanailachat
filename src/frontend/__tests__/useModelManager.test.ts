// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useModelManager } from '../hooks/useModelManager';

const fetchMock = vi.fn<typeof fetch>();
global.fetch = fetchMock;

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('useModelManager hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    fetchMock.mockResolvedValue(jsonResponse({ models: [], metadata: {} }));
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
    fetchMock.mockResolvedValue(jsonResponse({ models: ['llama3', 'codellama'] }));

    const { result } = renderHook(() => useModelManager('', false));
    
    // Initial state
    expect(result.current.availableModels).toEqual([]);

    await waitFor(() => {
      expect(result.current.availableModels).toEqual(['llama3', 'codellama']);
    });
  });

  it('stores metadata from the models response', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        models: ['llama3'],
        metadata: {
          llama3: {
            family: 'llama',
            parameterSize: '8B',
            quantizationLevel: 'Q4_K_M',
            capabilities: ['completion', 'tools'],
          },
        },
      })
    );

    const { result } = renderHook(() => useModelManager('', false));

    await waitFor(() => {
      expect(result.current.availableModels).toEqual(['llama3']);
    });
    expect(result.current.modelMetadata.llama3).toMatchObject({
      family: 'llama',
      parameterSize: '8B',
      quantizationLevel: 'Q4_K_M',
      capabilities: ['completion', 'tools'],
    });
  });
});
