/**
 * 🛡️ piiRedaction — A redação de PII: uma função pura e o middleware que a usa
 *
 * O QUE se redige é do catálogo (`definitions/piiCatalog.ts`); aqui mora só o
 * COMO. Os três caminhos de exposição consomem daqui:
 *
 *   1. o texto indo para o provider  → `createPiiRedactionMiddleware` (`pre-model`)
 *   2. o `save_memory` persistindo   → `memoryWriter.save`
 *   3. o `payload` de `ai_run_steps` → `observability/rows.buildStepRow`
 *
 * O motor (`loop.ts`) NÃO é alterado: a fase `pre-model` já existe e roda antes
 * de `buildChatRequest`, então o que sai no `fetch` do adapter já vem redigido.
 *
 * ⚠️ A redação REDUZ a exposição; não a zera. O `system` prompt viaja fora de
 * `messages` (`loop.ts`) e não passa por aqui, e PII sem forma reconhecível
 * ("meu cpf é cinco dois nove…") atravessa. Prometer zero seria mentir sobre o
 * que uma regex faz.
 */

import {
  BRAZILIAN_AREA_CODES,
  buildPiiPlaceholder,
  CPF_CANDIDATE_PATTERN,
  CPF_DIGIT_COUNT,
  LANDLINE_DIGIT_COUNT,
  LANDLINE_FIRST_DIGITS,
  MOBILE_DIGIT_COUNT,
  MOBILE_NINTH_DIGIT,
  PHONE_CANDIDATE_PATTERN,
  PII_CATEGORIES,
  type PiiCategory,
} from '../definitions/piiCatalog';
import type { IMiddleware, NMessage, NMessagePart } from '../core/types';

// ============== CONSTANTS ==============

export const PII_REDACTION_MIDDLEWARE_NAME = 'pii-redaction';

const NON_DIGIT = /\D/g;
const SEPARATOR = /[.\-() ]/;
/** CPF de dígitos repetidos (`111.111.111-11`) passa no verificador e não é CPF. */
const REPEATED_DIGITS = /^(\d)\1{10}$/;
const COUNTRY_CODE = '55';

// ============== TYPES ==============

/** Quantos valores DISTINTOS por categoria — nunca os valores. */
export type TPiiCounts = Partial<Record<PiiCategory, number>>;

export interface IRedactionScope {
  redactText(text: string): string;
  /** `null` quando nada foi redigido — é o que mantém o marcador ausente no caminho feliz. */
  counts(): TPiiCounts | null;
}

// ============== VALIDATORS ==============

function digitsOf(raw: string): string {
  return raw.replace(NON_DIGIT, '');
}

/** Módulo 11 da Receita, aplicado às duas posições verificadoras. */
function cpfCheckDigit({ digits, length }: { digits: string; length: number }): number {
  let sum = 0;
  for (let index = 0; index < length; index++) {
    sum += Number(digits[index]) * (length + 1 - index);
  }
  const remainder = (sum * 10) % 11;
  return remainder === 10 ? 0 : remainder;
}

/**
 * 📌 É o dígito verificador que separa um CPF de um protocolo de 11 dígitos.
 *
 * Exigido em TODAS as formas, inclusive na canônica `000.000.000-00`. Com
 * separadores livres o espaço de falso positivo explode, e o custo do rigor é
 * um CPF digitado errado passar — número inválido, que não identifica ninguém.
 * Uma regra sem exceção vale mais que duas com borda.
 */
export function isValidCpf(digits: string): boolean {
  if (digits.length !== CPF_DIGIT_COUNT || REPEATED_DIGITS.test(digits)) {
    return false;
  }
  return cpfCheckDigit({ digits, length: 9 }) === Number(digits[9])
    && cpfCheckDigit({ digits, length: 10 }) === Number(digits[10]);
}

/**
 * Telefone não tem verificador, então a defesa é estrutural — DDD em uso mais a
 * assinatura da faixa:
 *
 * · **celular** (11 dígitos) — o nono dígito o torna inequívoco; aceito cru.
 * · **fixo** (10 dígitos) — só FORMATADO. Dez dígitos crus são ambíguos demais
 *   com número de protocolo, e comer protocolo é o falso positivo que cega.
 */
export function isBrazilianPhone(
  { digits, hasSeparator }: { digits: string; hasSeparator: boolean },
): boolean {
  const national = digits.startsWith(COUNTRY_CODE) && digits.length > MOBILE_DIGIT_COUNT
    ? digits.slice(COUNTRY_CODE.length)
    : digits;

  if (!BRAZILIAN_AREA_CODES.includes(national.slice(0, 2))) {
    return false;
  }
  if (national.length === MOBILE_DIGIT_COUNT) {
    return national[2] === MOBILE_NINTH_DIGIT;
  }
  if (national.length === LANDLINE_DIGIT_COUNT) {
    return hasSeparator && LANDLINE_FIRST_DIGITS.includes(national[2] ?? '');
  }
  return false;
}

// ============== SCOPE ==============

/**
 * O escopo de uma redação: guarda os ordinais para que o MESMO valor receba o
 * MESMO `#n` em todo o texto atravessado, e conta quantos distintos saíram.
 *
 * Um escopo por aplicação — o turno inteiro no middleware, um `save` no writer,
 * um step no trace. Fora dele o ordinal não significa nada, que é justamente o
 * que impede reidentificar por ele.
 */
