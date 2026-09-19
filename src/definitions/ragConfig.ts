/**
 * 🔧 ragConfig — Defaults de busca vetorial (RAG)
 *
 * Valores default da função `ai_knowledge_search`. O banco usa esses mesmos
 * valores nos defaults SQL da função (migration 021_ai_knowledge.sql), e o
 * teste `database schema tests` valida que ambos os lados estão
 * sincronizados — se alguém mudar um e esquecer o outro, o teste quebra.
 *
 * Edge functions e código front-end DEVEM importar daqui (não repetir literais):
 *
 *   import { RAG_DEFAULTS } from '@definitions/ragConfig'
 *   const topK = config.params.rag_top_k ?? RAG_DEFAULTS.top_k
 *
 * Por que este arquivo existe: evita literais espalhados (`if (topK === 5)`,
 * `threshold || 0.7`) e garante que código, banco e testes falam a mesma língua.
 */

// ============== DEFAULTS DE BUSCA VETORIAL ==============

/**
 * Valores default da função `ai_knowledge_search`.
 *
 * Esses valores são os "sensatos técnicos" que funcionam bem na maioria dos
 * casos. O admin PODE override via `ai_config.params.rag_*` ou o código pode
 * passar argumentos diferentes na chamada — esses defaults são o fallback.
 *
 * ATENÇÃO: Se mudar aqui, DEVE mudar na the database migration e
 * rodar o teste `database schema tests` pra validar sincronia.
 */
export const RAG_DEFAULTS = {
  /**
   * Quantos chunks devolver da busca vetorial (top K mais similares).
   *
   * Valores típicos:
   * - 1-2: Rápido e barato, mas arriscado (se o chunk certo não for o #1, erra)
   * - 3-5: Ponto de equilíbrio (cobre o assunto sem inchar o contexto)
   * - 10+: Entra ruído (chunks com score 0.4 confundem o modelo)
   *
   * Fenômeno "lost in the middle": LLMs prestam menos atenção ao que está no
   * meio de um contexto longo. Mais contexto NEM SEMPRE melhora.
   */
  top_k: 5,

  /**
   * Similaridade mínima (cosine) pra um chunk entrar nos resultados.
   *
   * Range: 0.0 (qualquer coisa) a 1.0 (idêntico).
   *
   * Valores típicos:
   * - 0.5: Permissivo (aceita matches fracos, bom pra explorar)
   * - 0.7: Balanceado (só o relevante, recomendado pra produção)
   * - 0.85+: Muito rigoroso (só os MUITO parecidos)
   *
   * Combinado com `top_k`: se pede top_k=5 mas só 2 chunks passam do threshold,
   * retorna 2 — melhor devolver pouco e relevante do que encher com lixo.
   */
  similarity_threshold: 0.7,

  /**
   * Peso da prioridade manual no score combinado (0.0 a 1.0).
   *
   * Score combinado = (1-w)*similaridade + w*prioridade_normalizada
   *
   * Valores típicos:
   * - 0.0: Só similaridade (ignora prioridade manual do admin)
   * - 0.2: Balanceado (80% similaridade, 20% curadoria manual)
   * - 0.5: Meio a meio (similaridade e prioridade têm mesmo peso)
   * - 1.0: Só prioridade (ignora similaridade — raramente útil)
   *
   * Exemplo com w=0.2:
   * - Chunk A: sim=0.85, prio=10  → score = 0.8*0.85 + 0.2*0.1 = 0.700
   * - Chunk B: sim=0.75, prio=100 → score = 0.8*0.75 + 0.2*1.0 = 0.800 ← vence
   *
   * Permite que documento marcado como prioritário pelo admin suba no ranking
   * mesmo com similaridade um pouco menor.
   */
  priority_weight: 0.2,
} as const;

/** Type derivado (garante que RAG_DEFAULTS é readonly). */
export type TRagDefaults = typeof RAG_DEFAULTS;

// ============== HELPERS ==============

/**
 * Resolve o top_k final (config → defaults → fallback).
 *
 * Ordem de precedência:
 * 1. Argumento explícito na chamada
 * 2. Config em `ai_config.params.rag_top_k`
 * 3. Default deste arquivo
 */
export function resolveTopK(
  explicitValue?: number | null,
  configValue?: number | null,
): number {
  return explicitValue ?? configValue ?? RAG_DEFAULTS.top_k;
}

/**
 * Resolve o similarity_threshold final (config → defaults → fallback).
 */
export function resolveSimilarityThreshold(
  explicitValue?: number | null,
  configValue?: number | null,
): number {
  return explicitValue ?? configValue ?? RAG_DEFAULTS.similarity_threshold;
}

/**
 * Resolve o priority_weight final (config → defaults → fallback).
 */
export function resolvePriorityWeight(
  explicitValue?: number | null,
  configValue?: number | null,
): number {
  return explicitValue ?? configValue ?? RAG_DEFAULTS.priority_weight;
}
