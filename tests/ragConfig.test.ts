import { describe, it, expect } from 'vitest';
/**
 * Testes — ragConfig helpers
 */

import { expect } from 'vitest';
import {
  RAG_DEFAULTS,
  resolveTopK,
  resolveSimilarityThreshold,
  resolvePriorityWeight,
} from '../src/definitions/ragConfig';

it('RAG_DEFAULTS - valores esperados', () => {
  expect(RAG_DEFAULTS.top_k, 5);
  expect(RAG_DEFAULTS.similarity_threshold).toBe(0.7);
  expect(RAG_DEFAULTS.priority_weight).toBe(0.2);
});

it('resolveTopK - ordem de precedência', () => {
  // Explícito vence
  expect(resolveTopK(10, 7)).toBe(10);

  // Config vence default
  expect(resolveTopK(undefined, 7)).toBe(7);
  expect(resolveTopK(null, 7)).toBe(7);

  // Default quando nada especificado
  expect(resolveTopK(undefined, undefined)).toBe(5);
  expect(resolveTopK(null, null)).toBe(5);
});

it('resolveSimilarityThreshold - ordem de precedência', () => {
  // Explícito vence
  expect(resolveSimilarityThreshold(0.85, 0.6)).toBe(0.85);

  // Config vence default
  expect(resolveSimilarityThreshold(undefined, 0.6)).toBe(0.6);
  expect(resolveSimilarityThreshold(null, 0.6)).toBe(0.6);

  // Default quando nada especificado
  expect(resolveSimilarityThreshold(undefined, undefined)).toBe(0.7);
  expect(resolveSimilarityThreshold(null, null)).toBe(0.7);
});

it('resolvePriorityWeight - ordem de precedência', () => {
  // Explícito vence
  expect(resolvePriorityWeight(0.5, 0.3)).toBe(0.5);

  // Config vence default
  expect(resolvePriorityWeight(undefined, 0.3)).toBe(0.3);
  expect(resolvePriorityWeight(null, 0.3)).toBe(0.3);

  // Default quando nada especificado
  expect(resolvePriorityWeight(undefined, undefined)).toBe(0.2);
  expect(resolvePriorityWeight(null, null)).toBe(0.2);
});