export function createRedactionScope(): IRedactionScope {
  const ordinalByValue = new Map<string, number>();
  const totalByCategory = new Map<PiiCategory, number>();

  function assignOrdinal({ category, digits }: { category: PiiCategory; digits: string }): number {
    const key = `${category}:${digits}`;
    const known = ordinalByValue.get(key);
    if (known !== undefined) {
      return known;
    }
    const next = (totalByCategory.get(category) ?? 0) + 1;
    totalByCategory.set(category, next);
    ordinalByValue.set(key, next);
    return next;
  }

  function replaceCpf(match: string): string {
    const digits = digitsOf(match);
    if (!isValidCpf(digits)) {
      return match;
    }
    const category = PII_CATEGORIES.CPF;
    return buildPiiPlaceholder({ category, ordinal: assignOrdinal({ category, digits }) });
  }

  function replacePhone(match: string): string {
    const digits = digitsOf(match);
    if (!isBrazilianPhone({ digits, hasSeparator: SEPARATOR.test(match) })) {
      return match;
    }
    const category = PII_CATEGORIES.PHONE;
    return buildPiiPlaceholder({ category, ordinal: assignOrdinal({ category, digits }) });
  }

  return {
    /**
     * CPF primeiro, telefone depois. A ordem importa: os dois candidatos casam
     * 11 dígitos crus, e o verificador do CPF é a evidência mais forte. O que
     * ele já substituiu vira `[REDACTED:…]` e não recasa como telefone.
     */
    redactText(text: string): string {
      if (!text) {
        return text;
      }
      return text
        .replace(CPF_CANDIDATE_PATTERN, replaceCpf)
        .replace(PHONE_CANDIDATE_PATTERN, replacePhone);
    },

    counts(): TPiiCounts | null {
      if (totalByCategory.size === 0) {
        return null;
      }
      const counts: TPiiCounts = {};
      for (const [category, total] of totalByCategory) {
        counts[category] = total;
      }
      return counts;
    },
  };
}

// ============== DEEP REDACTION ==============

/** Redige toda string alcançável; número, booleano e nulo passam intactos. */
function redactUnknownValue(
  { value, scope }: { value: unknown; scope: IRedactionScope },
): unknown {
  if (typeof value === 'string') {
    return scope.redactText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactUnknownValue({ value: item, scope }));
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  return redactRecordValue({ record: value as Record<string, unknown>, scope });
}

function redactRecordValue(
  { record, scope }: { record: Record<string, unknown>; scope: IRedactionScope },
): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    redacted[key] = redactUnknownValue({ value, scope });
  }
  return redacted;
}

// ============== MESSAGES ==============

function redactPart({ part, scope }: { part: NMessagePart; scope: IRedactionScope }): NMessagePart {
  // `file` carrega url e mimeType, não fala de conversa — nada a redigir.
  if (part.type === 'file') {
    return part;
  }
  return { ...part, text: scope.redactText(part.text) };
}

function redactContent(
  { content, scope }: { content: string | NMessagePart[]; scope: IRedactionScope },
): string | NMessagePart[] {
  if (typeof content === 'string') {
    return scope.redactText(content);
  }
  return content.map((part) => redactPart({ part, scope }));
}

/**
 * ⚠️ `toolCalls.args` também é redigido: o que o modelo devolve num argumento
 * volta ao histórico na volta seguinte e é gravado no step `tool_call`.
 */
function redactMessage(
  { message, scope }: { message: NMessage; scope: IRedactionScope },
): NMessage {
  if (message.role === 'tool') {
    return { ...message, content: scope.redactText(message.content) };
  }
  if (message.role === 'assistant') {
    const redacted: NMessage = { ...message };
    if (message.content !== undefined) {
      redacted.content = redactContent({ content: message.content, scope });
    }
    if (message.toolCalls) {
      redacted.toolCalls = message.toolCalls.map((call) => ({
        ...call,
        args: redactRecordValue({ record: call.args, scope }),
      }));
    }
    return redacted;
  }
  return { ...message, content: redactContent({ content: message.content, scope }) };
}

// ============== MIDDLEWARE ==============

/**
 * O middleware do caminho 1 — fase `pre-model`, como o ADR §3.7 definiu
 * ("entram como `transform`/`check` num arquivo, sem tocar no motor").
 *
 * 📌 Nada redigido devolve o array ORIGINAL, mesma referência: é assim que
 * `runTransforms` reporta `pass` em vez de `transform` (`middleware.ts`). O
 * corolário é o registro grátis — quando redige, o trace ganha um step
 * `middleware` com `outcome: 'transform'`, que diz QUE houve redação sem
 * carregar o dado.
 *
 * Um escopo por volta: o ordinal fica coerente em todo o contexto que o modelo
 * vê naquela chamada, que é onde ele raciocina.
 */
export function createPiiRedactionMiddleware(): IMiddleware {
  return {
    name: PII_REDACTION_MIDDLEWARE_NAME,
    phase: 'pre-model',
    transform(messages: NMessage[]): NMessage[] {
      const scope = createRedactionScope();
      const redacted = messages.map((message) => redactMessage({ message, scope }));
      return scope.counts() === null ? messages : redacted;
    },
  };
}

// ============== ONE-SHOT HELPERS ==============

export interface IRedactedText {
  text: string;
  counts: TPiiCounts | null;
}

export interface IRedactedRecord {
  record: Record<string, unknown>;
  counts: TPiiCounts | null;
}

/** Atalho do caminho 2 (`save_memory`), que redige um texto isolado. */
export function redactText(raw: string): IRedactedText {
  const scope = createRedactionScope();
  return { text: scope.redactText(raw), counts: scope.counts() };
}

/** Atalho do caminho 3 (`ai_run_steps`), que redige o payload inteiro de um step. */
export function redactRecord(record: Record<string, unknown>): IRedactedRecord {
  const scope = createRedactionScope();
  return { record: redactRecordValue({ record, scope }), counts: scope.counts() };
}
