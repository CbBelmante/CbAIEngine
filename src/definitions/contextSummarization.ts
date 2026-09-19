// ============== CONTEXT SUMMARIZATION (DENO-COMPATIBLE) ==============
// 🔧 Quando condensar o histórico, e com que régua se mede "grande demais"

/**
 * Política de sumarização de contexto: o LIMIAR que decide quando condensar, o
 * quanto da conversa fica intacto e como se estima o tamanho.
 *
 * Aqui mora o CONTEÚDO (os números e a régua); o COMO mora em
 * `agent/middleware/contextSummarization.ts`. É a mesma separação de `ragConfig.ts`, e
 * existe pelo mesmo motivo: número solto no meio da lógica (`if (tokens > 6000)`)
 * é uma decisão de produto escondida num arquivo de mecanismo, que ninguém
 * encontra para ajustar e que só muda por deploy.
 *
 * Todo valor daqui é override-ável por `ai_config.params`, com a cascata
 * empresa → global → agente `default` que `resolveConfig` já roda. Apertar ou
 * afrouxar a economia de uma empresa é edição de linha, não release.
 */

// ============== PARAM KEYS ==============

/**
 * As chaves de `ai_config.params` que sobrescrevem cada default. Prefixadas por
 * `summarization_` no molde de `rag_*`: `params` é um `jsonb` compartilhado com
 * os params do provider (`temperature`, `reasoning`), e sem prefixo a próxima
 * chave nova de algum provider colidiria calada.
 */
export const SUMMARIZATION_PARAM_KEYS = {
  TRIGGER_TOKENS: 'summarization_trigger_tokens',
  KEEP_RECENT_MESSAGES: 'summarization_keep_recent_messages',
  CHARS_PER_TOKEN: 'summarization_chars_per_token',
  MAX_SUMMARY_TOKENS: 'summarization_max_summary_tokens',
} as const satisfies Record<string, string>;

// ============== DEFAULTS ==============

export const SUMMARIZATION_DEFAULTS = {
  /**
   * Acima de quantos tokens estimados o histórico é condensado.
   *
   * Não é limite de janela — as janelas em uso são de 128k para cima. É o ponto
   * em que a RELEITURA passa a dominar o custo do turno: abaixo dele o resumo
   * custaria mais do que economiza, porque quem resume precisa LER o histórico
   * antigo inteiro antes de comprimi-lo.
   *
   * 6.000 ≈ 20 trocas de conversa do assistente. Valores típicos:
   * - 2.000: agressivo — condensa cedo, e paga resumo em conversa ainda curta
   * - 6.000: equilíbrio (recomendado) — a releitura já pesa, o resumo já paga
   * - 20.000+: conservador — só evita o teto da janela, quase não economiza
   */
  trigger_tokens: 6000,

  /**
   * Quantas mensagens do fim ficam INTACTAS, byte a byte.
   *
   * É a conversa viva — o que o modelo precisa ler literal para não perder o fio
   * do raciocínio atual. Seis cobrem três trocas completas, ou um turno inteiro
   * com tool call (`user` → `assistant`+toolCalls → `tool` → `assistant`).
   *
   * Baixar isto é onde a paridade de resposta começa a degradar primeiro: o
   * resumo comprime bem o que já foi resolvido e mal o que ainda está em aberto.
   */
  keep_recent_messages: 6,

  /**
   * A régua do estimador: quantos caracteres valem um token.
   *
   * ⚠️ É ESTIMATIVA, e o código a declara como tal no trace. Não há tokenizer no
   * edge runtime, e a contagem real do provider só chega DEPOIS da chamada —
   * tarde demais para decidir se condensa. Quatro é a razão média de texto
   * latino, e a mesma ordem de grandeza em pt-BR.
   */
  chars_per_token: 4,

  /**
   * Teto de saída pedido ao modelo que resume.
   *
   * ~6% do `trigger_tokens`: um resumo que pudesse chegar perto do limiar não
   * condensaria nada. O middleware ainda assim CONFERE a redução no resultado e
   * desiste se o resumo não encolheu o contexto — o teto é a intenção, a
   * conferência é a garantia.
   */
  max_summary_tokens: 400,
} as const;

/** Type derivado (garante que `SUMMARIZATION_DEFAULTS` é readonly). */
export type TSummarizationDefaults = typeof SUMMARIZATION_DEFAULTS;

// ============== PROMPT ==============

/**
 * A instrução dada ao modelo que resume.
 *
 * O que ela PRESERVA é a lista do que o agente ainda vai precisar para
 * responder: decisão tomada, fato estabelecido, identificador em jogo, pedido em
 * aberto. O que ela DESCARTA é o que já cumpriu função — cortesia, repetição, o
 * raciocínio que levou a uma conclusão já dita.
 *
 * 🔴 "Same language as the conversation" não é detalhe: a instrução é em inglês
 * (identificadores e prompts do módulo são), e sem essa linha o modelo responde
 * em inglês um resumo de conversa em pt-BR — e o assistente passa a raciocinar
 * sobre um contexto num idioma e a responder noutro.
 */
