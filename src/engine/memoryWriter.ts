/**
 * 🔧 memoryWriter — A porta ESTREITA por onde `save_memory` escreve
 *
 * A RLS de `ai_knowledge_entries` só deixa escrever quem tem `ai:update`
 * (021:317) — um CS comum não tem. A migration já previu o desvio: existe a
 * policy `ai_knowledge_entries_service_role`, e o comentário do seed diz
 * "escrita pela tool save_memory via service_role" (021:257).
 *
 * 🔴 Só que entregar um client service_role ao contexto das tools daria a
 * TODAS as 17 um bypass de RLS. Este arquivo é o contrário disso: uma função,
 * não um client. Ela escreve numa tabela, numa categoria, com `visibility` e
 * `company_id` decididos pela SESSÃO. A tool não alcança mais nada.
 */

import {
  AGENT_MEMORIES_SLUG,
  KNOWLEDGE_CATEGORIES_TABLE,
  KNOWLEDGE_ENTRIES_TABLE,
  KNOWLEDGE_SYNC_STATUS,
  KNOWLEDGE_VISIBILITY,
} from '../definitions/knowledgeConfig';
import { redactText } from '../middleware/piiRedaction';
import type { EmbedDispatcher } from '../runtime/embedDispatch';
import type { ICbAIEngineDb } from './tools/db';

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
  /** Client ADMIN — a RLS de escrita exige `ai:update`, que o CS não tem. */
  admin: ICbAIEngineDb;
  /** `is_internal_staff()` do turno. Decide a visibilidade da memória. */
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
  { admin, isInternal, companyId, userId, dispatchEmbedding }: ICreateMemoryWriterParams,
): IMemoryWriter {
  const visibility = isInternal ? KNOWLEDGE_VISIBILITY.INTERNAL : KNOWLEDGE_VISIBILITY.PORTAL;

  return {
    async save(params: ISaveMemoryParams): Promise<ISaveMemoryResult> {
      if (!isInternal && !companyId) { return { error: MEMORY_PORTAL_REQUIRES_COMPANY }; }

      // 🔴 A base de conhecimento é PERMANENTE: o que entra aqui volta em toda
      // sessão futura pela `ai_knowledge_search`. O middleware `pre-model` já
      // redige o que o modelo VÊ, mas esta porta atende qualquer chamador —
      // cron, outro preset, o assistente do cliente (#16) — e nenhum deles
      // carrega aquela cadeia. Redigir aqui é o que impede a exposição de
      // virar registro.
      const title = redactText(params.title).text;
      const content = redactText(params.content).text;

      const { data: category } = await admin.from(KNOWLEDGE_CATEGORIES_TABLE)
        .select<{ id: string }>('id')
        .eq('slug', AGENT_MEMORIES_SLUG)
        .maybeSingle();

      if (!category?.id) { return { error: MEMORY_CATEGORY_MISSING }; }

      const { data: created, error } = await admin.from(KNOWLEDGE_ENTRIES_TABLE)
        .insert<{ id: string }>({
          category_id: category.id,
          title,
          content,
          // Carimbados da sessão — o schema da tool nem expõe os dois campos.
          visibility,
          company_id: companyId,
          sync_status: KNOWLEDGE_SYNC_STATUS.PENDING,
          created_by: userId,
        })
        .select('id')
        .single();

      if (error || !created) { return { error: error?.message ?? 'insert failed' }; }

      dispatchEmbedding([created.id]);
      return { id: created.id };
    },
  };
}
