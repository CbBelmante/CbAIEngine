/**
 * 🛡️ middleware — Fases + transform/check
 *
 * `transform` muta contexto (`pre-context` uma vez, `pre-model` a cada volta);
 * `check` bloqueia sobre a resposta (`post-model`). Bloqueio com `'continue'`
 * devolve a violação ao modelo e roda outra volta — é assim que o retry da saída
 * estruturada acontece, sem caminho especial no motor.
 */

import type {
  IAgentConfig,
  ICheckResult,
  IMiddleware,
  IMiddlewareContext,
  NMessage,
  NResponse,
} from './types';
import { createStructuredOutputMiddleware } from './structuredOutput';

// ============== CONSTANTS ==============

/** Sem `exitBehavior` explícito, uma violação encerra: falhar aberto seria pior. */
export const DEFAULT_EXIT_BEHAVIOR: ExitBehavior = 'end';

// ============== TYPES ==============

export type MiddlewarePhase = IMiddleware['phase'];
export type ExitBehavior = NonNullable<IMiddleware['exitBehavior']>;
export type MiddlewareOutcome = 'pass' | 'block' | 'transform';

export interface IMiddlewareViolation {
  middleware: string;
  phase: MiddlewarePhase;
  violationMessage: string;
  exitBehavior: ExitBehavior;
}

export type MiddlewareReporter = (
  report: { name: string; phase: MiddlewarePhase; outcome: MiddlewareOutcome },
) => void | Promise<void>;

// ============== PHASE SELECTION ==============

export function selectByPhase(
  { middleware, phase }: { middleware: IMiddleware[]; phase: MiddlewarePhase },
): IMiddleware[] {
  return middleware.filter((entry) => entry.phase === phase);
}

// ============== TRANSFORM ==============

export async function runTransforms(
  { middleware, phase, messages, report }: {
    middleware: IMiddleware[];
    phase: MiddlewarePhase;
    messages: NMessage[];
    report: MiddlewareReporter;
  },
): Promise<NMessage[]> {
  let current = messages;

  for (const entry of selectByPhase({ middleware, phase })) {
    if (!entry.transform) { continue; }
    const next = await entry.transform(current);
    const outcome: MiddlewareOutcome = next === current ? 'pass' : 'transform';
    current = next;
    await report({ name: entry.name, phase, outcome });
  }

  return current;
}

// ============== CHECK ==============

export async function runChecks(
  { middleware, phase, response, context, report }: {
    middleware: IMiddleware[];
    phase: MiddlewarePhase;
    response: NResponse;
    context: IMiddlewareContext;
    report: MiddlewareReporter;
  },
): Promise<IMiddlewareViolation | null> {
  for (const entry of selectByPhase({ middleware, phase })) {
    if (!entry.check) { continue; }

    const result: ICheckResult = await entry.check(response, context);
    if (result.ok) {
      await report({ name: entry.name, phase, outcome: 'pass' });
      continue;
    }

    await report({ name: entry.name, phase, outcome: 'block' });
    return {
      middleware: entry.name,
      phase,
      // Fallback = nome do middleware: uma violação sem explicação ainda diz
      // QUEM bloqueou, e isso é melhor do que uma mensagem vazia.
      violationMessage: result.message ?? entry.name,
      exitBehavior: entry.exitBehavior ?? DEFAULT_EXIT_BEHAVIOR,
    };
  }

  return null;
}

// ============== CHAIN COMPOSITION ==============

/**
 * A cadeia efetiva do run. O middleware de validação estruturada entra PRIMEIRO
 * quando há `outputSchema`: se a saída não bate com o schema, nada mais adianta
 * examinar naquela volta.
 */
export function buildMiddlewareChain(config: IAgentConfig): IMiddleware[] {
  const chain = [...(config.middleware ?? [])];
  if (config.outputSchema) {
    chain.unshift(createStructuredOutputMiddleware({ schema: config.outputSchema }));
  }
  return chain;
}

/**
 * Devolve a violação ao modelo para a próxima volta — é o retry visto de dentro.
 * Quando houve tool call, a resposta precisa entrar no histórico COM o resultado
 * correspondente: um tool call sem tool result deixa o protocolo inconsistente e
 * o provider recusa a chamada seguinte.
 */
export function appendViolationFeedback(
  { messages, response, message }: { messages: NMessage[]; response: NResponse; message: string },
): NMessage[] {
  const next = [...messages];
  if (response.toolCalls.length === 0) {
    next.push({ role: 'user', content: message });
    return next;
  }

  next.push({ role: 'assistant', content: response.text, toolCalls: response.toolCalls });
  for (const call of response.toolCalls) {
    next.push({ role: 'tool', toolCallId: call.id, content: message });
  }
  return next;
}
