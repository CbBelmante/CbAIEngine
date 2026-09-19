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
  expect(getSyncStatusDef('pending')?.value, 'pending');
  expect(getSyncStatusDef('processing')?.value, 'processing');
  expect(getSyncStatusDef('synced')?.value, 'synced');
  expect(getSyncStatusDef('failed')?.value, 'failed');
});

it('getSyncStatusDef - valor inválido', () => {
  // @ts-expect-error: teste de valor inválido
  expect(getSyncStatusDef('invalid'), undefined);
});

it('getContentFormatDef - valores válidos', () => {
  expect(getContentFormatDef('markdown')?.value, 'markdown');
  expect(getContentFormatDef('text')?.value, 'text');
});

it('getVisibilityDef - valores válidos', () => {
  expect(getVisibilityDef('internal')?.value, 'internal');
  expect(getVisibilityDef('portal')?.value, 'portal');
});

it('isSyncFinal - estados finais', () => {
  expect(isSyncFinal('synced'), true);
  expect(isSyncFinal('failed'), true);
  expect(isSyncFinal('pending'), false);
  expect(isSyncFinal('processing'), false);
});

it('isSynced', () => {
  expect(isSynced('synced'), true);
  expect(isSynced('pending'), false);
  expect(isSynced('processing'), false);
  expect(isSynced('failed'), false);
});

it('isSyncFailed', () => {
  expect(isSyncFailed('failed'), true);
  expect(isSyncFailed('synced'), false);
  expect(isSyncFailed('pending'), false);
  expect(isSyncFailed('processing'), false);
});

it('isSyncInProgress', () => {
  expect(isSyncInProgress('pending'), true);
  expect(isSyncInProgress('processing'), true);
  expect(isSyncInProgress('synced'), false);
  expect(isSyncInProgress('failed'), false);
});

it('isVisibleToPortal', () => {
  expect(isVisibleToPortal('portal'), true);
  expect(isVisibleToPortal('internal'), false);
});

it('isInternalOnly', () => {
  expect(isInternalOnly('internal'), true);
  expect(isInternalOnly('portal'), false);
});

it('KNOWLEDGE_DEFAULTS - valores esperados', () => {
  expect(KNOWLEDGE_DEFAULTS.content_format, 'markdown');
  expect(KNOWLEDGE_DEFAULTS.sync_status, 'pending');
  expect(KNOWLEDGE_DEFAULTS.priority, 0);
  expect(KNOWLEDGE_DEFAULTS.is_system, false);
  expect(KNOWLEDGE_DEFAULTS.visibility, 'internal');
});
