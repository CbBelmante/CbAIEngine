/**
 * 💰 contextSummarization — O histórico é condensado antes da chamada, não reenviado inteiro
 *
 * Contexto que só cresce é custo que só cresce. `loadHistory` recarrega a thread
 * perpétua a cada turno e o `loop.ts` reenvia `messages` A CADA VOLTA do
 * tool-use: numa conversa madura, a maior parte do token gasto é releitura do
 * que o modelo já viu, multiplicada pelo número de voltas.
 *
 * O QUANDO condensar é do catálogo (`definitions/contextSummarization.ts`);
 * aqui mora só o COMO — a mesma divisão de `piiRedaction.ts`. O motor
 * (`loop.ts`) NÃO é alterado: a fase `pre-model` já existe e o `transform` já é
 * `async` justamente porque sumarização chama LLM (ADR §3.7).
 *
 * ⚠️ Isto é uma ALAVANCA DE CUSTO, não uma vedação. Vedação que não pode rodar
 * recusa; economia que não pode rodar simplesmente não economiza. Toda falha
 * aqui devolve o histórico INTACTO — a conversa nunca cai por causa de um
 * resumo. O que não existe é fallback de MODELO: sem config, não resume, e
 * jamais pede a chamada a um modelo que ninguém escolheu.
 */

import {
  estimateTokens,
  type ISummarizationPolicy,
  resolveSummarizationPolicy,
  TOKEN_ESTIMATOR_ID,
} from '../definitions/contextSummarization';
import { STEP_TYPES } from '../definitions/aiObservability';
import { redactText } from './piiRedaction';
import { describeError } from '../observability/persistenceHooks';
import type { MiddlewareStepRecorder } from '../observability/stepSink';
import type { DbRow } from '../observability/types';
import type { IMiddleware, NMessage, NMessagePart, NUsage } from '../core/types';

// ============== CONSTANTS ==============

export const CONTEXT_SUMMARIZATION_MIDDLEWARE_NAME = 'context-summarization';

const MIDDLEWARE_PHASE = 'pre-model';

/**
 * O rótulo que torna o resumo IDENTIFICÁVEL — o mesmo papel do
 * `KNOWLEDGE_BLOCK_HEADING`, pelo mesmo motivo. Sem ele, um resumo em terceira
 * pessoa ("o usuário pediu o prazo do ticket") é lido como fala nova do
 * usuário, e o agente responde a um pedido que já foi atendido.
 *
 * Diz três coisas de propósito: que é resumo, que SUBSTITUI as mensagens
 * originais, e que o que vem depois é literal.
 */
export const CONTEXT_SUMMARY_HEADING =
  'Condensed summary of the earlier part of this conversation. It REPLACES those '
  + 'messages — treat it as a recap of what was already said, not as a new message '
  + 'from the user. The most recent messages follow below, verbatim.';

/** Rótulos do transcript entregue a quem resume: sem eles, quem falou o quê se perde. */
const TRANSCRIPT_LABELS = {
  system: 'context',
  user: 'user',
  assistant: 'assistant',
  tool: 'tool result',
} as const satisfies Record<NMessage['role'], string>;

/** O resumo não encolheu o contexto: devolver o original é o certo, e o trace diz por quê. */
export const NO_REDUCTION_REASON = 'summary did not reduce the context — original kept';

/** Quem resume falhou (provider fora, sem config). Custo não cai; conversa não cai. */
export const SUMMARIZER_FAILED_REASON = 'summarizer unavailable — original kept';

const SUMMARIZER_LOG_LABEL = '[agent:context_summarization]';

// ============== TYPES ==============

export interface ISummarizeRequest {
  /** O transcript do trecho antigo, JÁ redigido de PII. */
  text: string;
  maxTokens: number;
}

export interface ISummaryResult {
  text: string;
  /** Tokens gastos por quem resumiu. Ausente quando o provider não os informa. */
  usage?: NUsage;
}

/**
 * 🔴 OBRIGATÓRIA na entrada. Não há forma de construir este middleware sem
 * dizer quem resume — que é como "nunca existe modelo default" vira estrutura
 * em vez de disciplina: não há caminho de código que escolha um modelo sozinho.
 */
export type ContextSummarizer = (request: ISummarizeRequest) => Promise<ISummaryResult>;

/** A forma memoizada, interna: o teto já vem fechado na fábrica. */
type MemoizedSummarizer = (text: string) => Promise<ISummaryResult>;

export interface ICreateContextSummarizationParams {
  summarize: ContextSummarizer;
  /** Canal do trace — é por ele que o antes/depois em tokens chega ao `ai_run_steps`. */
  recordStep: MiddlewareStepRecorder;
  /** Resolvida de `ai_config.params`. Ausente usa os defaults do catálogo. */
  policy?: ISummarizationPolicy;
}

