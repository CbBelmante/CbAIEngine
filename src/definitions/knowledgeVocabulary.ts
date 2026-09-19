/**
 * 🔧 knowledgeVocabulary — Vocabulário fechado da base de conhecimento vetorial
 *
 * `sync_status` e `content_format` são vocabulários FECHADOS: valores fixos,
 * nunca texto livre. Cada um vive aqui como array declarativo de objetos ricos,
 * e tudo o que se sabe sobre eles — o tipo TS, a ordem, a chave de i18n, a cor,
 * o ícone — DERIVA daqui.
 *
 * Por que este arquivo existe: a resposta a "esta entrada está sincronizada?" ou
 * "o conteúdo é markdown?" estava destinada a virar literal espalhado
 * (`if (status === 'synced')`, `format === 'markdown'`) em stores, componentes
 * de curadoria, fila de sincronização. Com a fonte única, um status novo é UMA
 * linha, e quem esquecer de tratá-lo é o compilador que avisa.
 *
 * ⚠️ O banco tem a MESMA lista nos CHECKs de `engine.ai_knowledge_entries`
 * (`ai_knowledge_entries_sync_check`, `ai_knowledge_entries_format_check`).
 * Enquanto o vocabulário for enum (e não catálogo em tabela), os lados podem
 * derivar em silêncio — por isso existe
 * `database schema tests` (banco × TS), que falha
 * quando um lado ganha um valor que o outro não tem.
 *
 * Molde: `ticketVocabulary.ts` (padrão de vocabulário fechado do projeto).
 */

// ============== TYPES ==============

export interface ISyncStatusDef {
  value: string
  /** Rótulo pt-BR curto — usado onde ainda não há i18n. */
  label: string
  /** Chave i18n do status de sincronização. */
  labelKey: string
  /** Cor do badge/chip de status. */
  color: string
  /** Ícone Lucide representando o estado. */
  icon: string
  /** É um estado final? (synced/failed não muda mais sem intervenção). */
  isFinal: boolean
}

export interface IContentFormatDef {
  value: string
  /** Rótulo pt-BR curto. */
  label: string
  /** Chave i18n do formato. */
  labelKey: string
}

// ============== SYNC STATUS ==============

/**
 * A ordem do array reflete o fluxo de sincronização:
 * pending → processing → synced (ou failed).
 *
 * Vocabulário fechado v1 (4 valores) decidido no erd-blueprint.md §2.3 do plano
 * 11 — adicionar um 5º valor no futuro é mudança de vocabulário, não redesign.
 */
export const SYNC_STATUSES = [
  {
    value: 'pending',
    label: 'Pendente',
    labelKey: 'knowledge.syncStatus.pending',
    color: 'var(--gray)',
    icon: 'lucide:clock',
    isFinal: false,
  },
  {
    value: 'processing',
    label: 'Processando',
    labelKey: 'knowledge.syncStatus.processing',
    color: 'var(--blue-link)',
    icon: 'lucide:loader',
    isFinal: false,
  },
  {
    value: 'synced',
    label: 'Sincronizado',
    labelKey: 'knowledge.syncStatus.synced',
    color: 'var(--green)',
    icon: 'lucide:check-circle',
    isFinal: true,
  },
  {
    value: 'failed',
    label: 'Erro',
    labelKey: 'knowledge.syncStatus.failed',
    color: 'var(--red)',
    icon: 'lucide:alert-circle',
    isFinal: true,
  },
] as const satisfies readonly ISyncStatusDef[];

/** Array dos valores puros (para type narrowing). */
export const SYNC_STATUS_VALUES = SYNC_STATUSES.map((s) => s.value);

/** Type derivado (união literal dos valores). */
export type TSyncStatus = (typeof SYNC_STATUSES)[number]['value']

// ============== CONTENT FORMAT ==============

/**
 * Formato do conteúdo da entrada. Markdown é o padrão (suporta formatação rica),
 * text é fallback para conteúdo puro.
 */
export const CONTENT_FORMATS = [
  {
    value: 'markdown',
    label: 'Markdown',
    labelKey: 'knowledge.contentFormat.markdown',
  },
  {
    value: 'text',
    label: 'Texto',
    labelKey: 'knowledge.contentFormat.text',
  },
] as const satisfies readonly IContentFormatDef[];

/** Array dos valores puros (para type narrowing). */
export const CONTENT_FORMAT_VALUES = CONTENT_FORMATS.map((f) => f.value);

/** Type derivado (união literal dos valores). */
export type TContentFormat = (typeof CONTENT_FORMATS)[number]['value']

// ============== VISIBILITY ==============

export interface IVisibilityDef {
  value: string
  /** Rótulo pt-BR curto. */
  label: string
  /** Chave i18n da visibilidade. */
  labelKey: string
  /** Descrição do que cada visibilidade significa. */
  description: string
}

