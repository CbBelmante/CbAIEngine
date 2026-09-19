/**
 * 🔧 prompt — Renderer de `IPromptTemplate`, com a fronteira do cache no TIPO
 *
 * O prompt caching é prefix match: um único byte volátil antes do breakpoint
 * invalida o cache inteiro, e paga-se o write a 1,25× sem nunca ler a 0,1×
 * (`core/ai/promptCache.ts`). A defesa aqui não é disciplina — é forma.
 *
 * `renderTemplate` devolve um PAR, `{ stable, volatile }`, e não uma string
 * concatenada. `stable` É `template.base`, atribuído direto: não existe caminho
 * de escrita de uma section para ele. Toda section — inclusive a de data, que é
 * volátil por natureza — só alcança `volatile`. Vazar conteúdo volátil para o
 * prefixo cacheável deixa de ser um descuido possível e passa a ser algo que
 * não se consegue escrever.
 *
 * O par tem de propósito a forma exata de `IBuildSystemBlocksParams`, então
 * `buildSystemBlocks(rendered)` compila sem adaptador: o acoplamento ao
 * breakpoint fica no compilador, não num comentário que envelhece.
 */

import type { IPromptContext, IPromptSection, IPromptTemplate } from './types';

// ============== TYPES ==============

/**
 * Prompt renderizado em duas metades. Espelha `IBuildSystemBlocksParams` de
 * `core/ai/promptCache.ts` — o consumidor repassa direto.
 */
export interface IRenderedPrompt {
  /** Idêntico entre requests. É o `template.base`, e recebe o breakpoint de cache. */
  stable: string;
  /** Sections aplicáveis, na ordem declarada. Muda a cada request; nunca recebe breakpoint. */
  volatile: string;
}

// ============== CONSTANTS ==============

/**
 * Junta as sections com uma quebra simples, reproduzindo o `.join('\n')` que
 * `assistant/assistant.f.ts` usa hoje ao montar o bloco volátil na unha.
 * O espaçamento entre blocos vem do `\n` que cada builder já traz no início do
 * seu cabeçalho — mesma forma do original.
 */
export const SECTION_SEPARATOR = '\n';

// ============== HELPERS ==============

/**
 * `systemPrompt` é `string | IPromptTemplate`, uma união que o validador de
 * JSON Schema do #68 não cobre (`anyOf` está fora do limite declarado dele), e
 * por isso a discriminação vive aqui, em TypeScript, onde é exata.
 */
export function isPromptTemplate(prompt: string | IPromptTemplate): prompt is IPromptTemplate {
  return typeof prompt !== 'string';
}

function shouldRenderSection(
  { section, context }: { section: IPromptSection; context: IPromptContext },
): boolean {
  // Section sem `when` é incondicional — a ausência do predicado é o predicado.
  return section.when ? section.when(context) : true;
}

// ============== RENDER ==============

/**
 * Renderiza as sections aplicáveis contra o contexto.
 *
 * Builder que devolve string vazia é descartado em vez de virar linha em
 * branco: um `when` verdadeiro com conteúdo ausente produziria um separador
 * órfão, e o prompt deixaria de bater byte a byte com o original.
 */
export async function renderSections(
  { sections, context }: { sections: IPromptSection[]; context: IPromptContext },
): Promise<string> {
  const rendered: string[] = [];
  for (const section of sections) {
    if (!shouldRenderSection({ section, context })) { continue; }
    const text = await section.builder(context);
    if (text.length > 0) { rendered.push(text); }
  }
  return rendered.join(SECTION_SEPARATOR);
}

/**
 * Renderiza o template inteiro. `stable` recebe `template.base` e mais nada —
 * é a garantia estrutural que este módulo existe para prender.
 */
export async function renderTemplate(
  { template, context }: { template: IPromptTemplate; context: IPromptContext },
): Promise<IRenderedPrompt> {
  const volatilePart = await renderSections({ sections: template.sections, context });
  return { stable: template.base, volatile: volatilePart };
}

/**
 * Renderiza `systemPrompt` seja qual for a forma. String pura é tratada como
 * template sem sections: TUDO nela é estável, que é o comportamento correto —
 * quem escreveu uma constante não pediu interpolação nenhuma.
 */
export async function renderPrompt(
  { prompt, context }: { prompt: string | IPromptTemplate; context: IPromptContext },
): Promise<IRenderedPrompt> {
  if (!isPromptTemplate(prompt)) {
    return { stable: prompt, volatile: '' };
  }
  return await renderTemplate({ template: prompt, context });
}

/**
 * Achata o par para o `system: string` que `runAgentLoop` consome hoje.
 *
 * A junção acontece no ÚLTIMO instante possível, e de propósito: enquanto o
 * `IChatRequest.system` for uma string plana, o motor não tem onde colocar o
 * breakpoint — mas o par sobrevive intacto até aqui, pronto para
 * `buildSystemBlocks` no dia em que o adapter aceitar blocos (#72).
 */
export function joinRenderedPrompt(rendered: IRenderedPrompt): string {
  if (rendered.volatile.length === 0) { return rendered.stable; }
  return `${rendered.stable}\n${rendered.volatile}`;
}