export const CONTEXT_SUMMARY_SYSTEM_PROMPT =
  'You are compressing the earlier part of a conversation so it can be replaced '
  + 'by a shorter recap. PRESERVE: decisions made, facts established, names and '
  + 'identifiers still in play, and every request that is still open. DROP: '
  + 'pleasantries, repetition, and the reasoning that led to a conclusion already '
  + 'stated. Write in the SAME language as the conversation. Output only the '
  + 'recap — no preamble, no meta-commentary.';

// ============== ESTIMATOR ==============

/**
 * O identificador do estimador, gravado no trace ao lado dos números.
 *
 * 🔴 Sem ele, `tokensBefore: 6300` no `ai_run_steps` seria lido como contagem
 * exata do provider — e a auditoria compararia com `ai_invocations.prompt_tokens`
 * concluindo que um dos dois está errado. O trace diz COMO mediu.
 */
export const TOKEN_ESTIMATOR_ID = 'chars-per-token';

/** Tokens estimados de um volume de caracteres. Nunca negativo, nunca fracionário. */
export function estimateTokens(
  { chars, charsPerToken }: { chars: number; charsPerToken: number },
): number {
  if (chars <= 0 || charsPerToken <= 0) { return 0; }
  return Math.ceil(chars / charsPerToken);
}

// ============== RESOLVERS ==============

/**
 * Um valor de `ai_config.params` só vale se for número FINITO e positivo. O
 * `params` é `jsonb` livre — a tela pode gravar string, `0` ou `NaN`, e um
 * limiar `0` faria a sumarização rodar em toda conversa, que é o oposto do
 * pedido. Valor inválido cai no default em vez de virar comportamento.
 */
function readPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Nem toda régua daqui aceita fração, e as duas que não aceitam têm razões
 * distintas: contagem de MENSAGENS porque `6.5` produziria um índice de corte
 * fracionário — `slice` truncaria sem quebrar, mas o número gravado no trace
 * deixaria de descrever o corte que aconteceu; e o TETO DE SAÍDA porque ele
 * viaja até `max_tokens` no fio, inteiro obrigatório nas duas portas. Mesma
 * porta que já se fechou para string, `0` e negativo.
 */
function readPositiveInteger(value: unknown): number | null {
  const positive = readPositiveNumber(value);
  return positive !== null && Number.isInteger(positive) ? positive : null;
}

function resolveFromParams(
  { params, key, fallback, integer }: {
    params: Record<string, unknown> | undefined;
    key: string;
    fallback: number;
    /**
     * Recusa fração, por duas razões distintas: contagem de mensagens porque
     * meia mensagem não descreve corte nenhum; teto de saída porque `max_tokens`
     * é inteiro obrigatório no fio das duas portas, e `params` é `jsonb` livre —
     * um `400.5` gravado pela tela só apareceria como recusa do provider, longe
     * da causa. Só o limiar em TOKENS é régua estimada, e aceita fracionário.
     */
    integer?: boolean;
  },
): number {
  const read = integer ? readPositiveInteger : readPositiveNumber;
  return read(params?.[key]) ?? fallback;
}

/** A política inteira, resolvida de `ai_config.params` sobre os defaults. */
export interface ISummarizationPolicy {
  triggerTokens: number;
  keepRecentMessages: number;
  charsPerToken: number;
  maxSummaryTokens: number;
}

export function resolveSummarizationPolicy(
  params?: Record<string, unknown>,
): ISummarizationPolicy {
  return {
    triggerTokens: resolveFromParams({
      params,
      key: SUMMARIZATION_PARAM_KEYS.TRIGGER_TOKENS,
      fallback: SUMMARIZATION_DEFAULTS.trigger_tokens,
    }),
    keepRecentMessages: resolveFromParams({
      params,
      key: SUMMARIZATION_PARAM_KEYS.KEEP_RECENT_MESSAGES,
      fallback: SUMMARIZATION_DEFAULTS.keep_recent_messages,
      integer: true,
    }),
    charsPerToken: resolveFromParams({
      params,
      key: SUMMARIZATION_PARAM_KEYS.CHARS_PER_TOKEN,
      fallback: SUMMARIZATION_DEFAULTS.chars_per_token,
    }),
    maxSummaryTokens: resolveFromParams({
      params,
      key: SUMMARIZATION_PARAM_KEYS.MAX_SUMMARY_TOKENS,
      fallback: SUMMARIZATION_DEFAULTS.max_summary_tokens,
      integer: true,
    }),
  };
}
