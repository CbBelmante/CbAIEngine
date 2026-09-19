/**
 * 🔧 toolRunner — Execução de uma tool call, sem caminho de exceção
 *
 * Nada aqui lança: tool inexistente, negada por `allowedWhen` ou com handler
 * quebrado vira tool result de erro que volta ao modelo, que então responde
 * graciosamente em vez de o run morrer com exceção opaca. O erro do handler não
 * é engolido — sai por `onError` antes de virar resultado.
 */

import type { IAgentConfig, IToolContext, IToolDef, IToolOutput, NToolCall, NToolDef } from './types';
import { emitHook } from './hooks';
import { buildOutputToolDef } from './structuredOutput';

// ============== CONSTANTS ==============

/** Tool result maior que isto é truncado antes de voltar ao contexto. */
export const TOOL_RESULT_MAX_CHARS = 8000;
export const UNKNOWN_TOOL_MESSAGE_PREFIX = 'Unknown tool:';
export const TOOL_ERROR_MESSAGE_PREFIX = 'Tool execution failed:';
export const TOOL_NOT_ALLOWED_FALLBACK = 'This tool is not available in the current context.';

// ============== TYPES ==============

export interface IToolCallRecord {
  name: string;
  durationMs: number;
  /** Tamanho do resultado que volta ao contexto — vira prompt token na volta seguinte. */
  resultChars: number;
  isError: boolean;
}

export interface IExecutedToolCall {
  record: IToolCallRecord;
  content: string;
}

interface IToolExecutionParams {
  call: NToolCall;
  config: IAgentConfig;
  toolContext: IToolContext;
}

// ============== TOOL DEFINITIONS ==============

function toNeutralToolDef(def: IToolDef): NToolDef {
  return { name: def.name, description: def.description, schema: def.schema };
}

export function buildToolDefs(config: IAgentConfig): NToolDef[] {
  const defs = (config.tools ?? []).map(toNeutralToolDef);
  if (config.outputSchema) {
    defs.push(buildOutputToolDef({ schema: config.outputSchema }));
  }
  return defs;
}

// ============== EXECUTION ==============

function resolveNotAllowedMessage(
  { def, toolContext }: { def: IToolDef; toolContext: IToolContext },
): string {
  if (typeof def.onNotAllowed === 'function') { return def.onNotAllowed(toolContext); }
  return def.onNotAllowed ?? TOOL_NOT_ALLOWED_FALLBACK;
}

async function resolveToolOutput(
  { call, config, toolContext }: IToolExecutionParams,
): Promise<IToolOutput> {
  const def = (config.tools ?? []).find((entry) => entry.name === call.name);
  if (!def) {
    return { content: `${UNKNOWN_TOOL_MESSAGE_PREFIX} ${call.name}`, isError: true };
  }
  if (def.allowedWhen && !def.allowedWhen(toolContext)) {
    return { content: resolveNotAllowedMessage({ def, toolContext }), isError: true };
  }

  try {
    return await def.handler(call.args, toolContext);
  } catch (error) {
    await emitHook({ hooks: config.hooks, name: 'onError', args: [error, 'tool'] });
    return { content: `${TOOL_ERROR_MESSAGE_PREFIX} ${String(error)}`, isError: true };
  }
}

export async function executeToolCall(
  { call, config, toolContext }: IToolExecutionParams,
): Promise<IExecutedToolCall> {
  const hooks = config.hooks;
  await emitHook({ hooks, name: 'onToolCall', args: [call.name, call.args] });

  const startedAt = Date.now();
  const output = await resolveToolOutput({ call, config, toolContext });
  const durationMs = Date.now() - startedAt;

  await emitHook({ hooks, name: 'onToolResult', args: [call.name, output] });

  const content = output.content.slice(0, TOOL_RESULT_MAX_CHARS);
  return {
    record: {
      name: call.name,
      durationMs,
      resultChars: content.length,
      isError: output.isError === true,
    },
    content,
  };
}
