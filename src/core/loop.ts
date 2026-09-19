/**
 * 🔧 loop — Motor genérico de tool-use, agnóstico de provider
 *
 * A volta: `pre-model` → `adapter.chat` → `post-model` → executa as tools →
 * repete, até `maxToolLoops`. O motor não sabe quem atende: só conhece
 * `IProviderAdapter.chat` e trafega `NMessage`/`NToolCall`/`NResponse` já
 * normalizados. E não persiste nada — emite por hooks, quem escuta decide.
 */

import type {
  IAgentConfig,
  IAgentResult,
  IChatRequest,
  IMiddleware,
  IMiddlewareContext,
  IProviderAdapter,
  IRunUsage,
  IToolContext,
  NMessage,
  NResponse,
  NToolCall,
  NToolDef,
  NUsage,
} from './types';
import { emitHook } from './hooks';
import {
  appendViolationFeedback,
  buildMiddlewareChain,
  type IMiddlewareViolation,
  type MiddlewareReporter,
  runChecks,
  runTransforms,
} from './middleware';
import { assertStructuredOutput, findOutputToolCall, OUTPUT_TOOL_NAME } from './structuredOutput';
import { buildToolDefs, executeToolCall, type IToolCallRecord } from './toolRunner';

// ============== CONSTANTS ==============

/** Paridade com `assistant.f.ts` (MAX_TOOL_LOOPS). Teto de voltas E de retries. */
export const DEFAULT_MAX_TOOL_LOOPS = 5;
/** Paridade com `assistant.f.ts` (MAX_TOKENS). */
export const DEFAULT_MAX_TOKENS = 1500;

// ============== TYPES ==============

export interface ITurnRecord {
  index: number;
  finishReason: NResponse['finishReason'];
  text: string;
  usage: NUsage;
  toolCalls: IToolCallRecord[];
  validationErrors?: string[];
}

export interface IAgentRunIdentity {
  id: string;
  /** Rótulo opaco só para carimbar `IRunUsage.provider`. Nunca é lido pelo motor. */
  provider: string;
  agent: string;
}

export interface IProviderCredentials {
  apiKey: string;
  baseUrl?: string;
}

export interface IRunAgentLoopParams {
  config: IAgentConfig;
  adapter: IProviderAdapter;
  /** System prompt JÁ renderizado — o template é responsabilidade de quem chama. */
  system: string;
  messages: NMessage[];
  toolContext: IToolContext;
  credentials: IProviderCredentials;
  run: IAgentRunIdentity;
}

interface ILoopState {
  messages: NMessage[];
  turns: ITurnRecord[];
  usage: NUsage;
  text: string;
  toolCalls: NToolCall[];
  structured?: unknown;
  violation?: IMiddlewareViolation;
}

// ============== HELPERS ==============

function buildChatRequest(
  { config, system, messages, tools, credentials }: {
    config: IAgentConfig;
    system: string;
    messages: NMessage[];
    tools: NToolDef[];
    credentials: IProviderCredentials;
  },
): IChatRequest {
  const request: IChatRequest = {
    model: config.model,
    system,
    messages,
    tools,
    maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    apiKey: credentials.apiKey,
  };
  if (credentials.baseUrl !== undefined) { request.baseUrl = credentials.baseUrl; }
  // Pede ao provider que force a tool; quem GARANTE é o middleware de validação.
  if (config.outputSchema) { request.toolChoice = OUTPUT_TOOL_NAME; }
  if (config.params) { request.params = config.params; }
  return request;
}

function accumulateUsage(total: NUsage, turn: NUsage): void {
  total.promptTokens += turn.promptTokens;
  total.completionTokens += turn.completionTokens;
  total.totalTokens += turn.totalTokens;
}

function buildResult(
  { state, run, config, startedAt }: {
    state: ILoopState;
    run: IAgentRunIdentity;
    config: IAgentConfig;
    startedAt: number;
  },
): IAgentResult {
  const usage: IRunUsage = {
    ...state.usage,
    provider: run.provider,
    model: config.model,
    // Pricing é dos hooks de persistência — o motor entrega os tokens crus.
    costUsd: null,
    latencyMs: Date.now() - startedAt,
    invocations: state.turns.length,
  };

  const metadata: Record<string, unknown> = { turns: state.turns };
  if (state.violation) { metadata['violation'] = state.violation; }

  const result: IAgentResult = { text: state.text, toolCalls: state.toolCalls, usage, metadata };
  if (state.structured !== undefined) { result.structured = state.structured; }
  return result;
}

// ============== TURN STEPS ==============