interface IMeasurement {
  chars: number;
  tokens: number;
  messages: number;
}

interface ICondensation {
  messages: NMessage[];
  /** Quantas mensagens o resumo substituiu — o numerador da compressão. */
  summarizedMessages: number;
  usage?: NUsage;
}

// ============== MEASUREMENT ==============

function partText(part: NMessagePart): string {
  // `file` carrega url e mimeType; o que pesa no contexto é texto.
  return part.type === 'file' ? '' : part.text;
}

function flattenContent(content: string | NMessagePart[] | undefined): string {
  if (typeof content === 'string') { return content; }
  if (!content) { return ''; }
  return content.map(partText).join('\n');
}

/**
 * O texto que uma mensagem carrega — incluindo os ARGUMENTOS de tool call, que
 * voltam ao histórico na volta seguinte e custam token como qualquer outro
 * conteúdo. Ignorá-los subestimaria justamente as conversas com mais voltas.
 */
export function messageText(message: NMessage): string {
  if (message.role === 'tool') { return message.content; }
  if (message.role !== 'assistant') { return flattenContent(message.content); }

  const chunks = [flattenContent(message.content)];
  for (const call of message.toolCalls ?? []) {
    chunks.push(`${call.name}(${JSON.stringify(call.args)})`);
  }
  return chunks.join('\n');
}

function measure(
  { messages, charsPerToken }: { messages: NMessage[]; charsPerToken: number },
): IMeasurement {
  let chars = 0;
  for (const message of messages) {
    chars += messageText(message).length;
  }
  return { chars, tokens: estimateTokens({ chars, charsPerToken }), messages: messages.length };
}

// ============== BOUNDARY ==============

/**
 * O índice onde a conversa VIVA começa — e o corte só pode cair numa fronteira
 * que o protocolo aceite. São DUAS regras, não uma:
 *
 * 🔴 **1. `tool` órfão.** Um `tool` no início do trecho preservado é um
 * resultado sem a chamada que o pediu, e o provider RECUSA a requisição inteira
 * (o adapter Anthropic monta `tool_result` esperando o `tool_use`
 * correspondente).
 *
 * 🔴 **2. `assistant` abrindo a conversa.** A mensagem de resumo é `role:'system'`,
 * e o adapter Anthropic move todo `system` para o campo próprio — some do array.
 * Se o trecho preservado começar num `assistant`, é ELE que abre o array no fio,
 * e uma conversa que começa pela fala do modelo não é aceita.
 *
 * ⚠️ Isto não é borda: com `keep_recent_messages` PAR e um histórico que termina
 * na pergunta corrente (`recordUserMessage` roda antes de `loadHistory`), a
 * paridade faz o corte cair num `assistant` sempre que o retrieval não injetou
 * bloco — zero hits, ou o ramo degradado inteiro. O bloco de conhecimento muda a
 * paridade, e sem esta regra o defeito ficaria intermitente por um motivo que
 * nada tem a ver com ele.
 *
 * Nos dois casos o corte anda para FRENTE: o que não pode abrir o trecho vai
 * inteiro para o lado que será resumido, nunca partido ao meio. `user` e
 * `system` são fronteiras válidas — a segunda porque some no fio, deixando a
 * seguinte abrir o array.
 */
function opensSafely(message: NMessage | undefined): boolean {
  return message?.role === 'user' || message?.role === 'system';
}

export function findSafeBoundary(
  { messages, keepRecentMessages }: { messages: NMessage[]; keepRecentMessages: number },
): number {
  let start = Math.max(0, messages.length - keepRecentMessages);
  while (start < messages.length && !opensSafely(messages[start])) {
    start += 1;
  }
  return start;
}

// ============== TRANSCRIPT ==============

/** O trecho antigo como transcript rotulado — é o que quem resume lê. */
export function renderTranscript(messages: NMessage[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    const text = messageText(message).trim();
    if (text) { lines.push(`${TRANSCRIPT_LABELS[message.role]}: ${text}`); }
  }
  return lines.join('\n');
}

export function buildSummaryMessage(summaryText: string): NMessage {
  return { role: 'system', content: `${CONTEXT_SUMMARY_HEADING}\n\n${summaryText}` };
}

// ============== TRACE ==============

function buildTracePayload(
  { before, after, policy }: {
    before: IMeasurement;
    after: IMeasurement;
    policy: ISummarizationPolicy;
  },
): DbRow {
  return {
    name: CONTEXT_SUMMARIZATION_MIDDLEWARE_NAME,
    phase: MIDDLEWARE_PHASE,
    tokensBefore: before.tokens,
    tokensAfter: after.tokens,
    charsBefore: before.chars,
    charsAfter: after.chars,
    messagesBefore: before.messages,
    messagesAfter: after.messages,
    triggerTokens: policy.triggerTokens,
    // 🔴 O trace diz COMO mediu. Sem isto, `tokensBefore` seria lido como
    // contagem exata do provider e comparado de igual para igual com
    // `ai_invocations.prompt_tokens`, que é medido por outra régua.
    estimator: TOKEN_ESTIMATOR_ID,
    charsPerToken: policy.charsPerToken,
  };
}

