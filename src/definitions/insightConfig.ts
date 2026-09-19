/**
 * 🔧 insightConfig — Os quatro vocabulários fechados de `engine.ai_insights`
 *
 * Espelho declarativo dos CHECK constraints da migration `016_ai_insights.sql`.
 * O teste `database schema tests` confronta os dois
 * lados — banco e TypeScript — e quebra se um mudar sem o outro.
 *
 * ⚠️ O teste SQL trava QUATRO CHECKs (`insight_type`, `status`, `entity_type`,
 * `visibility`), mas até aqui o lado TypeScript só conhecia os dois primeiros
 * (`insightVocabulary.ts`, que é o array rico da UI: cor, ícone, i18n). Os
 * outros dois viviam só como literal no banco — um `entity_type` errado saía do
 * código, chegava no banco e voltava como `23514` genérico. Este arquivo fecha
 * essa metade.
 *
 * Divisão de trabalho, no molde de `knowledgeConfig.ts` × `knowledgeVocabulary.ts`:
 * aqui moram as CONSTANTES DE MÁQUINA (o que o código compara e escreve) e os
 * guards; lá mora o array rico que a tela pinta.
 */

// ============== INSIGHT TYPE ==============

/** `rapport | risk | action | praise` — o array rico vive em `insightVocabulary.ts`. */
export const INSIGHT_TYPE = {
  RAPPORT: 'rapport',
  RISK: 'risk',
  ACTION: 'action',
  PRAISE: 'praise',
} as const satisfies Record<string, string>;

export type InsightType = typeof INSIGHT_TYPE[keyof typeof INSIGHT_TYPE];

// ============== STATUS ==============

/**
 * Ciclo de aprovação: `suggested` → `approved` | `dismissed`.
 *
 * 🔴 Quem ESCREVE insight só pode escrever `suggested`. O CHECK
 * `ai_insights_review_consistency` (016) exige `reviewed_by`/`reviewed_at`
 * preenchidos nos outros dois, e esses dois campos são de quem REVISOU — um
 * pipeline de IA não tem revisor para carimbar. É o princípio "IA sugere,
 * humano aprova" (ADR-012 Decisão 2) escrito como constraint.
 */
export const INSIGHT_STATUS = {
  SUGGESTED: 'suggested',
  APPROVED: 'approved',
  DISMISSED: 'dismissed',
} as const satisfies Record<string, string>;

export type InsightStatus = typeof INSIGHT_STATUS[keyof typeof INSIGHT_STATUS];

// ============== ENTITY TYPE ==============

/**
 * O discriminador da FK polimórfica. `entity_id` é referência SOFT (não
 * enforced): aponta para `companies`/`threads`/`tickets`/`meeting_records`
 * conforme este valor.
 */
export const INSIGHT_ENTITY_TYPE = {
  COMPANY: 'company',
  THREAD: 'thread',
  TICKET: 'ticket',
  MEETING: 'meeting',
} as const satisfies Record<string, string>;

export type InsightEntityType = typeof INSIGHT_ENTITY_TYPE[keyof typeof INSIGHT_ENTITY_TYPE];

// ============== VISIBILITY ==============

/**
 * `internal` = só staff. `portal` = o cliente também vê — e ainda assim só
 * depois de aprovado (a RLS do portal exige os DOIS: `visibility='portal'` E
 * `status='approved'`).
 *
 * Nenhum pipeline do v1 escreve `portal`: a coluna existe como fundação para a
 * fase em que o cliente terá insights próprios.
 */
export const INSIGHT_VISIBILITY = {
  INTERNAL: 'internal',
  PORTAL: 'portal',
} as const satisfies Record<string, string>;

export type InsightVisibility = typeof INSIGHT_VISIBILITY[keyof typeof INSIGHT_VISIBILITY];

// ============== SOURCE ==============

/**
 * Quem GEROU o insight. `source` é texto livre no banco (não há CHECK), mas
 * texto livre entre dois pipelines é como dois nomes para a mesma coisa: o
 * índice `idx_ai_insights_source` existe justamente para responder "o que este
 * pipeline já escreveu", e ele só responde certo se os dois lados grafarem
 * igual.
 *
 * `source_id` é o id de QUEM GEROU, não da entidade descrita — um insight de
 * `entity_type='company'` nascido de reunião tem `source='meeting-summary'` e
 * `source_id` apontando para `meeting_records.id`.
 */
export const INSIGHT_SOURCE = {
  /** `engine-process-meeting` — resumo de reunião gravada. */
  MEETING_SUMMARY: 'meeting-summary',
  /** `engine-analyze-conversations` — agregação de sinal de conversa. */
  CONVERSATION_ANALYSIS: 'conversation-analysis',
} as const satisfies Record<string, string>;

export type InsightSource = typeof INSIGHT_SOURCE[keyof typeof INSIGHT_SOURCE];

// ============== TABLES ==============

export const AI_INSIGHTS_TABLE = 'ai_insights';

// ============== LIMITS ==============

/**
 * `title` é `text` no banco (sem limite), mas o insight é um CARTÃO numa fila de
 * aprovação — título que não cabe no cartão não é título, é conteúdo no lugar
 * errado. O corte acontece no escritor, não na tela, porque a tela não é o único
 * consumidor.
 */
export const INSIGHT_TITLE_MAX_CHARS = 120;

export const INSIGHT_CONTENT_MAX_CHARS = 2000;

/**
 * Teto de insights que UM run pode escrever.
 *
 * Sem teto, um modelo prolixo transforma uma reunião de 40 minutos em 30 cartões
 * e afoga a fila de aprovação — que é humana, e é o gargalo real da feature.
 */
export const INSIGHTS_PER_RUN_MAX = 5;

// ============== GUARDS ==============

export function isInsightType(value: unknown): value is InsightType {
  return typeof value === 'string'
    && (Object.values(INSIGHT_TYPE) as string[]).includes(value);
}

export function isInsightEntityType(value: unknown): value is InsightEntityType {
  return typeof value === 'string'
    && (Object.values(INSIGHT_ENTITY_TYPE) as string[]).includes(value);
}

export function isInsightVisibility(value: unknown): value is InsightVisibility {
  return typeof value === 'string'
    && (Object.values(INSIGHT_VISIBILITY) as string[]).includes(value);
}

export function isInsightSource(value: unknown): value is InsightSource {
  return typeof value === 'string'
    && (Object.values(INSIGHT_SOURCE) as string[]).includes(value);
}