async function callModel(
  { adapter, request, hooks }: {
    adapter: IProviderAdapter;
    request: IChatRequest;
    hooks: IAgentConfig['hooks'];
  },
): Promise<NResponse> {
  await emitHook({ hooks, name: 'onModelCall', args: [request] });
  try {
    const response = await adapter.chat(request);
    await emitHook({ hooks, name: 'onModelResponse', args: [response] });
    return response;
  } catch (error) {
    // Falha de provider é falha real: observada e propagada. O fail-soft é dos
    // hooks, não do caminho crítico.
    await emitHook({ hooks, name: 'onError', args: [error, 'model'] });
    throw error;
  }
}

async function evaluateResponse(
  { middleware, response, context, report, hooks }: {
    middleware: IMiddleware[];
    response: NResponse;
    context: IMiddlewareContext;
    report: MiddlewareReporter;
    hooks: IAgentConfig['hooks'];
  },
): Promise<IMiddlewareViolation | null> {
  try {
    return await runChecks({ middleware, phase: 'post-model', response, context, report });
  } catch (error) {
    await emitHook({ hooks, name: 'onError', args: [error, 'middleware'] });
    throw error;
  }
}

function recordTurn(
  { state, index, response }: { state: ILoopState; index: number; response: NResponse },
): ITurnRecord {
  const turn: ITurnRecord = {
    index,
    finishReason: response.finishReason,
    text: response.text,
    usage: response.usage,
    toolCalls: [],
  };
  state.turns.push(turn);
  accumulateUsage(state.usage, response.usage);
  if (response.text) { state.text = response.text; }
  return turn;
}

async function runToolCalls(
  { calls, config, toolContext, turn }: {
    calls: NToolCall[];
    config: IAgentConfig;
    toolContext: IToolContext;
    turn: ITurnRecord;
  },
): Promise<NMessage[]> {
  const messages: NMessage[] = [];
  for (const call of calls) {
    const executed = await executeToolCall({ call, config, toolContext });
    turn.toolCalls.push(executed.record);
    messages.push({ role: 'tool', toolCallId: call.id, content: executed.content });
  }
  return messages;
}

// ============== ENGINE ==============

export async function runAgentLoop(params: IRunAgentLoopParams): Promise<IAgentResult> {
  const { config, adapter, system, credentials, run, toolContext } = params;
  const hooks = config.hooks;
  const startedAt = Date.now();

  await emitHook({ hooks, name: 'onRunStart', args: [run.id, config] });

  const middleware = buildMiddlewareChain(config);
  const tools = buildToolDefs(config);
  const maxToolLoops = config.maxToolLoops ?? DEFAULT_MAX_TOOL_LOOPS;
  const context: IMiddlewareContext = { userId: toolContext.userId, agent: run.agent };
  const report: MiddlewareReporter = ({ name, phase, outcome }) =>
    emitHook({ hooks, name: 'onMiddleware', args: [name, phase, outcome] });

  const state: ILoopState = {
    // Cópia: o histórico do chamador é entrada, não área de trabalho do motor.
    messages: [...params.messages],
    turns: [],
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    text: '',
    toolCalls: [],
  };

  state.messages = await runTransforms({ middleware, phase: 'pre-context', messages: state.messages, report });

  let lastViolation: IMiddlewareViolation | null = null;
  let turnIndex = 0;

  while (turnIndex < maxToolLoops) {
    turnIndex++;
    state.messages = await runTransforms({ middleware, phase: 'pre-model', messages: state.messages, report });

    const request = buildChatRequest({ config, system, messages: state.messages, tools, credentials });
    const response = await callModel({ adapter, request, hooks });
    const turn = recordTurn({ state, index: turnIndex, response });

    lastViolation = await evaluateResponse({ middleware, response, context, report, hooks });
    if (lastViolation) {
      turn.validationErrors = [lastViolation.violationMessage];
      if (lastViolation.exitBehavior === 'end') {
        state.violation = lastViolation;
        break;
      }
      state.messages = appendViolationFeedback({
        messages: state.messages,
        response,
        message: lastViolation.violationMessage,
      });
      continue;
    }

    const outputCall = findOutputToolCall(response.toolCalls);
    if (outputCall) {
      state.structured = outputCall.args;
      state.toolCalls.push(outputCall);
      break;
    }

    const actionable = response.toolCalls.filter((call) => call.name !== OUTPUT_TOOL_NAME);
    if (response.finishReason !== 'tool' || actionable.length === 0) { break; }

    state.toolCalls.push(...actionable);
    state.messages = [...state.messages, { role: 'assistant', content: response.text, toolCalls: actionable }];
    state.messages.push(...await runToolCalls({ calls: actionable, config, toolContext, turn }));
  }

  await assertStructuredOutput({
    config,
    structured: state.structured,
    lastViolation,
    attempts: turnIndex,
  });

  const result = buildResult({ state, run, config, startedAt });
  await emitHook({ hooks, name: 'onRunEnd', args: [run.id, result] });
  return result;
}
