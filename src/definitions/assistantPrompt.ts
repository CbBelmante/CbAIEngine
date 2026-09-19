/**
 * 🔧 assistantPrompt — Conteúdo do prompt do assistente do CbAIEngine
 *
 * Só CONTEÚDO: o bloco estável e os literais que os builders costuram. A
 * estrutura — quais sections existem, sob que condição cada uma entra — é do
 * preset (`_common/agent/presets/assistant.ts`). O corte é por natureza: aqui
 * não há predicado nem composição, e é por isso que isto é uma definition.
 *
 * ⚠️ Espelha `the edge function/assistant.f.ts` enquanto a
 * edge function não migra para o motor (#72). Os dois lados poderiam derivar em
 * silêncio, então `tests/functions/agent/assistantPromptParity.test.ts` lê o
 * `assistant.f.ts` como TEXTO e falha se uma das metades mudar sozinha — mesma
 * doutrina do `assistantVocabulary.ts` ao lado, que se compara com o CHECK do
 * banco.
 *
 * O `ASSISTANT_BASE` é o PREFIXO CACHEÁVEL (`core/ai/promptCache.ts`): tem de
 * ser byte-idêntico entre requests. Nada volátil — data, usuário, empresa —
 * entra aqui; tudo isso é section, e section nunca alcança o prefixo.
 */

// ============== STABLE BASE ==============

/**
 * Recebe o breakpoint de cache. A seção `TOOLS:` descreve por NOME o
 * comportamento das tools do agente, inclusive a guarda de que `suggest_*`
 * jamais executa ação destrutiva sem card — por isso este texto é código sob
 * revisão, e não um campo que a tela edita.
 */
export const ASSISTANT_BASE = `You are an AI assistant. Adapt your behavior based on the context provided below.

STYLE:
- PT-BR direct, concise. No "great question!", no emojis.
- Short by default. Bullets only if 3+ items.

STANCE:
- Proactive: if info is missing, ask ONE clarifying question.
- Honest: if you don't have the data, say so. Don't make things up.

TOOLS:
- Always prefer tool over guessing.
- list_*, search_*, daily_summary: already paint card in chat -- your reply summarizes and points ("see the list below"), don't repeat everything.
- focus_company(id): changes sidebar to company X (loads its perpetual thread). Use when user asks to "focus/work on X".
- suggest_*: creates card for user to confirm. Do NOT execute destructive actions without card.
- mark_read: direct execution, no card.`;

// ============== VOLATILE HEADINGS ==============

/**
 * Cabeçalhos do bloco volátil. O `\n` inicial é parte do literal no original
 * (`\n## CURRENT CONTEXT`), e não um detalhe de formatação: é ele que produz a
 * linha em branco de separação quando as sections são unidas com `\n`.
 */
export const ASSISTANT_PROMPT_HEADINGS = {
  currentContext: '\n## CURRENT CONTEXT',
  scopeInformation: '\n## SCOPE INFORMATION',
  /** Instruções por empresa (#74). Só existe aqui; ainda sem escritor. */
  companyInstructions: '\n## COMPANY INSTRUCTIONS',
} as const;

// ============== VOLATILE LINE FORMATS ==============

/** Locale e fuso do carimbo de data. Idênticos ao `assistant.f.ts`. */
export const ASSISTANT_DATE_LOCALE = 'pt-BR';
export const ASSISTANT_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: 'America/Sao_Paulo',
  dateStyle: 'full',
  timeStyle: 'short',
};

export const ASSISTANT_PROMPT_LABELS = {
  dateTime: 'Date/time:',
  preferredStyle: 'Preferred style:',
  bio: 'Bio:',
  scope: 'Scope:',
  companyIdSeparator: ' - company_id=',
} as const;

/** Fallback de ocupação quando `engine.users.occupation` está vazio. */
export const ASSISTANT_DEFAULT_OCCUPATION = 'cs';