/**
 * Controle de visibilidade de conhecimento (padrão ai_insights).
 *
 * internal = só staff interno vê (padrão)
 * portal = cliente do portal também vê (se da sua empresa)
 */
export const VISIBILITY_VALUES = [
  {
    value: 'internal',
    label: 'Interno',
    labelKey: 'knowledge.visibility.internal',
    description: 'Somente staff interno pode ver',
  },
  {
    value: 'portal',
    label: 'Portal',
    labelKey: 'knowledge.visibility.portal',
    description: 'Cliente do portal também pode ver (se da sua empresa)',
  },
] as const satisfies readonly IVisibilityDef[];

/** Array dos valores puros (para type narrowing). */
export const VISIBILITY_KEYS = VISIBILITY_VALUES.map((v) => v.value);

/** Type derivado (união literal dos valores). */
export type TVisibility = (typeof VISIBILITY_VALUES)[number]['value']

// ============== HELPERS ==============

/** Resolve definição do sync_status pelo valor. */
export function getSyncStatusDef(value: TSyncStatus): ISyncStatusDef | undefined {
  return SYNC_STATUSES.find((s) => s.value === value);
}

/** Resolve definição do content_format pelo valor. */
export function getContentFormatDef(value: TContentFormat): IContentFormatDef | undefined {
  return CONTENT_FORMATS.find((f) => f.value === value);
}

/** Esta entrada está em estado final? (synced ou failed, não muda mais sem intervenção). */
export function isSyncFinal(status: TSyncStatus): boolean {
  return getSyncStatusDef(status)?.isFinal ?? false;
}

/** Esta entrada está sincronizada e pronta para busca? */
export function isSynced(status: TSyncStatus): boolean {
  return status === 'synced';
}

/** Esta entrada falhou na sincronização? */
export function isSyncFailed(status: TSyncStatus): boolean {
  return status === 'failed';
}

/** Esta entrada está aguardando ou processando embedding? */
export function isSyncInProgress(status: TSyncStatus): boolean {
  return status === 'pending' || status === 'processing';
}

/** Resolve definição da visibility pelo valor. */
export function getVisibilityDef(value: TVisibility): IVisibilityDef | undefined {
  return VISIBILITY_VALUES.find((v) => v.value === value);
}

/** Esta entrada é visível para o cliente do portal? */
export function isVisibleToPortal(visibility: TVisibility): boolean {
  return visibility === 'portal';
}

/** Esta entrada é só para staff interno? */
export function isInternalOnly(visibility: TVisibility): boolean {
  return visibility === 'internal';
}

// ============== DEFAULTS DE COLUNA ==============

/**
 * Valores default das colunas de ai_knowledge_entries.
 *
 * Esses valores são os defaults do banco (migration 021) e do código (quando a
 * entrada é criada sem especificar). Manter os dois lados sincronizados evita
 * que o código assuma um default diferente do que o banco aplica.
 *
 * ATENÇÃO: Se mudar aqui, DEVE mudar na the database migration e
 * rodar o teste `database schema tests` pra validar sincronia.
 */
export const KNOWLEDGE_DEFAULTS = {
  /**
   * Formato padrão do conteúdo.
   *
   * Markdown é o padrão porque suporta formatação rica (listas, negrito, links)
   * e é o que o agente consome nativamente. Text é o fallback pra conteúdo puro.
   */
  content_format: 'markdown' as TContentFormat,

  /**
   * Status inicial de sincronização.
   *
   * Toda entrada nasce 'pending' (aguardando embedding) e a edge function
   * engine-embed a processa assincronamente até chegar em 'synced' ou 'failed'.
   */
  sync_status: 'pending' as TSyncStatus,

  /**
   * Prioridade padrão (sem destaque).
   *
   * Prioridade 0 = documento comum. Valores positivos elevam o score combinado
   * na busca (quanto maior, mais relevante). Não há máximo técnico, mas valores
   * práticos ficam entre 0-100.
   */
  priority: 0,

  /**
   * Categoria reservada do sistema por padrão?
   *
   * false = categoria comum (editável pela UI). true = categoria reservada
   * (agent-memories), não editável pela UI comum, gerenciada por edge functions.
   */
  is_system: false,

  /**
   * Visibilidade padrão (somente interno).
   *
   * internal = só staff vê (padrão, seguro). portal = cliente do portal também vê
   * (se da sua empresa). Seguindo o princípio "o que o cliente não deve ver não
   * desce pro navegador dele" (CLAUDE.md), o padrão é sempre internal.
   */
  visibility: 'internal' as TVisibility,
} as const;

/** Type derivado (garante que KNOWLEDGE_DEFAULTS é readonly). */
export type TKnowledgeDefaults = typeof KNOWLEDGE_DEFAULTS
