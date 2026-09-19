/**
 * 🔧 assistant — Preset padrão do assistente
 *
 * `name` é `'assistant'` — a MESMA string de `ai_config.agent`, a chave por
 * onde `resolveConfig` acha provider e modelo. Uma segunda grafia criaria uma
 * tradução implícita entre preset e banco, e tradução implícita quebra calada.
 *
 * Aqui mora só a ESTRUTURA — quais sections, sob que condição, em que ordem.
 * O texto é `definitions/assistantPrompt.ts`. Modelo e provider não moram em
 * preset nenhum: quem escolhe é a config.
 */

import { defineAgentPreset } from '../preset';
import type { IPromptContext, IPromptSection } from '../types';
import {
  ASSISTANT_BASE,
  ASSISTANT_DATE_LOCALE,
  ASSISTANT_DATE_OPTIONS,
  ASSISTANT_DEFAULT_OCCUPATION,
  ASSISTANT_PROMPT_HEADINGS,
  ASSISTANT_PROMPT_LABELS,
} from '../../definitions/assistantPrompt';

// ============== CONSTANTS ==============

/** Paridade com `assistant.f.ts` (MAX_TOKENS / MAX_TOOL_LOOPS). */
export const ASSISTANT_MAX_TOKENS = 1500;
export const ASSISTANT_MAX_TOOL_LOOPS = 5;

export const COMPANY_SCOPE = 'company';

// ============== CONTEXT READERS ==============

/**
 * Lê texto do contexto sem `as`. `IPromptContext` é aberto por design (index
 * signature), então o que entra é `unknown` e a checagem tem de ser real —
 * afirmar o tipo aqui só mudaria o lugar onde o erro apareceria.
 */
function readText(context: IPromptContext, key: string): string {
  const value = context[key];
  return typeof value === 'string' ? value : '';
}

/**
 * O relógio entra pelo contexto para o render ser determinístico no teste.
 * Ausente, cai em `new Date()` — que é o comportamento de produção.
 */
function resolveNow(context: IPromptContext): Date {
  const value = context['now'];
  return value instanceof Date ? value : new Date();
}

function hasCompanyFocus(context: IPromptContext): boolean {
  return readText(context, 'scope') === COMPANY_SCOPE && readText(context, 'companyId').length > 0;
}

// ============== SECTION BUILDERS ==============

/**
 * Carimbo de data com precisão de MINUTO, idêntico ao original — e correto.
 *
 * O #372 não removeu o minuto; tirou o minuto de dentro do prefixo cacheável.
 * Como toda section renderiza no bloco volátil por construção
 * (`prompt.ts` → `IRenderedPrompt.stable` é só o `base`), a precisão fina aqui
 * não alcança o breakpoint. Baixá-la para o dia divergiria da fonte sem
 * comprar cache nenhum.
 */
function renderDate(context: IPromptContext): string {
  const formatted = resolveNow(context).toLocaleString(ASSISTANT_DATE_LOCALE, ASSISTANT_DATE_OPTIONS);
  return `${ASSISTANT_PROMPT_HEADINGS.currentContext}\n${ASSISTANT_PROMPT_LABELS.dateTime} ${formatted}`;
}

/** `Preferred style` e `Bio` só entram quando existem — o `.filter(Boolean)` do original. */
function renderIdentity(context: IPromptContext): string {
  const name = readText(context, 'userName');
  const occupation = readText(context, 'userOccupation') || ASSISTANT_DEFAULT_OCCUPATION;
  const lines: string[] = [`User: ${name} (${occupation})`];

  const style = readText(context, 'userStyle');
  if (style.length > 0) { lines.push(`${ASSISTANT_PROMPT_LABELS.preferredStyle} ${style}`); }

  const bio = readText(context, 'userBio');
  if (bio.length > 0) { lines.push(`${ASSISTANT_PROMPT_LABELS.bio}\n${bio}`); }

  return lines.join('\n');
}

function renderScopeLine(context: IPromptContext): string {
  const scope = readText(context, 'scope');
  if (!hasCompanyFocus(context)) { return `${ASSISTANT_PROMPT_LABELS.scope} ${scope}`; }
  const companyId = readText(context, 'companyId');
  return `${ASSISTANT_PROMPT_LABELS.scope} ${scope}${ASSISTANT_PROMPT_LABELS.companyIdSeparator}${companyId}`;
}

/**
 * O texto do escopo chega PRONTO pelo contexto — este builder não consulta
 * banco. `IPromptSection.builder` não recebe conexão, e migrar as queries de
 * `scopeContext`/`companyContext` é do #72; manter o preset puro é o que
 * permite testá-lo inteiro sem subir banco.
 */
function renderScopeContext(context: IPromptContext): string {
  const info = readText(context, 'scopeInfo');
  return `${renderScopeLine(context)}\n${ASSISTANT_PROMPT_HEADINGS.scopeInformation}\n${info}`;
}

function renderCompanyContext(context: IPromptContext): string {
  const info = readText(context, 'companyInfo');
  return `${renderScopeLine(context)}\n${ASSISTANT_PROMPT_HEADINGS.scopeInformation}\n${info}`;
}

/**
 * Instruções por empresa, editáveis pelo super admin (#74).
 *
 * Fica por último e, como toda section, no bloco volátil: um overlay editável
 * dentro do prefixo cacheável daria um prefixo distinto por empresa, e N
 * prefixos que nunca atingem o mínimo de tokens cacheiam pior que um só. Enquanto
 * ninguém preencher `instructions`, o `when` reprova e o prompt sai byte a byte
 * igual ao de hoje.
 */
function renderInstructions(context: IPromptContext): string {
  const instructions = readText(context, 'instructions').trim();
  return `${ASSISTANT_PROMPT_HEADINGS.companyInstructions}\n${instructions}`;
}

// ============== SECTIONS ==============

/** A ordem é a do `assistant.f.ts`: data, identidade, escopo — e o overlay ao fim. */
export const ASSISTANT_SECTIONS: IPromptSection[] = [
  { key: 'date', builder: renderDate },
  { key: 'identity', builder: renderIdentity },
  {
    key: 'scopeContext',
    builder: renderScopeContext,
    when: (context) => !hasCompanyFocus(context),
  },
  {
    key: 'companyContext',
    builder: renderCompanyContext,
    when: hasCompanyFocus,
  },
  {
    key: 'instructions',
    builder: renderInstructions,
    when: (context) => readText(context, 'instructions').trim().length > 0,
  },
];

// ============== PRESET ==============

export const assistantPreset = defineAgentPreset({
  name: 'assistant',
  description: 'Assistente padrão — adapta postura conforme o contexto da empresa',
  systemPrompt: { base: ASSISTANT_BASE, sections: ASSISTANT_SECTIONS },
  defaults: { maxTokens: ASSISTANT_MAX_TOKENS, maxToolLoops: ASSISTANT_MAX_TOOL_LOOPS },
});
