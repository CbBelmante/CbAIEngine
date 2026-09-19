/**
 * 🌐 insightWriter — A ÚNICA porta de escrita de `ai_insights`
 *
 * 🔴 SUPERFÍCIE COMPARTILHADA, não peça de uma função. Dois pipelines geram
 * insight sobre a mesma empresa — `meeting` (a partir do resumo de
 * uma reunião) e `analyze` (agregando sinal de conversa) — e
 * antes disto não existia escritor: existia o vocabulário, e a promessa de que
 * cada um escreveria certo. Duas verdades sobre a mesma tabela é como se perde a
 * regra que só um dos dois lados lembrou.
 *
 * Mora em `core/ai/` e não em `_common/`, e a distinção é de contrato (ADR-013
 * §L7): `_common/` é o motor que VIAJA para outro projeto; `core/` é a fiação
 * com ESTE banco. Este arquivo conhece `ai_insights` coluna por coluna — é
 * `core/`, ao lado de `aiPort.ts` e dos runtimes.
 *
 * ── O que ele EXIGE de quem chama ────────────────────────────────────────────
 *   · `companyId` e `entityId` não-vazios;
 *   · `entityType` no vocabulário fechado (`company | thread | ticket | meeting`);
 *   · `source` no vocabulário de origens;
 *   · cada draft com `insightType` do vocabulário e `title` não-vazio.
 *
 * ── O que ele GARANTE ────────────────────────────────────────────────────────
 *   · `status='suggested'` e `reviewed_by`/`reviewed_at` NULOS — SEMPRE, e nunca
 *     do chamador. É o CHECK `ai_insights_review_consistency` (016) escrito em
 *     código: deixar o chamador escolher o status seria oferecer-lhe a chance de
 *     violar a constraint e receber um `23514` sem nome. "IA sugere, humano
 *     aprova" não é opção de configuração.
 *   · `visibility='internal'` — nenhum pipeline do v1 publica para o portal.
 *   · draft inválido é REJEITADO E CONTADO, nunca descartado em silêncio, e não
 *     derruba os irmãos válidos da mesma leva.
 *   · erro do banco LANÇA. Não devolve resultado parcial parecendo sucesso: quem
 *     chamou é que sabe o que fazer com a falha (no pipeline de reunião ela vira
 *     `sync_error`, que é o que alguém vai ler).
 *   · leva vazia não vai ao banco; leva de N vira UM insert, não N idas.
 *
 * ── Como um segundo chamador usa ─────────────────────────────────────────────
 *   await writeInsights({
 *     db: engine,
 *     target: { companyId, entityType: INSIGHT_ENTITY_TYPE.COMPANY, entityId: companyId },
 *     origin: { source: INSIGHT_SOURCE.CONVERSATION_ANALYSIS, sourceId: threadId },
 *     drafts,
 *   })
 *
 * O adapter entra por parâmetro (`IAiDbAdapter`), nunca é criado aqui — é o que
 * permite exercitar a porta inteira contra um duplo em memória.
 */

import {
  AI_INSIGHTS_TABLE,
  INSIGHT_CONTENT_MAX_CHARS,
  INSIGHT_STATUS,
  INSIGHT_TITLE_MAX_CHARS,
  INSIGHT_VISIBILITY,
  isInsightEntityType,
  isInsightSource,
  isInsightType,
} from '../definitions/insightConfig';
import type {
  InsightEntityType,
  InsightSource,
  InsightType,
} from '../definitions/insightConfig';
import type { IAiDbAdapter } from '../dbAdapter/dbAdapter';

// ============== TYPES ==============

/** Um insight proposto. Sem `status`, sem `visibility` — esses são do escritor. */
export interface IInsightDraft {
  insightType: InsightType;
  title: string;
  content?: string | null;
}

/** A entidade que o insight DESCREVE. */
export interface IInsightTarget {
  companyId: string;
  entityType: InsightEntityType;
  entityId: string;
}

/** Quem GEROU o insight — rastreabilidade, e a chave do dedup de reprocessamento. */
export interface IInsightOrigin {
  source: InsightSource;
  sourceId?: string | null;
}

export interface IWriteInsightsParams {
  adapter: IAiDbAdapter;
  target: IInsightTarget;
  origin: IInsightOrigin;
  drafts: readonly IInsightDraft[];
}

/** Um draft que não entrou, com o motivo — para quem chamou poder relatar. */
export interface IRejectedDraft {
  index: number;
  reason: string;
}

export interface IWriteInsightsResult {
  /** Ids efetivamente inseridos. */
  written: string[];
  /** Drafts recusados na porta. Vazio é o caso normal. */
  rejected: IRejectedDraft[];
}

/** Levantado quando o ALVO é inválido — erro de programação de quem chama, não de dado. */
export class InsightTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsightTargetError';
  }
}

// ============== VALIDAÇÃO DO ALVO ==============

/**
 * O alvo é do CHAMADOR, não do modelo — um `entityType` fora do vocabulário aqui
 * é bug de código, e bug de código não vira linha rejeitada num relatório: vira
 * exceção, alta e cedo, antes de qualquer ida ao banco.
 */
