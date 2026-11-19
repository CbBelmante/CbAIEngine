import { describe, it, expect } from 'vitest';
/**
 * Testes — knowledgeVocabulary helpers
 */

import { expect } from 'vitest';
import {
  getSyncStatusDef,
  getContentFormatDef,
  getVisibilityDef,
  isSyncFinal,
  isSynced,
  isSyncFailed,
  isSyncInProgress,
  isVisibleToPortal,
  isInternalOnly,
  KNOWLEDGE_DEFAULTS,
} from '../src/definitions/knowledgeVocabulary';

it('getSyncStatusDef - valores válidos', () => {
  expect(getSyncStatusDef('pending')?.value).toBe('pending');
  expect(getSyncStatusDef('processing')?.value).toBe('processing');
  expect(getSyncStatusDef('synced')?.value).toBe('synced');
  expect(getSyncStatusDef('failed')?.value).toBe('failed');
});

it('getSyncStatusDef - valor inválido', () => {
  // @ts-expect-error: teste de valor inválido
  expect(getSyncStatusDef('invalid')).toBeUndefined();
});

it('getContentFormatDef - valores válidos', () => {
  expect(getContentFormatDef('markdown')?.value).toBe('markdown');
  expect(getContentFormatDef('text')?.value).toBe('text');
});

it('getVisibilityDef - valores válidos', () => {
  expect(getVisibilityDef('internal')?.value).toBe('internal');
  expect(getVisibilityDef('portal')?.value).toBe('portal');
});

it('isSyncFinal - estados finais', () => {
  expect(isSyncFinal('synced')).toBe(true);
  expect(isSyncFinal('failed')).toBe(true);
  expect(isSyncFinal('pending')).toBe(false);
  expect(isSyncFinal('processing')).toBe(false);
});

it('isSynced', () => {
  expect(isSynced('synced')).toBe(true);
  expect(isSynced('pending')).toBe(false);
  expect(isSynced('processing')).toBe(false);
  expect(isSynced('failed')).toBe(false);
});

it('isSyncFailed', () => {
  expect(isSyncFailed('failed')).toBe(true);
  expect(isSyncFailed('synced')).toBe(false);
  expect(isSyncFailed('pending')).toBe(false);
  expect(isSyncFailed('processing')).toBe(false);
});

it('isSyncInProgress', () => {
  expect(isSyncInProgress('pending')).toBe(true);
  expect(isSyncInProgress('processing')).toBe(true);
  expect(isSyncInProgress('synced')).toBe(false);
  expect(isSyncInProgress('failed')).toBe(false);
});

it('isVisibleToPortal', () => {
  expect(isVisibleToPortal('portal')).toBe(true);
  expect(isVisibleToPortal('internal')).toBe(false);
});

it('isInternalOnly', () => {
  expect(isInternalOnly('internal')).toBe(true);
  expect(isInternalOnly('portal')).toBe(false);
});

it('KNOWLEDGE_DEFAULTS - valores esperados', () => {
  expect(KNOWLEDGE_DEFAULTS.content_format).toBe('markdown');
  expect(KNOWLEDGE_DEFAULTS.sync_status).toBe('pending');
  expect(KNOWLEDGE_DEFAULTS.priority).toBe(0);
  expect(KNOWLEDGE_DEFAULTS.is_system).toBe(false);
  expect(KNOWLEDGE_DEFAULTS.visibility).toBe('internal');
});
