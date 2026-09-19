/**
 * 🔧 assistantContract — O contrato HTTP do `engine-assistant`, um lugar só
 *
 * Kernel compartilhado entre a edge function e o front, no molde de
 * `ticketVocabulary.ts`: vive em `_common/` porque o sandbox do Deno só monta
 * `the edge function`, e o Vite alcança `_common/` — o edge nunca alcançaria
 * `src/`. `src/types/engine.ts` importa daqui em vez de redeclarar, e
 * `tests/functions/assistant/contract.test.ts` prova que as duas pontas não
 * derivaram.
 *
 * ⚠️ **camelCase, ponta a ponta.** O `ASSISTANT_ARCHITECTURE.md` documentava o
 * contrário — que o payload sairia em snake e o front converteria com `toApp()`.
 * Essa conversão nunca existiu neste caminho (`useEdgeTransport.ts` recebia o
 * `contextUpdate` com um `as` seco), e o resultado é que o card de conversas não
 * renderizava, a agenda do briefing sumia e o `change-scope` não navegava. O
 * contrato passa a ser o que o front sempre esperou, e este arquivo é a razão de
 * não poder divergir de novo.
 *
 * O snake permanece onde ele é de fato o contrato: no `schema` das tools, que é
 * o que o MODELO lê, e cujos nomes o prompt do agente cita.
 */

// ============== SCOPES ==============

export const ASSISTANT_SCOPES = ['company', 'briefing', 'today', 'pending', 'general'] as const;

export type AssistantScope = typeof ASSISTANT_SCOPES[number];

export function isAssistantScope(value: string): value is AssistantScope {
  return (ASSISTANT_SCOPES as readonly string[]).includes(value);
}

// ============== COMPANY STAGES ==============

/**
 * Estágios CS que as tools `list_companies` e `suggest_stage_change` declaram
 * ao modelo no `enum` do schema.
 *
 * Kernel duplicado de propósito: a camada rica é `definitions/clientConfig.ts`
 * (`CLIENT_STAGES`, com `labelKey` e cor), mas ela importa por alias do Vite
 * (`@appTypes/client`) e o sandbox do Deno não resolve alias — a edge function
 * nunca conseguiria carregá-la. As duas listas não podem divergir, e é
 * `tests/functions/assistant/contract.test.ts` que impede, comparando-as valor
 * a valor. Mesmo arranjo de `ticketVocabulary.ts`.
 */
export const COMPANY_STAGES = ['onboarding', 'stable', 'expansion', 'at_risk', 'churned'] as const;

export type CompanyStage = typeof COMPANY_STAGES[number];

// ============== CARD PAYLOADS ==============

export interface ICompanyCard {
  id: string;
  name: string;
  stage: string | null;
}

export interface IThreadCard {
  id: string;
  companyName: string;
  externalContactName: string;
  channel: string;
  lastMessageAt: string | null;
  unreadCount: number;
}

export interface ITicketCard {
  id: string;
  title: string;
  status: string;
  companyName: string | null;
  createdAt: string;
}

export interface IBriefingEvent {
  title: string;
  time: string | null;
  companyName?: string | null;
}

export interface IEventCard {
  id: string;
  title: string;
  date: string | null;
  time: string | null;
  type: string;
  status: string;
  companyName?: string | null;
  ownerName?: string | null;
}

// ============== CONTEXT UPDATE ==============

/** Card pintado na conversa. O front recebe no máximo UM por resposta — o último. */
export type CardInline =
  | {
    type: 'briefing';
    pending: number;
    orphans: number;
    atRisk: number;
    summary: string;
    todayEvents?: IBriefingEvent[];
  }
  | { type: 'company-list'; title: string; companies: ICompanyCard[] }
  | { type: 'dossier'; companyId: string; companyName: string; tab?: string }
  | { type: 'thread-list'; title: string; threads: IThreadCard[] }
  | { type: 'ticket-list'; title: string; tickets: ITicketCard[] }
  | { type: 'event-list'; title: string; events: IEventCard[] }
  | { type: 'change-scope'; scope: AssistantScope; companyId?: string; companyName?: string };

// ============== SUGGESTIONS ==============

/**
 * `applied`/`dismissed`/`error` são estado do FRONT — o store os escreve depois
 * que o CS decide. A edge function nunca os emite, e é por isso que são
 * opcionais aqui em vez de morarem num tipo separado.
 */
export type Suggestion =
  | {
    type: 'reply_thread';
    threadId: string;
    companyName: string;
    externalContactName: string;
    channel: string;
    text: string;
    applied?: boolean;
    dismissed?: boolean;
    error?: string;
  }
  | {
    type: 'change_stage';
    companyId: string;
    companyName: string;
    currentStage: string | null;
    target: string;
    reason: string;
    applied?: boolean;
    dismissed?: boolean;
    error?: string;
  }
  | {
    type: 'create_ticket';
    companyId: string;
    companyName: string;
    title: string;
    description: string;
    priority: string;
    applied?: boolean;
    dismissed?: boolean;
    error?: string;
  };

// ============== HTTP CONTRACT ==============

export interface IAssistantRequest {
  scope: AssistantScope;
  message: string;
  /** Obrigatório quando `scope === 'company'`; ignorado nos demais. */
  companyId?: string;
}

export interface IAssistantResponse {
  threadId: string;
  reply: string;
  contextUpdate?: CardInline;
  suggestions?: Suggestion[];
  /**
   * `true` quando a volta saiu SEM consultar a base de conhecimento porque a
   * config de embedding recusou (`ConfigError`: sem `ai_config` do agente
   * `embedding`, sem credencial, ou provider que não implementa `embed`).
   *
   * 🔴 NÃO é "buscou e não achou nada" — esse é estado legítimo e continua
   * mudo. Este campo existe porque a degradação do RAG é DESENHO
   * (`AI_KNOWLEDGE_ARCHITECTURE`: nunca derruba a conversa), e desenho que o
   * operador não enxerga vira chave esquecida: o chat responde com cara de
   * certo, sem conhecimento nenhum, e o erro morre no log do servidor.
   *
   * Ausente no caminho feliz — quem não usa RAG não ganha campo novo.
   */
  knowledgeUnavailable?: true;
}
