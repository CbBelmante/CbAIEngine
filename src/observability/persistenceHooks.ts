/**
 * 🔧 persistenceHooks — A POLÍTICA que escuta o motor e grava o que aconteceu
 *
 * O motor entrega o MECANISMO (`hooks.ts`: emissão read-only e fail-soft) e não
 * persiste nada. Aqui mora a política: um `IAgentHooks` que se pluga por config
 * e escreve em `ai_agent_runs`, `ai_invocations` e `ai_run_steps`. O motor roda
 * igual sem estes hooks — é o que prova o desacoplamento.
 *
 * Uso: `createAgent({ …, overrides: { hooks: createPersistenceHooks({ … }) } })`,
 * com o MESMO `runId` que vai em `agent.run()`.
 */

import {
  RUN_STATUSES,
  RUN_TRIGGERS,
  type RunTrigger,
  STEP_TYPES,
} from '../definitions/aiObservability';
import type { IAgentHooks, IChatRequest, IToolOutput, NMessage, NResponse } from '../core/types';
import { createRunRecorder, reportPersistenceFailure, type RunRecorder } from './runRecorder';
import type { DbRow, IObservabilityDb } from './types';

// ============== TYPES ==============

export interface ICreatePersistenceHooksParams {
  db: IObservabilityDb;
  /** O MESMO id que o motor recebe em `IAgentRunIdentity.id` — é ele que amarra invocações e steps. */
  runId: string;
  /** `IAgentPreset.name`, a mesma chave de `ai_config.agent`. */
  agent: string;
  /** `IChatRequest` não carrega provider; ele vem de quem resolveu a config. */
  provider: string;
  companyId?: string;
  trigger?: RunTrigger;
  cronJobId?: string;
  /**
   * O recorder do run, quando quem chama precisa do MESMO — é o caso de um
   * middleware que grava passo próprio (`stepSink.ts`): o `seq` é um contador
   * por run, e um recorder paralelo recomeçaria do 1 e embaralharia a timeline
   * do drill-down. Ausente, os hooks criam o seu, como sempre fizeram.
   */
  recorder?: RunRecorder;
}

// ============== ERROR SHAPE ==============

/**
 * Campos estruturados que os erros de domínio do módulo já expõem.
 *
 * `stage` e `categories` vêm do `ModerationBlockedError`: sem eles o trace
 * registraria QUE bloqueou mas não em que ponta nem por quê, e a auditoria de
 * moderação viraria leitura de string de mensagem. Entram aqui, e não num
 * ramo `instanceof`, para que a observabilidade siga sem conhecer moderação —
 * o mesmo motivo pelo qual `status` e `attempts` já estavam nesta lista.
 */
const ERROR_DETAIL_KEYS = ['status', 'attempts', 'toolName', 'stage', 'categories'] as const;

/**
 * Descreve o erro SEM inventar taxonomia: `ProviderHttpError`, `ProviderParseError`
 * e `StructuredOutputError` já se identificam por `name` e expõem os próprios campos.
 * A leitura é estrutural em vez de `instanceof` para não acoplar a observabilidade
 * aos adapters — e para que um erro futuro com `status` seja capturado sem alteração.
 */