// ============== FACTORY ==============

/**
 * O resumo é memoizado POR CONTEÚDO do trecho antigo, e isso não é otimização
 * de conforto: a fase `pre-model` roda a cada volta do tool-use, então sem
 * memoização um turno com três tool calls pagaria TRÊS resumos do mesmo trecho —
 * o remédio custando mais que a doença. Uma chamada por trecho, reaproveitada
 * em todas as voltas.
 */
function createSummarizeOnce(
  { summarize, maxTokens }: { summarize: ContextSummarizer; maxTokens: number },
): MemoizedSummarizer {
  let memo: { key: string; value: ISummaryResult } | null = null;

  return async function summarizeOnce(text: string): Promise<ISummaryResult> {
    if (memo?.key === text) { return memo.value; }
    const value = await summarize({ text, maxTokens });
    memo = { key: text, value };
    return value;
  };
}

async function condense(
  { messages, boundary, summarize }: {
    messages: NMessage[];
    boundary: number;
    summarize: MemoizedSummarizer;
  },
): Promise<ICondensation> {
  const head = messages.slice(0, boundary);
  // 🔴 A redação acontece AQUI, e não depois. Este middleware roda ANTES do de
  // PII (que é o último da cadeia, o gate final antes do provider), então o
  // transcript que sai daqui chegaria CRU ao provider de quem resume — um
  // quarto caminho de exposição, contornando o catálogo. Ver `piiRedaction.ts`.
  const { text } = redactText(renderTranscript(head));
  const summary = await summarize(text);

  const condensed: ICondensation = {
    messages: [buildSummaryMessage(summary.text), ...messages.slice(boundary)],
    summarizedMessages: head.length,
  };
  if (summary.usage) { condensed.usage = summary.usage; }
  return condensed;
}

export function createContextSummarizationMiddleware(
  params: ICreateContextSummarizationParams,
): IMiddleware {
  const policy = params.policy ?? resolveSummarizationPolicy();
  const summarize = createSummarizeOnce({
    summarize: params.summarize,
    maxTokens: policy.maxSummaryTokens,
  });

  function recordOutcome(payload: DbRow): Promise<void> {
    return params.recordStep({ stepType: STEP_TYPES.MIDDLEWARE, payload });
  }

  return {
    name: CONTEXT_SUMMARIZATION_MIDDLEWARE_NAME,
    phase: MIDDLEWARE_PHASE,

    async transform(messages: NMessage[]): Promise<NMessage[]> {
      const before = measure({ messages, charsPerToken: policy.charsPerToken });
      // 📌 Abaixo do limiar devolve o array ORIGINAL, mesma referência: é assim
      // que `runTransforms` reporta `pass` em vez de `transform` (middleware.ts),
      // e é o que garante que a sumarização não roda por reflexo.
      if (before.tokens <= policy.triggerTokens) { return messages; }

      const boundary = findSafeBoundary({
        messages,
        keepRecentMessages: policy.keepRecentMessages,
      });
      // Sem trecho antigo não há o que condensar; sem trecho PRESERVADO o
      // resumo ficaria sozinho, e no fio do adapter Anthropic — que tira o
      // `system` do array — não sobraria mensagem nenhuma.
      if (boundary === 0 || boundary >= messages.length) { return messages; }

      let condensed: ICondensation;
      try {
        condensed = await condense({ messages, boundary, summarize });
      } catch (error) {
        console.error(SUMMARIZER_LOG_LABEL, error);
        await recordOutcome({
          name: CONTEXT_SUMMARIZATION_MIDDLEWARE_NAME,
          phase: MIDDLEWARE_PHASE,
          skipped: SUMMARIZER_FAILED_REASON,
          error: describeError(error),
        });
        return messages;
      }

      const after = measure({
        messages: condensed.messages,
        charsPerToken: policy.charsPerToken,
      });
      const payload = buildTracePayload({ before, after, policy });

      // A conferência da promessa, não a intenção dela: um resumo que não
      // encolheu o contexto não é economia, e trocar o histórico por ele custaria
      // uma chamada de modelo para piorar o turno.
      if (after.tokens >= before.tokens) {
        await recordOutcome({ ...payload, skipped: NO_REDUCTION_REASON });
        return messages;
      }

      payload['summarizedMessages'] = condensed.summarizedMessages;
      if (condensed.usage) { payload['summaryUsage'] = { ...condensed.usage }; }
      await recordOutcome(payload);
      return condensed.messages;
    },
  };
}
