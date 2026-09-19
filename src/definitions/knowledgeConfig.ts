/**
 * 🔧 knowledgeConfig — Vocabulário da base de conhecimento vetorial (RAG)
 *
 * Espelho declarativo dos CHECK constraints e da categoria reservada da
 * the database migration. O teste `database schema tests`
 * confronta os dois lados — banco e TypeScript — e quebra se um mudar sem o outro.
 */

// ============== SYNC STATUS ==============

/**
 * Ciclo de ingestão. `processing` é o LOCK: a transição para ele é o próprio
 * `update ... where sync_status in ('pending','failed')`, então duas execuções
 * concorrentes de `engine-embed` nunca embedam a mesma entrada duas vezes.
 */
export const KNOWLEDGE_SYNC_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SYNCED: 'synced',
  FAILED: 'failed',
} as const satisfies Record<string, string>;

export type KnowledgeSyncStatus = typeof KNOWLEDGE_SYNC_STATUS[keyof typeof KNOWLEDGE_SYNC_STATUS];

/** O que a fila reclama numa passada. `failed` entra junto: reindex é rotina, não exceção. */
export const KNOWLEDGE_CLAIMABLE_STATUSES: readonly KnowledgeSyncStatus[] = [
  KNOWLEDGE_SYNC_STATUS.PENDING,
  KNOWLEDGE_SYNC_STATUS.FAILED,
];

// ============== VISIBILITY ==============

/**
 * `internal` = só staff. `portal` = o cliente também vê, e ainda assim só da
 * própria empresa — o recorte por `company_id` é da RLS (021), não daqui.
 */
export const KNOWLEDGE_VISIBILITY = {
  INTERNAL: 'internal',
  PORTAL: 'portal',
} as const satisfies Record<string, string>;

export type KnowledgeVisibility = typeof KNOWLEDGE_VISIBILITY[keyof typeof KNOWLEDGE_VISIBILITY];

// ============== CATEGORIES ==============

/** Categoria reservada (`is_system`) onde `save_memory` grava fato durável (ADR §3.6b). */
export const AGENT_MEMORIES_SLUG = 'agent-memories';

// ============== EMBEDDING ==============

/**
 * Dimensão-casa. A coluna é `vector(1536)`: gravar vetor de outro tamanho
 * estoura no banco, então `engine-embed` recusa ANTES, com motivo legível.
 */
export const EMBEDDING_DIMENSION = 1536;

/** Teto de entradas por passada da fila — protege o tempo de vida do isolate. */
export const EMBEDDING_BATCH_LIMIT = 20;

// ============== TESTE DE RECUPERAÇÃO ==============

/**
 * Teto de `top_k` aceito pela porta de teste de recuperação
 * (`engine-knowledge-search`).
 *
 * Existe porque `top_k` chega de um campo aberto na tela: sem teto, um número
 * grande viraria uma varredura do índice HNSW inteira a cada clique. Vinte é
 * folgado para conferência humana — quem precisa de mais não está conferindo,
 * está exportando.
 */
export const KNOWLEDGE_SEARCH_TOP_K_LIMIT = 20;

/** Tamanho máximo da pergunta enviada ao teste — o embedder cobra por token. */
export const KNOWLEDGE_SEARCH_QUERY_MAX_LENGTH = 2000;

// ============== TABLES ==============

export const KNOWLEDGE_ENTRIES_TABLE = 'ai_knowledge_entries';
export const KNOWLEDGE_CATEGORIES_TABLE = 'ai_knowledge_categories';
export const KNOWLEDGE_SEARCH_RPC = 'ai_knowledge_search';

// ============== UTILS ==============

export function isKnowledgeSyncStatus(value: string): value is KnowledgeSyncStatus {
  return Object.values(KNOWLEDGE_SYNC_STATUS).includes(value as KnowledgeSyncStatus);
}

export function isKnowledgeVisibility(value: string): value is KnowledgeVisibility {
  return Object.values(KNOWLEDGE_VISIBILITY).includes(value as KnowledgeVisibility);
}
