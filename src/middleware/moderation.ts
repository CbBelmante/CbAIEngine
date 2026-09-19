/**
 * 🛡️ moderation — A porta de moderação e os dois middlewares que a usam
 *
 * O QUE se bloqueia é do catálogo (`definitions/moderationCatalog.ts`); aqui
 * mora só o COMO. Dois pontos de aplicação, um por sentido do fluxo:
 *
 *   1. a mensagem do usuário indo para o modelo → `pre-context` (`transform`)
 *   2. a resposta do modelo indo para o usuário → `post-model` (`check`)
 *
 * O motor (`loop.ts`) NÃO é alterado: as duas fases já existem, e o mecanismo
 * de `check` veio pronto do #68.
 *
 * ## Por que o bloqueio LANÇA em vez de devolver `{ ok: false }`
 *
 * O motor tem bloqueio nativo (`exitBehavior: 'end'`), e ele NÃO serve aqui.
 * `recordTurn` grava `state.text = response.text` ANTES de o `check` rodar
 * (`loop.ts`), então um bloqueio nativo encerra a volta com o texto reprovado
 * ainda dentro de `IAgentResult.text`. A proteção passaria a depender de todo
 * consumidor futuro lembrar de olhar `metadata.violation` antes de exibir o
 * texto — e o assistente do cliente (#16, fase 5) herdaria esse esquecimento.
 *
 * Lançando, o texto reprovado não chega a existir no resultado. É o molde do
 * `StructuredOutputError`: ou a saída é válida, ou não há saída.
 *
 * ## O bloqueio é DADO, não só exceção
 *
 * `IModerationBlock` é um valor de primeira classe, e a exceção só o carrega.
 * Hoje a política é matar o run; no dia em que o motor tiver estado durável
 * (recon do plano 19, lacuna 3), um `exitBehavior: 'interrupt'` consome o
 * MESMO shape para pausar e esperar decisão humana, sem reescrever nada disto.
 */

import {
  ALL_MODERATION_CATEGORIES,
  buildModerationMessage,
  DEFAULT_MODERATION_THRESHOLD,
  isModerationCategory,
  MODERATION_STAGES,
  type ModerationCategory,
  type ModerationStage,
} from '../definitions/moderationCatalog';
import { redactText } from './piiRedaction';
import { ConfigError } from '../providers/registry';
import type { ICheckResult, IMiddleware, NMessage, NMessagePart, NResponse } from '../core/types';

// ============== CONSTANTS ==============

export const MODERATION_INPUT_MIDDLEWARE_NAME = 'moderation-input';
export const MODERATION_OUTPUT_MIDDLEWARE_NAME = 'moderation-output';

// ============== TYPES ==============

/** Pontuação por categoria, quando o provider pontua em vez de decidir. */
export type TModerationScores = Partial<Record<ModerationCategory, number>>;

/**
 * O veredito de um provider.
 *
 * `scores` é OPCIONAL porque as famílias de moderação divergem justamente aí:
 * uma lista de termos decide (`flagged`), um classificador hospedado e um juiz
 * LLM pontuam. A porta absorve as duas sem versionar o contrato.
 */
export interface IModerationVerdict {
  flagged: boolean;
  categories: ModerationCategory[];
  scores?: TModerationScores;
}

/**
 * O bloqueio, como valor. Carrega o suficiente para explicar ao usuário, para
 * registrar no trace e — no futuro — para virar checkpoint de human-in-the-loop.
 * Nunca carrega o conteúdo reprovado.
 */
export interface IModerationBlock {
  stage: ModerationStage;
  categories: ModerationCategory[];
  scores?: TModerationScores;
  violationMessage: string;
}

/**
 * A porta. `id` existe para o registry e para o trace dizerem QUEM julgou —
 * sem isso, trocar de provider muda o comportamento sem deixar rastro.
 *
 * 🔴 O `text` que chega aqui já vem REDIGIDO de PII (ver `moderateText`). Um
 * provider remoto é uma saída de dados, e moderação não precisa do CPF para
 * julgar se o texto é impróprio.
 */
export interface IModerationProvider {
  id: string;
  moderate(text: string): Promise<IModerationVerdict>;
}

// ============== ERROR ==============

/**
 * O bloqueio como exceção. `stage` e `categories` são expostos como STRING
 * porque é assim que `describeError` (observability/persistenceHooks.ts) os
 * copia para o payload do step `error` — o trace ganha o motivo estruturado
 * sem que a observabilidade precise conhecer moderação.
 */
export class ModerationBlockedError extends Error {
  override readonly name = 'ModerationBlockedError';
  readonly block: IModerationBlock;
  readonly stage: ModerationStage;
  readonly categories: string;
  readonly violationMessage: string;

  constructor(block: IModerationBlock) {
    super(`Moderation blocked at ${block.stage}: ${block.categories.join(', ') || 'unspecified'}`);
    this.block = block;
    this.stage = block.stage;
    this.categories = block.categories.join(',');
    this.violationMessage = block.violationMessage;
  }
}

// ============== REGISTRY ==============

/**
 * Registry por lookup, no molde de `providers/registry.ts`: registrar um
 * provider de moderação é um `registerModerationProvider`, não um `if` novo no
 * meio do middleware. É por aqui que um classificador hospedado ou um juiz LLM
 * entram sem que este arquivo mude.
 */
const registry = new Map<string, IModerationProvider>();

