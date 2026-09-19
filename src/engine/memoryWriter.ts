/**
 * 🔧 memoryWriter — A porta ESTREITA por onde `save_memory` escreve
 *
 * A RLS de `ai_knowledge_entries` só deixa escrever quem tem `ai:update`
 * ( — um usuário comum não tem. A migration já previu o desvio: existe a
 * policy `ai_knowledge_entries_service_role`, e o comentário do seed diz
 * "escrita pela tool save_memory via service_role" (.
 *
 * 🔴 Só que entregar um client service_role ao contexto das tools daria a
 * TODAS as 17 um bypass de RLS. Este arquivo é o contrário disso: uma função,
 * não um client. Ela escreve numa tabela, numa categoria, com `visibility` e
 * `company_id` decididos pela SESSÃO. A tool não alcança mais nada.
 */

import {
  AGENT_MEMORIES_SLUG,
  KNOWLEDGE_SYNC_STATUS,
  KNOWLEDGE_VISIBILITY,
} from '../definitions/knowledgeConfig';
import { redactText } from '../middleware/piiRedaction';
import type { EmbedDispatcher } from '../runtime/embedDispatch';
import type { IAiDbAdapter } from '../dbAdapter/dbAdapter';

// ============== CONSTANTS ==============

export const MEMORY_CATEGORY_MISSING =
  `reserved category "${AGENT_MEMORIES_SLUG}" not found`;

/**
 * Cliente do portal sem empresa no turno não grava. Uma memória `portal` com
 * `company_id` nulo é global — todo cliente de toda empresa passaria a lê-la.
 */
export const MEMORY_PORTAL_REQUIRES_COMPANY =
  'portal sessions can only save memories scoped to a company';

// ============== TYPES ==============

export interface ISaveMemoryParams {
  title: string;
  content: string;
}

export interface ISaveMemoryResult {
  id?: string;
  error?: string;
}

export interface IMemoryWriter {
  save(params: ISaveMemoryParams): Promise<ISaveMemoryResult>;
}

export interface ICreateMemoryWriterParams {
  dbAdapter: IAiDbAdapter;
  isInternal: boolean;
  companyId: string | null;
  userId: string;
  dispatchEmbedding: EmbedDispatcher;
}

// ============== WRITER ==============

/**
 * ⚠️ SIDE-EFFECT: grava em `ai_knowledge_entries` e EMPURRA a fila sem esperar.
 *
 * A entrada nasce `pending` e o disparo não é aguardado — é o que garante que
 * salvar responda no tempo de um insert, e nunca no tempo do modelo.
 */
export function createMemoryWriter(
  { dbAdapter, isInternal, companyId, userId, dispatchEmbedding }: ICreateMemoryWriterParams,
): IMemoryWriter {
  const visibility = isInternal ? KNOWLEDGE_VISIBILITY.INTERNAL : KNOWLEDGE_VISIBILITY.PORTAL;

  return {
    async save(params: ISaveMemoryParams): Promise<ISaveMemoryResult> {
      if (!isInternal && !companyId) { return { error: MEMORY_PORTAL_REQUIRES_COMPANY }; }

      const title = redactText(params.title).text;
      const content = redactText(params.content).text;

      const category = await dbAdapter.getKnowledgeCategoryBySlug(AGENT_MEMORIES_SLUG);
      if (!category?.id) { return { error: MEMORY_CATEGORY_MISSING }; }

      try {
        const created = await dbAdapter.insertKnowledgeEntry({
          categoryId: category.id,
          title,
          content,
          visibility,
          companyId,
          syncStatus: KNOWLEDGE_SYNC_STATUS.PENDING,
          createdBy: userId,
        });

        if (!created) { return { error: 'insert failed' }; }

        dispatchEmbedding([created.id]);
        return { id: created.id };
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'insert failed' };
      }
    },
  };
}
