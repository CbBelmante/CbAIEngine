/**
 * 🔧 assistantVocabulary — Vocabulário fechado do módulo de assistente
 *
 * Vocabulários FECHADOS: `assistant_messages.role`. Valores fixos, nunca texto
 * livre. Vive aqui como array declarativo de objetos ricos, e tudo o que se sabe
 * sobre ele — o tipo TS, a ordem, a chave de i18n — DERIVA daqui.
 *
 * Por que este arquivo existe: roles de mensagem aparecem em componentes de chat,
 * filtros de histórico, debug de IA. Sem a fonte única, cada um inventaria a lista
 * de novo. Com a fonte única, é UMA linha, e quem esquecer de tratá-la é o
 * compilador que avisa.
 *
 * ⚠️ O banco tem a MESMA lista no CHECK de `engine.assistant_messages`
 * (`assistant_messages_role_check`). Enquanto o vocabulário for enum (e não
 * catálogo em tabela), os lados podem derivar em silêncio — por isso existe
 * `database schema tests` (banco × TS), que falha quando um
 * lado ganha um valor que o outro não tem.
 *
 * Molde: `ticketVocabulary.ts` (ADR-011 §5).
 */

// ============== TYPES ==============

export interface IMessageRoleDef {
  value: string
  /** Rótulo pt-BR curto. */
  label: string
  /** Chave i18n do role de mensagem. */
  labelKey: string
}

// ============== MESSAGE ROLES ==============

/**
 * Roles de mensagem no assistente (user, assistant, tool).
 *
 * A ordem do array reflete a ordem de exibição no histórico de chat.
 */
export const MESSAGE_ROLES = [
  {
    value: 'user',
    label: 'Usuário',
    labelKey: 'assistant.role.user',
  },
  {
    value: 'assistant',
    label: 'Assistente',
    labelKey: 'assistant.role.assistant',
  },
  {
    value: 'tool',
    label: 'Tool',
    labelKey: 'assistant.role.tool',
  },
] as const satisfies readonly IMessageRoleDef[];

export type MessageRole = typeof MESSAGE_ROLES[number]['value']

// ============== LOOKUP HELPER ==============

const ROLE_BY_VALUE = new Map<string, IMessageRoleDef>(
  MESSAGE_ROLES.map(r => [r.value, r]),
);

/** Definição do role de mensagem, ou `undefined` se o valor não pertence ao vocabulário. */
export function messageRoleDef(role: string | null | undefined): IMessageRoleDef | undefined {
  return role ? ROLE_BY_VALUE.get(role) : undefined;
}

// ============== LISTAS DERIVADAS ==============

/** Array dos valores literais de roles de mensagem (pra validação, CHECKs). */
export const MESSAGE_ROLE_VALUES = MESSAGE_ROLES.map(r => r.value);
