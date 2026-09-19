// ============== AI AGENTS (DENO-COMPATIBLE) ==============
// 🤖 Os agentes que a tela `/admin/ai` configura

/**
 * Chaves de `ai_config.agent`, medidas na fonte — cada uma é a constante que a
 * edge correspondente passa a `buildAgentRuntime`/`buildEmbedder`:
 *
 *   · `assistant` → `assistant/runtime.ts` (ASSISTANT_AGENT_KEY)
 *   · `summarize` → `summarize/preset.ts` (SUMMARY_AGENT_KEY)
 *   · `analyze`   → `analyze/preset.ts` (ANALYZE_AGENT_KEY)
 *   · `meeting`   → `meeting/preset.ts` (MEETING_AGENT_KEY)
 *   · `embedding` → `core/ai/embeddingRuntime.ts` (EMBEDDING_AGENT_KEY)
 *
 * `default` não pertence a edge nenhuma: é o catch-all que `resolveConfig`
 * consulta de verdade (query no banco, não constante) quando o agente pedido
 * não tem linha própria — cadastrá-lo é cadastrar todo agente ainda sem config.
 * Sem chave nenhuma cadastrada, a cascata recusa (`ConfigError`) — não existe
 * modelo/provider hardcoded em lugar nenhum.
 *
 * A referência é SOFT (texto, não FK): `ai_agent_runs.agent` aceita chave
 * ad-hoc de uma edge que passe config inline. Esta lista é o que a TELA oferece,
 * não um cadeado sobre o banco.
 */
export const AI_AGENTS = {
  DEFAULT: 'default',
  ASSISTANT: 'assistant',
  SUMMARIZE: 'summarize',
  ANALYZE: 'analyze',
  MEETING: 'meeting',
  EMBEDDING: 'embedding',
} as const satisfies Record<string, string>;

export type AiAgent = typeof AI_AGENTS[keyof typeof AI_AGENTS];

/** Ordem de exibição: o catch-all primeiro, depois os agentes concretos. */
export const AI_AGENT_KEYS: readonly AiAgent[] = [
  AI_AGENTS.DEFAULT,
  AI_AGENTS.ASSISTANT,
  AI_AGENTS.SUMMARIZE,
  AI_AGENTS.ANALYZE,
  AI_AGENTS.MEETING,
  AI_AGENTS.EMBEDDING,
];

/**
 * A resposta que as edges de IA dão quando a cascata de config/credencial
 * RECUSA (`ConfigError`). É a MESMA nas quatro de propósito: quem administra
 * reconhece o próprio ato — não cadastrou — venha o erro de onde vier, em vez
 * de ler "Internal error" e ir depurar provedor.
 *
 * Estava duplicada como literal em `assistant.f.ts` e
 * `summarizeConversation.f.ts`; as outras duas edges nem respondiam isso.
 */
export const AI_NOT_CONFIGURED_MESSAGE =
  'Nenhum modelo de IA configurado para este agente. Cadastre no sistema.';
