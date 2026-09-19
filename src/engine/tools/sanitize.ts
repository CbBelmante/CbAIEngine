/**
 * 🔐 sanitize — Defesa contra injeção no filtro `.or()` do PostgREST
 *
 * ⚠️ Isto é SEGURANÇA, não formatação.
 *
 * O filtro `.or()` do PostgREST recebe uma STRING com sintaxe própria: `,`
 * separa condições, `()` agrupam, `*` é wildcard e `\` escapa. Duas tools
 * (`list_companies`, `search_company`) interpolam texto que veio do usuário —
 * via modelo — dentro dessa string. Sem a limpeza, uma busca por
 * `ACME,id.eq.<uuid>` deixa de ser uma busca e vira uma condição arbitrária
 * escolhida por quem digitou.
 *
 * A defesa é remover os metacaracteres antes da interpolação, e não escapá-los:
 * o PostgREST não expõe um escape de valor para este filtro, então a única
 * saída correta é o termo não conter sintaxe nenhuma.
 *
 * Provado por `tests/functions/assistant/sanitizeFilterTerm.test.ts`, que
 * asserta a STRING entregue ao `.or()` — não o resultado da query. O resultado
 * dependeria do servidor; a string é o que carrega o ataque.
 */

// ============== CONSTANTS ==============

/** `,` separa condições · `()` agrupam · `*` é wildcard · `\` escapa. */
export const POSTGREST_FILTER_METACHARACTERS = /[,()*\\]/g;

// ============== SANITIZER ==============

export function sanitizeFilterTerm(raw: string): string {
  return raw.replace(POSTGREST_FILTER_METACHARACTERS, '').trim();
}