export function registerModerationProvider(provider: IModerationProvider): void {
  registry.set(provider.id, provider);
}

export function resolveModerationProvider(id: string): IModerationProvider {
  const provider = registry.get(id);
  if (!provider) {
    throw new ConfigError(
      `Unknown moderation provider: "${id}". Registered: [${[...registry.keys()].join(', ')}]`,
    );
  }
  return provider;
}

export function listModerationProviders(): IModerationProvider[] {
  return [...registry.values()];
}

export function clearModerationRegistry(): void {
  registry.clear();
}

// ============== TEXT EXTRACTION ==============

function textOfContent(content: string | NMessagePart[] | undefined): string {
  if (content === undefined) {
    return '';
  }
  if (typeof content === 'string') {
    return content;
  }
  return content
    .filter((part): part is Extract<NMessagePart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join(' ');
}

/**
 * O texto do pedido NOVO, ou string vazia quando não há um.
 *
 * 📌 Só a ÚLTIMA mensagem, e só quando ela é do usuário — o mesmo recorte de
 * `promptOf` (persistenceHooks.ts), pela mesma razão: o histórico só cresce, e
 * moderar o array inteiro reexaminaria a cada turno um conteúdo que já passou.
 * O que é novo numa volta é a última mensagem do usuário.
 */
export function lastUserText(messages: NMessage[]): string {
  const last = messages.at(-1);
  return last?.role === 'user' ? textOfContent(last.content) : '';
}

// ============== VERDICT ==============

/**
 * Quais categorias efetivamente bloqueiam.
 *
 * Quando o provider PONTUA, o limiar decide — nos dois sentidos. Um limiar que
 * só pode endurecer não é limiar, e a tunabilidade é o que impede o guarda de
 * virar ruído e ser desligado. Quando o provider NÃO pontua, `flagged` decide,
 * porque não há número sobre o qual aplicar régua.
 */
export function resolveBlockedCategories(
  { verdict, threshold }: { verdict: IModerationVerdict; threshold: number },
): ModerationCategory[] {
  const { scores } = verdict;
  if (scores) {
    return ALL_MODERATION_CATEGORIES.filter((category) => (scores[category] ?? 0) >= threshold);
  }
  return verdict.flagged ? verdict.categories.filter(isModerationCategory) : [];
}

// ============== APPLICATION ==============

interface IModerateParams {
  provider: IModerationProvider;
  threshold: number;
}

/**
 * Modera um texto e LANÇA se reprovar. Texto vazio nem chega ao provider —
 * não há o que julgar, e uma chamada por volta sem conteúdo seria custo puro
 * no dia em que o provider for remoto.
 */
async function assertAllowed(
  { text, stage, config }: { text: string; stage: ModerationStage; config: IModerateParams },
): Promise<void> {
  if (!text.trim()) {
    return;
  }

  // 🔴 Redige ANTES de entregar ao provider: um provider remoto é saída de
  // dados, e o #359 fechou esse vetor no caminho do modelo — abri-lo de novo
  // aqui seria desfazer conformidade por uma porta lateral.
  const { text: safeText } = redactText(text);
  const verdict = await config.provider.moderate(safeText);
  const categories = resolveBlockedCategories({ verdict, threshold: config.threshold });
  if (categories.length === 0) {
    return;
  }

  const block: IModerationBlock = {
    stage,
    categories,
    violationMessage: buildModerationMessage({ stage, categories }),
  };
  if (verdict.scores) {
    block.scores = verdict.scores;
  }
  throw new ModerationBlockedError(block);
}

// ============== MIDDLEWARE ==============

export interface ICreateModerationParams {
  provider: IModerationProvider;
  /** Régua para providers que pontuam. Ignorado por providers que decidem. */
  threshold?: number;
}

export interface IModerationMiddlewares {
  input: IMiddleware;
  output: IMiddleware;
}

/**
 * As duas entradas da cadeia.
 *
 * 📌 A entrada é `pre-context` e não `pre-model`: `pre-context` roda UMA vez,
 * antes de qualquer chamada ao modelo e antes do retrieval de conhecimento —
 * então conteúdo reprovado não gasta embedding, não gasta busca vetorial e não
 * gasta token. `pre-model` rodaria a cada volta, remoderando o mesmo pedido.
 *
 * 📌 O `transform` da entrada devolve a MESMA referência quando aprova, que é
 * como `runTransforms` reporta `pass` em vez de `transform` (`middleware.ts`).
 * A moderação não muta nada: ela deixa passar ou lança.
 */
export function createModerationMiddlewares(
  { provider, threshold = DEFAULT_MODERATION_THRESHOLD }: ICreateModerationParams,
): IModerationMiddlewares {
  const config: IModerateParams = { provider, threshold };

  return {
    input: {
      name: MODERATION_INPUT_MIDDLEWARE_NAME,
      phase: 'pre-context',
      async transform(messages: NMessage[]): Promise<NMessage[]> {
        await assertAllowed({
          text: lastUserText(messages),
          stage: MODERATION_STAGES.INPUT,
          config,
        });
        return messages;
      },
    },

    output: {
      name: MODERATION_OUTPUT_MIDDLEWARE_NAME,
      phase: 'post-model',
      async check(response: NResponse): Promise<ICheckResult> {
        await assertAllowed({
          text: response.text,
          stage: MODERATION_STAGES.OUTPUT,
          config,
        });
        return { ok: true };
      },
    },
  };
}