export function describeError(error: unknown): DbRow {
  if (!(error instanceof Error)) {
    return { name: 'UnknownError', message: String(error) };
  }

  const described: DbRow = { name: error.name, message: error.message };
  for (const key of ERROR_DETAIL_KEYS) {
    const value: unknown = Reflect.get(error, key);
    if (typeof value === 'number' || typeof value === 'string') {
      described[key] = value;
    }
  }
  return described;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

// ============== TIMINGS ==============

/**
 * Latência é medida ENTRE hooks: o motor não a informa por invocação — só o total
 * do run, em `IRunUsage.latencyMs`.
 */
function createTimings() {
  let modelStartedAt: number | null = null;
  let pendingModel = '';
  const toolStartedAt = new Map<string, number>();

  function elapsedSince(startedAt: number | undefined): number | undefined {
    return startedAt === undefined ? undefined : Date.now() - startedAt;
  }

  return {
    startModel(model: string): void {
      modelStartedAt = Date.now();
      pendingModel = model;
    },
    endModel(): { model: string; latencyMs?: number } {
      const latencyMs = elapsedSince(modelStartedAt ?? undefined);
      modelStartedAt = null;
      return latencyMs === undefined ? { model: pendingModel } : { model: pendingModel, latencyMs };
    },
    startTool(tool: string): void {
      toolStartedAt.set(tool, Date.now());
    },
    endTool(tool: string): number | undefined {
      const durationMs = elapsedSince(toolStartedAt.get(tool));
      toolStartedAt.delete(tool);
      return durationMs;
    },
  };
}

type Timings = ReturnType<typeof createTimings>;

// ============== HANDLERS ==============

async function handleModelResponse(
  { recorder, timings, response }: {
    recorder: RunRecorder;
    timings: Timings;
    response: NResponse;
  },
): Promise<void> {
  const { model, latencyMs } = timings.endModel();

  await recorder.recordInvocation({
    model,
    usage: response.usage,
    latencyMs,
    toolCalls: response.toolCalls.length,
  });

  await recorder.recordStep({
    stepType: STEP_TYPES.MODEL_RESPONSE,
    payload: {
      model,
      finishReason: response.finishReason,
      usage: response.usage,
      toolCalls: response.toolCalls.map((call) => call.name),
      text: response.text,
    },
    durationMs: latencyMs,
  });
}

/**
 * O ciclo de vida do run mora em `ai_agent_runs` (`started_at`/`finished_at`/
 * `status`), não no trace: `ai_run_steps.step_type` não tem valor para "run
 * começou", e reaproveitar `middleware` para isso encheria o trace de passos que
 * mentem o próprio tipo.
 */
async function handleRunStart(
  { recorder, runId, emittedRunId }: {
    recorder: RunRecorder;
    runId: string;
    emittedRunId: string;
  },
): Promise<void> {
  if (emittedRunId !== runId) {
    // Divergência aqui produziria trace órfão: os steps apontam para `runId` e o
    // run gravado seria outro. Só quem monta os hooks pode ter errado.
    reportPersistenceFailure({
      label: 'runId:mismatch',
      reason: `hooks built for "${runId}" but engine emitted "${emittedRunId}"`,
    });
  }
  await recorder.openRun();
}

/**
 * O TEXTO do que o usuário pediu, ou `undefined` quando esta chamada não parte
 * de um pedido novo.
 *
 * 📌 Só a ÚLTIMA mensagem, e só quando ela é do usuário. A razão é o loop: o
 * `loop.ts` empilha `assistant` + `tool` a cada volta e REENVIA `messages`
 * inteiro, que só cresce. Gravar o array todo em cada `model_call` copiaria o
 * pedido uma vez por iteração e o histórico junto — custo quadrático numa tabela
 * que a `020` já dispensa de auditoria POR CAUSA do volume. Com este recorte, a
 * última mensagem só é `user` na primeira chamada: o pedido entra UMA vez, e nas
 * voltas seguintes a última é `tool`, cujo conteúdo já está no passo
 * `tool_result`.
 *
 * Partes não-texto (imagem, arquivo) são descartadas: o trace guarda o que
 * explica a escolha de ferramenta, não anexo.
 */
function promptOf(messages: NMessage[]): string | undefined {
  const last = messages.at(-1);
  if (last?.role !== 'user') {
    return undefined;
  }
  if (typeof last.content === 'string') {
    return last.content;
  }
  const text = last.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
  return text === '' ? undefined : text;
}

function handleModelCall(
  { recorder, timings, request }: {
    recorder: RunRecorder;
    timings: Timings;
    request: IChatRequest;
  },
): Promise<void> {
  timings.startModel(request.model);

  const payload: DbRow = {
    model: request.model,
    messages: request.messages.length,
    tools: request.tools.map((tool) => tool.name),
    toolChoice: request.toolChoice ?? null,
    maxTokens: request.maxTokens,
  };

  // Sem o pedido, o trace mostra QUE uma ferramenta foi chamada mas não permite
  // julgar se foi a CERTA — que é a pergunta que a avaliação de modelo faz.
  const prompt = promptOf(request.messages);
  if (prompt !== undefined) {
    payload['prompt'] = prompt;
  }

  return recorder.recordStep({ stepType: STEP_TYPES.MODEL_CALL, payload });
}

/**
 * 📌 O fechamento por erro sai DAQUI, não do `onRunEnd`.
 *
 * Quando a saída estruturada falha no teto, `assertStructuredOutput` emite
 * `onError` e LANÇA — o `loop.ts` nunca chega no `emitHook('onRunEnd')` da linha
 * seguinte. Fechar o run só no `onRunEnd` deixaria todo run morto por saída
 * estruturada pendurado em `running` para sempre, e `ai_agent_runs` está
 * publicado no realtime (migration 030): o run eterno apareceria AO VIVO na tela.
 *
 * A fase `'tool'` é a exceção deliberada: `toolRunner.ts` emite `onError` e
 * devolve um tool result de erro SEM relançar — o run continua e termina
 * normalmente. Fechar ali marcaria como quebrado um run que deu certo.
 */
async function handleError(
  { recorder, error, phase }: {
    recorder: RunRecorder;
    error: unknown;
    phase: 'model' | 'tool' | 'middleware';
  },
): Promise<void> {
  await recorder.recordStep({
    stepType: STEP_TYPES.ERROR,
    payload: { phase, error: describeError(error) },
  });

  if (phase === 'tool') {
    return;
  }

  await recorder.closeRun({
    status: RUN_STATUSES.ERROR,
    error: `[${phase}] ${toErrorMessage(error)}`,
  });
}

// ============== FACTORY ==============

export function createPersistenceHooks(params: ICreatePersistenceHooksParams): IAgentHooks {
  const { db, runId, agent, provider, companyId, trigger, cronJobId } = params;

  const recorder = params.recorder ?? createRunRecorder({
    db,
    runId,
    agent,
    provider,
    companyId,
    trigger: trigger ?? RUN_TRIGGERS.USER,
    cronJobId,
  });
  const timings = createTimings();

  return {
    onRunStart(emittedRunId: string): Promise<void> {
      return handleRunStart({ recorder, runId, emittedRunId });
    },

    onModelCall(request: IChatRequest): Promise<void> {
      return handleModelCall({ recorder, timings, request });
    },

    onModelResponse(response: NResponse): Promise<void> {
      return handleModelResponse({ recorder, timings, response });
    },

    async onToolCall(tool: string, args: Record<string, unknown>): Promise<void> {
      timings.startTool(tool);
      await recorder.recordStep({ stepType: STEP_TYPES.TOOL_CALL, payload: { tool, args } });
    },

    async onToolResult(tool: string, result: IToolOutput): Promise<void> {
      await recorder.recordStep({
        stepType: STEP_TYPES.TOOL_RESULT,
        payload: { tool, isError: result.isError === true, content: result.content },
        durationMs: timings.endTool(tool),
      });
    },

    // Os três parâmetros são a assinatura de `IAgentHooks.onMiddleware` (types.ts,
    // do motor): não há como reduzi-los sem alterar o contrato.
    onMiddleware(name: string, phase: string, outcome: string): Promise<void> {
      return recorder.recordStep({
        stepType: STEP_TYPES.MIDDLEWARE,
        payload: { name, phase, outcome },
      });
    },

    onError(error: unknown, phase: 'model' | 'tool' | 'middleware'): Promise<void> {
      return handleError({ recorder, error, phase });
    },

    /** A duração do run sai de `finished_at - started_at`; `ai_agent_runs` não tem coluna de latência. */
    onRunEnd(): Promise<void> {
      return recorder.closeRun({ status: RUN_STATUSES.OK });
    },
  };
}
