/**
 * 🌐 promptCache — Montagem do bloco `system` com breakpoint de prompt caching
 *
 * O prompt caching da Anthropic é **prefix match**: qualquer byte diferente
 * antes do breakpoint invalida o cache inteiro. A ordem de render é
 * `tools` → `system` → `messages`, então o prefixo cacheável é tudo que vem
 * antes do bloco marcado com `cache_control`.
 *
 * A regra que este módulo existe para prender: **o breakpoint nunca cobre
 * conteúdo volátil**. Data/hora, identidade do usuário e contexto lido do
 * banco mudam a cada request — marcá-los junto com o prompt estático produz
 * um prefixo distinto por chamada, e o resultado é PIOR que não cachear
 * (paga-se o cache write a 1,25× do input e nunca se lê a 0,1×).
 *
 * Consumido por: assistant, summarize,
 * analyze.
 */

// ============== TYPES ==============

/** Bloco de texto do `system` no formato da Anthropic Messages API. */
export interface ISystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface IBuildSystemBlocksParams {
  /** Conteúdo idêntico entre requests. Recebe o breakpoint de cache. */
  stable: string;
  /** Conteúdo que muda entre requests (data/hora, usuário, contexto). Nunca recebe breakpoint. */
  volatile?: string;
}

// ============== CONSTANTS ==============

/**
 * Mínimo de tokens que o prefixo precisa ter para a Anthropic aceitar cachear.
 * Abaixo disso o `cache_control` é **ignorado em silêncio** — sem erro, com
 * `cache_creation_input_tokens: 0`.
 *
 * O valor varia por modelo (Haiku 4.5 = 4096; Sonnet/Opus recentes = 512-1024).
 * Os três prefixos do engine hoje ficam abaixo do mínimo do Haiku 4.5
 * (2244 / 495 / 133 tokens medidos), então nenhum cacheia ainda. O breakpoint
 * fica posicionado corretamente para que o cache passe a valer sozinho quando
 * o prefixo crescer ou o modelo mudar — nunca para ficar errado no meio-tempo.
 */
export const CACHE_MIN_TOKENS_HAIKU_4_5 = 4096;

// ============== BUILDER ==============

/**
 * Monta o `system` com o breakpoint de cache isolado na parte estável.
 *
 * O bloco volátil sai **depois** do marcado e **sem** `cache_control`, de modo
 * que o prefixo cacheável permaneça byte-idêntico entre requests.
 */
export function buildSystemBlocks(
  { stable, volatile }: IBuildSystemBlocksParams,
): ISystemBlock[] {
  const blocks: ISystemBlock[] = [
    { type: 'text', text: stable, cache_control: { type: 'ephemeral' } },
  ];

  if (volatile && volatile.length > 0) {
    blocks.push({ type: 'text', text: volatile });
  }

  return blocks;
}