function assertTarget({ target, origin }: { target: IInsightTarget; origin: IInsightOrigin }): void {
  const problems: string[] = [];

  if (!target.companyId?.trim()) { problems.push('companyId is required'); }
  if (!target.entityId?.trim()) { problems.push('entityId is required'); }
  if (!isInsightEntityType(target.entityType)) {
    problems.push(`entityType '${target.entityType}' is not in the closed vocabulary`);
  }
  if (!isInsightSource(origin.source)) {
    problems.push(`source '${origin.source}' is not in the closed vocabulary`);
  }

  if (problems.length > 0) {
    throw new InsightTargetError(`Invalid insight target: ${problems.join('; ')}`);
  }
}

// ============== VALIDAÇÃO DO DRAFT ==============

/** O motivo da recusa, ou `null` quando o draft passa. */
function rejectionReason(draft: IInsightDraft): string | null {
  if (!isInsightType(draft.insightType)) {
    return `insightType '${draft.insightType}' is not in the closed vocabulary`;
  }
  if (!draft.title?.trim()) {
    return 'title is empty';
  }
  return null;
}

// ============== MONTAGEM DA LINHA ==============

/**
 * A linha do banco, em snake_case — a única fronteira onde o app deixa de ser
 * camelCase.
 *
 * Os quatro campos que o chamador NÃO fornece estão aqui, literais e juntos, de
 * propósito: é a garantia do arquivo, e ela tem de ser legível de uma vez.
 */
function toInsightRow(
  { draft, target, origin }: {
    draft: IInsightDraft;
    target: IInsightTarget;
    origin: IInsightOrigin;
  },
): Record<string, unknown> {
  const content = draft.content?.trim();

  return {
    company_id: target.companyId,
    entity_type: target.entityType,
    entity_id: target.entityId,
    insight_type: draft.insightType,
    title: draft.title.trim().slice(0, INSIGHT_TITLE_MAX_CHARS),
    content: content ? content.slice(0, INSIGHT_CONTENT_MAX_CHARS) : null,
    source: origin.source,
    source_id: origin.sourceId ?? null,
    // As quatro garantias. Não são default: são invariantes.
    status: INSIGHT_STATUS.SUGGESTED,
    visibility: INSIGHT_VISIBILITY.INTERNAL,
    reviewed_by: null,
    reviewed_at: null,
  };
}

// ============== PORTA ==============

export async function writeInsights(
  { adapter, target, origin, drafts }: IWriteInsightsParams,
): Promise<IWriteInsightsResult> {
  assertTarget({ target, origin });

  const rejected: IRejectedDraft[] = [];
  const rows: Array<Record<string, unknown>> = [];

  for (const [index, draft] of drafts.entries()) {
    const reason = rejectionReason(draft);
    if (reason) {
      rejected.push({ index, reason });
      continue;
    }
    rows.push(toInsightRow({ draft, target, origin }));
  }

  if (rows.length === 0) {
    return { written: [], rejected };
  }

  const written = await adapter.insertInsights(rows);
  return { written, rejected };
}

// ============== DEDUP DE REPROCESSAMENTO ==============

/**
 * Este `source` já escreveu para este `source_id`?
 *
 * Existe porque reprocessar é rotina: uma reunião que falhou DEPOIS de escrever
 * os insights volta na passada seguinte, e sem esta pergunta escreveria a
 * segunda cópia dos mesmos cartões na fila de aprovação de um humano.
 *
 * A pergunta é do CHAMADOR e não do escritor de propósito: só ele sabe se
 * reescrever é duplicar (reunião reprocessada) ou é o trabalho esperado (uma
 * análise periódica que acumula leituras ao longo do tempo). O índice
 * `idx_ai_insights_source (source, source_id)` existe justamente para isto.
 *
 * 🔴 `since` é o que separa os dois casos, e a ausência dele NÃO é neutra.
 *
 * Sem `since` a pergunta é "já escreveu ALGUMA VEZ", e a origem fica trancada
 * para sempre depois do primeiro cartão. Isso é correto para uma origem que
 * acontece UMA vez — a reunião gravada não volta a acontecer. É ruína para uma
 * origem RECORRENTE: uma conversa reanalisada todo dia geraria o seu primeiro
 * insight e nunca mais falaria, mesmo meses depois, quando o cliente ameaçasse
 * sair. O guarda anti-duplicata viraria guarda anti-feature.
 *
 * Com `since`, a pergunta vira "já escreveu DESDE tal instante", e a origem
 * volta a poder falar quando a janela vence — sem repetir o mesmo cartão na
 * fila enquanto ela não venceu.
 */
export async function hasInsightsFrom(
  { adapter, origin, since }: {
    adapter: IAiDbAdapter;
    origin: IInsightOrigin;
    /** Instante ISO a partir do qual a pergunta vale. Ausente = desde sempre. */
    since?: string | null;
  },
): Promise<boolean> {
  if (!origin.sourceId) { return false; }

  return adapter.hasInsightsFrom({
    source: origin.source,
    sourceId: origin.sourceId,
    since,
  });
}
