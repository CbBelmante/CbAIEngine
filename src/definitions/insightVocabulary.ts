/**
 * 🔧 insightVocabulary — Vocabulário fechado de insights da IA
 *
 * `insight_type` e `status` são vocabulários FECHADOS: valores fixos, nunca
 * texto livre. Cada um vive aqui como array declarativo de objetos ricos, e
 * tudo o que se sabe sobre eles — o tipo TS, a ordem, a chave de i18n, a cor,
 * o ícone — DERIVA daqui.
 *
 * Por que este arquivo existe: a resposta a "este insight é de risco?" ou "está
 * aprovado?" estava destinada a virar literal espalhado (`if (type === 'risk')`,
 * `status === 'approved'`) em stores, componentes de timeline, filtros de fila
 * de aprovação. Com a fonte única, um tipo novo de insight é UMA linha, e quem
 * esquecer de tratá-lo é o compilador que avisa.
 *
 * ⚠️ O banco tem a MESMA lista nos CHECKs de `engine.ai_insights`
 * (`ai_insights_insight_type_check`, `ai_insights_status_check`). Enquanto o
 * vocabulário for enum (e não catálogo em tabela), os lados podem derivar em
 * silêncio — por isso existe `database schema tests`
 * (banco × TS), que falha quando um lado ganha um valor que o outro não tem.
 *
 * Molde: `ticketVocabulary.ts` (ADR-011 §5).
 */

// ============== TYPES ==============

export interface IInsightTypeDef {
  value: string
  /** Rótulo pt-BR curto — usado onde ainda não há i18n (chip, tooltip legado). */
  label: string
  /** Chave i18n do tipo de insight. */
  labelKey: string
  /** Cor do badge/chip de insight — pareada com o componente de timeline. */
  color: string
  /** Ícone Lucide representando o tipo de insight. */
  icon: string
}

export interface IInsightStatusDef {
  value: string
  /** Rótulo pt-BR curto. */
  label: string
  /** Chave i18n do status de insight. */
  labelKey: string
}

// ============== INSIGHT TYPES ==============

/**
 * A ordem do array É a ordem de exibição (prioridade visual: risk primeiro,
 * praise por último). Não reordenar sem alinhar com o design da fila de
 * aprovação.
 *
 * Vocabulário fechado v1 (4 valores) decidido no requirements-packet do plano
 * 16, §8.3 questão 6 — adicionar um 5º valor no futuro é mudança de
 * vocabulário, não redesign.
 */
export const INSIGHT_TYPES = [
  {
    value: 'risk',
    label: 'Risco',
    labelKey: 'dossier.insights.type.risk',
    color: 'var(--red)',
    icon: 'lucide:alert-triangle',
  },
  {
    value: 'action',
    label: 'Ação',
    labelKey: 'dossier.insights.type.action',
    color: 'var(--warning-color-100)',
    icon: 'lucide:zap',
  },
  {
    value: 'rapport',
    label: 'Rapport',
    labelKey: 'dossier.insights.type.rapport',
    color: 'var(--blue-link)',
    icon: 'lucide:heart-handshake',
  },
  {
    value: 'praise',
    label: 'Elogio',
    labelKey: 'dossier.insights.type.praise',
    color: 'var(--success-color-100)',
    icon: 'lucide:thumbs-up',
  },
] as const satisfies readonly IInsightTypeDef[];

export type InsightType = typeof INSIGHT_TYPES[number]['value']

// ============== INSIGHT STATUS ==============

/**
 * A ordem do array É a ordem do fluxo de aprovação: suggested → approved ou
 * dismissed. O `status` é a coluna que rege a fila de aprovação (só
 * `suggested` alimenta a fila; `approved` vira evento na timeline; `dismissed`
 * some da UI).
 */
export const INSIGHT_STATUSES = [
  {
    value: 'suggested',
    label: 'Sugerido',
    labelKey: 'dossier.insights.status.suggested',
  },
  {
    value: 'approved',
    label: 'Aprovado',
    labelKey: 'dossier.insights.status.approved',
  },
  {
    value: 'dismissed',
    label: 'Descartado',
    labelKey: 'dossier.insights.status.dismissed',
  },
] as const satisfies readonly IInsightStatusDef[];

export type InsightStatus = typeof INSIGHT_STATUSES[number]['value']

// ============== LOOKUP ==============

const TYPE_BY_VALUE = new Map<string, IInsightTypeDef>(
  INSIGHT_TYPES.map(t => [t.value, t]),
);

const STATUS_BY_VALUE = new Map<string, IInsightStatusDef>(
  INSIGHT_STATUSES.map(s => [s.value, s]),
);

/** Definição do tipo de insight, ou `undefined` se o valor não pertence ao vocabulário. */
export function insightTypeDef(type: string | null | undefined): IInsightTypeDef | undefined {
  return type ? TYPE_BY_VALUE.get(type) : undefined;
}

/** Definição do status de insight, ou `undefined` se o valor não pertence ao vocabulário. */
export function insightStatusDef(status: string | null | undefined): IInsightStatusDef | undefined {
  return status ? STATUS_BY_VALUE.get(status) : undefined;
}

// ============== LISTAS DERIVADAS ==============

export const INSIGHT_TYPE_VALUES = INSIGHT_TYPES.map(t => t.value);
export const INSIGHT_STATUS_VALUES = INSIGHT_STATUSES.map(s => s.value);
