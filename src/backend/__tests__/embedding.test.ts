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

describe('EmbeddingService.applyScoreWeights', () => {
  const now = 1_700_000_000_000;
  const day = 24 * 60 * 60 * 1000;

  it('returns raw score when entry is brand new and unrated', () => {
    const score = EmbeddingService.applyScoreWeights(0.8, now, 0, now);
    expect(score).toBeCloseTo(0.8, 5);
  });

  it('halves score after one half-life (30 days)', () => {
    const score = EmbeddingService.applyScoreWeights(0.8, now - 30 * day, 0, now);
    expect(score).toBeCloseTo(0.4, 5);
  });

  it('quarters score after two half-lives (60 days)', () => {
    const score = EmbeddingService.applyScoreWeights(0.8, now - 60 * day, 0, now);
    expect(score).toBeCloseTo(0.2, 5);
  });

  it('boosts +1 rated entries by ~15%', () => {
    const base = EmbeddingService.applyScoreWeights(0.5, now, 0, now);
    const boosted = EmbeddingService.applyScoreWeights(0.5, now, 1, now);
    expect(boosted).toBeGreaterThan(base);
    expect(boosted / base).toBeCloseTo(1.15, 2);
  });

  it('penalizes -1 rated entries by 50%', () => {
    const base = EmbeddingService.applyScoreWeights(0.5, now, 0, now);
    const penalized = EmbeddingService.applyScoreWeights(0.5, now, -1, now);
    expect(penalized).toBeLessThan(base);
    expect(penalized / base).toBeCloseTo(0.5, 5);
  });

  it('clamps negative ages to zero (clock skew is harmless)', () => {
    const score = EmbeddingService.applyScoreWeights(0.5, now + 10 * day, 0, now);
    expect(score).toBeCloseTo(0.5, 5);
  });
});
