/**
 * 🌐 knowledgeSearch — Busca vetorial via adapter
 *
 * 🔴 **A vedação de visibilidade mora no BANCO, e isto é o que a mantém viva.**
 * A função de busca roda com o papel do CALLER, e a policy corta o que o
 * cliente do portal não pode ver — `visibility='portal'`, empresa dele,
 * `active`, `synced` — antes de qualquer linha virar texto.
 *
 * Erro da busca PROPAGA. Devolver `[]` numa falha de banco esconderia a queda do
 * RAG atrás de "nada encontrado", e ninguém saberia que o agente passou a
 * responder sem conhecimento nenhum. Quem chama decide se degrada.
 */

import { RAG_DEFAULTS } from '../definitions/ragConfig';
import type { IAiDbAdapter } from '../dbAdapter/dbAdapter';
import type { IAiKnowledgeHit } from '../dbAdapter/types';

// ============== TYPES ==============

export interface ISearchKnowledgeParams {
  adapter: IAiDbAdapter;
  queryEmbedding: number[];
  topK?: number;
  similarityThreshold?: number;
  priorityWeight?: number;
}

// ============== SEARCH ==============

export async function searchKnowledge(
  { adapter, queryEmbedding, topK, similarityThreshold, priorityWeight }: ISearchKnowledgeParams,
): Promise<IAiKnowledgeHit[]> {
  return adapter.searchKnowledge({
    queryEmbedding,
    topK: topK ?? RAG_DEFAULTS.top_k,
    similarityThreshold: similarityThreshold ?? RAG_DEFAULTS.similarity_threshold,
    priorityWeight: priorityWeight ?? RAG_DEFAULTS.priority_weight,
  });
}
