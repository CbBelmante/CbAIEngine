/**
 * 🌐 knowledgeSearch — A porta do `ai_knowledge_search`, sob o RLS de quem pergunta
 *
 * 🔴 **A vedação de visibilidade mora no BANCO, e isto é o que a mantém viva.**
 * `ai_knowledge_search` é `security invoker` (021:206): ela roda com o
 * papel do CALLER, e a policy `ai_knowledge_entries_select` corta o que o
 * cliente do portal não pode ver — `visibility='portal'`, empresa dele,
 * `active`, `synced` — antes de qualquer linha virar texto.
 *
 * Por isso este arquivo aceita `IKnowledgeSearchDb` e não um `IAiDbAdapter`:
 * o client que chega tem de ser o **do usuário**. Passar o client ADMIN aqui
 * (service_role) bypassa a RLS inteira e devolveria nota interna — e conhecimento
 * de outra empresa — para o assistente do cliente. A RPC nem retorna `visibility`
 * ou `company_id`, então NÃO existe filtro em TypeScript capaz de consertar
 * isso depois: acertar o client é a única defesa deste lado.
 */

import {
  KNOWLEDGE_SEARCH_RPC,
} from '../definitions/knowledgeConfig';
import { RAG_DEFAULTS } from '../definitions/ragConfig';

// ============== TYPES ==============

/** Uma linha do retorno de `ai_knowledge_search` (021:196-203). */
export interface IKnowledgeHit {
  entry_id: string;
  category_id: string;
  title: string;
  content: string;
  similarity: number;
  combined_score: number;
}

/**
 * Superfície mínima que a busca consome — o client do CALLER a satisfaz
 * estruturalmente. Existe pelo mesmo motivo de `ICbAIEngineDb`: permite exercitar o
 * retrieval contra um duplo em memória, sem banco.
 */
export interface IKnowledgeSearchDb {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { message?: string } | null;
  }>;
}

export interface ISearchKnowledgeParams {
  db: IKnowledgeSearchDb;
  queryEmbedding: number[];
  topK?: number;
  similarityThreshold?: number;
  priorityWeight?: number;
}

// ============== HELPERS ==============

function isKnowledgeHit(row: unknown): row is IKnowledgeHit {
  if (typeof row !== 'object' || row === null) { return false; }
  const candidate = row as Record<string, unknown>;
  return typeof candidate['entry_id'] === 'string'
    && typeof candidate['title'] === 'string'
    && typeof candidate['content'] === 'string';
}

// ============== SEARCH ==============

/**
 * Erro da RPC PROPAGA. Devolver `[]` numa falha de banco esconderia a queda do
 * RAG atrás de "nada encontrado", e ninguém saberia que o agente passou a
 * responder sem conhecimento nenhum. Quem chama decide se degrada.
 */
export async function searchKnowledge(
  { db, queryEmbedding, topK, similarityThreshold, priorityWeight }: ISearchKnowledgeParams,
): Promise<IKnowledgeHit[]> {
  const { data, error } = await db.rpc(KNOWLEDGE_SEARCH_RPC, {
    query_embedding: queryEmbedding,
    top_k: topK ?? RAG_DEFAULTS.top_k,
    similarity_threshold: similarityThreshold ?? RAG_DEFAULTS.similarity_threshold,
    priority_weight: priorityWeight ?? RAG_DEFAULTS.priority_weight,
  });

  if (error) {
    throw new Error(`${KNOWLEDGE_SEARCH_RPC} failed: ${error.message ?? 'unknown error'}`);
  }
  if (!Array.isArray(data)) { return []; }

  const hits: IKnowledgeHit[] = [];
  for (const row of data) {
    if (isKnowledgeHit(row)) { hits.push(row); }
  }
  return hits;
}
