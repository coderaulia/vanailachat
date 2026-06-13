import { describe, expect, it } from 'vitest';
import { EmbeddingService } from '../services/embedding';

describe('EmbeddingService.cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = new Float32Array([1, 2, 3]);
    expect(EmbeddingService.cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    expect(EmbeddingService.cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it('returns -1 for opposite vectors', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([-1, -2, -3]);
    expect(EmbeddingService.cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });

  it('returns 0 when one vector is all zeros (no division by zero)', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    expect(EmbeddingService.cosineSimilarity(a, b)).toBe(0);
  });

  it('handles vectors of different lengths by using the shorter length', () => {
    const a = new Float32Array([1, 2, 3, 999]);
    const b = new Float32Array([1, 2, 3]);
    expect(EmbeddingService.cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  it('produces values in [-1, 1] for random-ish vectors', () => {
    const a = new Float32Array([0.5, 0.8, -0.3, 0.1]);
    const b = new Float32Array([0.2, 0.6, 0.4, -0.5]);
    const score = EmbeddingService.cosineSimilarity(a, b);
    expect(score).toBeGreaterThanOrEqual(-1);
    expect(score).toBeLessThanOrEqual(1);
  });
});
