/**
 * 🛡️ structuredOutput — Tool forçada, validação e falha alta
 *
 * A garantia é do motor, não do modelo: `toolChoice` no request apenas PEDE que
 * o modelo chame a tool; o middleware daqui é quem exige que ela tenha sido
 * chamada e que os args batam com o schema. Ou `structured` é válido, ou não há
 * resposta — nunca um objeto que não bate.
 */

import type { IAgentConfig, ICheckResult, IMiddleware, NResponse, NToolCall, NToolDef } from './types';
import { emitHook } from './hooks';
import { formatViolations, validateAgainstSchema } from './jsonSchema';

// ============== CONSTANTS ==============

export const OUTPUT_TOOL_NAME = 'structured_output';
export const OUTPUT_TOOL_DESCRIPTION =
  'Returns the final answer in the required structured format. You MUST call this tool exactly once.';
export const STRUCTURED_OUTPUT_MIDDLEWARE_NAME = 'structured-output-validation';
export const MISSING_OUTPUT_TOOL_MESSAGE =
  `You must answer by calling the "${OUTPUT_TOOL_NAME}" tool. Call it now with the required arguments.`;
export const INVALID_OUTPUT_MESSAGE_PREFIX =
  `The arguments passed to "${OUTPUT_TOOL_NAME}" do not match the required schema. Fix and call it again —`;
export const NO_STRUCTURED_OUTPUT_MESSAGE = 'no valid structured output was produced';

// ============== ERROR ==============

/**
 * Pediu `outputSchema` e o modelo não entregou nada válido dentro do teto.
 * Lança em vez de devolver `structured` ausente: o campo é opcional no tipo, então
 * a ausência é um estado legal que o compilador não denunciaria — a falha só
 * apareceria no consumidor, longe da causa.
 */
export class StructuredOutputError extends Error {
  override readonly name = 'StructuredOutputError';
  readonly violationMessage: string;
  readonly attempts: number;

  constructor({ violationMessage, attempts }: { violationMessage: string; attempts: number }) {
    super(`Structured output failed after ${attempts} attempt(s): ${violationMessage}`);
    this.violationMessage = violationMessage;
    this.attempts = attempts;
  }
}

// ============== TOOL ==============

export function findOutputToolCall(toolCalls: NToolCall[]): NToolCall | undefined {
  return toolCalls.find((call) => call.name === OUTPUT_TOOL_NAME);
}

export function buildOutputToolDef(
  { schema }: { schema: Record<string, unknown> },
): NToolDef {
  return { name: OUTPUT_TOOL_NAME, description: OUTPUT_TOOL_DESCRIPTION, schema };
}

// ============== MIDDLEWARE ==============

export function createStructuredOutputMiddleware(
  { schema }: { schema: Record<string, unknown> },
): IMiddleware {
  return {
    name: STRUCTURED_OUTPUT_MIDDLEWARE_NAME,
    phase: 'post-model',
    // Mismatch não encerra: devolve os erros ao modelo e roda outra volta.
    exitBehavior: 'continue',
    check(response: NResponse): ICheckResult {
      const call = findOutputToolCall(response.toolCalls);
      if (!call) {
        return { ok: false, message: MISSING_OUTPUT_TOOL_MESSAGE };
      }

      const validation = validateAgainstSchema({ value: call.args, schema });
      if (validation.valid) {
        return { ok: true };
      }

      return {
        ok: false,
        message: `${INVALID_OUTPUT_MESSAGE_PREFIX} ${formatViolations(validation.violations)}`,
      };
    },
  };
}

// ============== FALHA ALTA ==============

/** Sem `outputSchema` ou com saída válida, não faz nada; caso contrário, lança. */
export async function assertStructuredOutput(
  { config, structured, lastViolation, attempts }: {
    config: IAgentConfig;
    structured: unknown;
    lastViolation: { violationMessage: string } | null;
    attempts: number;
  },
): Promise<void> {
  if (!config.outputSchema || structured !== undefined) { return; }

  const error = new StructuredOutputError({
    violationMessage: lastViolation?.violationMessage ?? NO_STRUCTURED_OUTPUT_MESSAGE,
    attempts,
  });
  await emitHook({ hooks: config.hooks, name: 'onError', args: [error, 'middleware'] });
  throw error;
}
