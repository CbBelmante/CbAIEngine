/**
 * 🔧 context — O contexto das tools do assistente, o coletor e `defineAssistantTool`
 *
 * O motor entrega às tools um `IToolContext` aberto (`types.ts`) e espera de
 * volta um `IToolOutput` — `{ content: string }`. O assistente precisa de mais
 * duas coisas que esse contrato não carrega: o card (`contextUpdate`) e a
 * sugestão (`suggestion`) que vão para o FRONT, não para o modelo.
 *
 * A saída delas é o COLETOR, que viaja dentro do contexto. É o desenho que o
 * `AGENT_TYPES_ARCHITECTURE.md` previu ao manter `IAgentResult.metadata` como
 * `Record<string, unknown>`: o domínio do CbAIEngine não vaza no contrato genérico —
 * ele anda por fora, num campo que só as tools do assistente conhecem.
 *
 * `defineAssistantTool` é o adaptador entre os dois mundos, e é ele que também
 * grava `assistant_messages` — a persistência que hoje mora solta dentro do
 * laço de `assistant.f.ts` fica num lugar só, igual para as 17.
 */

import { defineTool } from '../../core/tools';
import type { IToolContext, IToolDef, IToolOutput } from '../../core/types';
import type { CardInline, Suggestion } from '../../definitions/assistantContract';
import type { IMemoryWriter } from '../memoryWriter';
import type { IAiDbAdapter } from '../../dbAdapter/dbAdapter';

// ============== CONSTANTS ==============

export const INTERNAL_ONLY_MESSAGE =
  'This tool is available to the Volan internal team only. Tell the user you cannot run it for them.';

/** Tabela onde cada chamada de tool vira uma linha de trilha. */
export const TOOL_MESSAGES_TABLE = 'assistant_messages';

// ============== COLLECTOR ==============

/**
 * O front recebe UM `contextUpdate` (o último a chegar) e TODAS as sugestões —
 * exatamente o que `assistant.f.ts` faz hoje com `lastContextUpdate` e o array
 * `suggestions`. A regra do "último vence" mora aqui para não se repetir em
 * dezessete lugares.
 */
export interface IAssistantCollector {
  collect(output: IAssistantToolResult): void;
  lastContextUpdate(): CardInline | undefined;
  suggestions(): Suggestion[];
}

export function createAssistantCollector(): IAssistantCollector {
  let lastCard: CardInline | undefined;
  const collected: Suggestion[] = [];

  return {
    collect({ contextUpdate, suggestion }: IAssistantToolResult): void {
      if (contextUpdate) { lastCard = contextUpdate; }
      if (suggestion) { collected.push(suggestion); }
    },
    lastContextUpdate: (): CardInline | undefined => lastCard,
    suggestions: (): Suggestion[] => [...collected],
  };
}

// ============== CONTEXT ==============

export interface IAssistantToolContext extends IToolContext {
  adapter: IAiDbAdapter;
  threadId: string;
  isInternal: boolean;
  collector: IAssistantCollector;
  memory: IMemoryWriter;
}

/**
 * Discriminação real em vez de `as`: `IToolContext` é aberto por design (index
 * signature), então o que chega é `unknown` e afirmar o tipo só mudaria o lugar
 * onde o erro apareceria.
 */
export function isAssistantToolContext(context: IToolContext): context is IAssistantToolContext {
  return typeof context['threadId'] === 'string'
    && typeof context['isInternal'] === 'boolean'
    && context['collector'] !== undefined
    && context['memory'] !== undefined
    && context['adapter'] !== undefined;
}

export class AssistantToolContextError extends Error {
  override readonly name = 'AssistantToolContextError';
}

export function assertAssistantToolContext(context: IToolContext): IAssistantToolContext {
  if (!isAssistantToolContext(context)) {
    throw new AssistantToolContextError('Assistant tool ran without adapter/threadId/isInternal/collector/memory');
  }
  return context;
}

// ============== GUARDS ==============

/**
 * As tools de visão global respondem sobre a carteira inteira — toda a base de
 * empresas, todas as conversas, todos os tickets. O RLS já filtra o que cada
 * um enxerga, então isto não fecha vazamento: fecha a AMBIGUIDADE de um usuário
 * de portal receber uma resposta vazia como se fosse a verdade do negócio dele.
 * Negada, a tool devolve texto ao modelo e a conversa segue (`toolRunner.ts`).
 */
export function isInternalStaff(context: IToolContext): boolean {
  return context['isInternal'] === true;
}

// ============== TOOL DEFINITION ==============

export interface IAssistantToolResult {
  /** Volta ao MODELO, serializado. Mesmo objeto que `runTool` devolve hoje. */
  result: unknown;
  /** Vai ao FRONT como card inline. Nunca ao modelo. */
  contextUpdate?: CardInline;
  /** Vai ao FRONT como sugestão a confirmar. Nunca ao modelo. */
  suggestion?: Suggestion;
}

export interface IAssistantToolSpec {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  category: IToolDef['category'];
  scope?: string[];
  requiresConfirmation?: boolean;
  allowedWhen?(context: IToolContext): boolean;
  onNotAllowed?: string | ((context: IToolContext) => string);
  run(input: Record<string, unknown>, context: IAssistantToolContext): Promise<IAssistantToolResult>;
}

/**
 * Grava a chamada em `assistant_messages`. Falha de trilha NÃO derruba a tool:
 * o usuário perderia a resposta por causa de uma linha de auditoria, e o
 * resultado já foi produzido. Mesmo princípio fail-soft de `hooks.ts` — e o
 * erro é logado, nunca engolido.
 */
async function recordToolMessage(
  { context, name, input, result }: {
    context: IAssistantToolContext;
    name: string;
    input: Record<string, unknown>;
    result: unknown;
  },
): Promise<void> {
  try {
    await context.adapter.recordToolMessage({
      threadId: context.threadId,
      role: 'tool',
      content: null,
      toolName: name,
      toolInput: input,
      toolResult: result,
    });
  } catch (error) {
    console.error('[assistant:tool_message]', name, error);
  }
}

/**
 * Detecta o erro que os handlers já devolvem hoje (`{ result: { error: … } }`)
 * para carimbar `isError` no trace do #70. O que volta ao modelo é idêntico —
 * o mesmo JSON —, então isto acrescenta sinal à observabilidade sem mudar
 * comportamento.
 */
function hasErrorShape(result: unknown): boolean {
  return typeof result === 'object'
    && result !== null
    && 'error' in result
    && (result as { error: unknown }).error !== undefined;
}

export function defineAssistantTool(spec: IAssistantToolSpec): IToolDef {
  const { run, ...metadata } = spec;

  return defineTool({
    ...metadata,
    async handler(input: Record<string, unknown>, context: IToolContext): Promise<IToolOutput> {
      const assistantContext = assertAssistantToolContext(context);
      const output = await run(input, assistantContext);

      assistantContext.collector.collect(output);
      await recordToolMessage({ context: assistantContext, name: spec.name, input, result: output.result });

      const toolOutput: IToolOutput = { content: JSON.stringify(output.result) };
      if (hasErrorShape(output.result)) { toolOutput.isError = true; }
      return toolOutput;
    },
  });
}
