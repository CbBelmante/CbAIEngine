/**
 * 🔧 runRecorder — As escritas de observabilidade, com falha VISÍVEL
 *
 * O motor engole exceção de hook para não derrubar o run (`emitHook`, fail-soft).
 * O efeito colateral é que uma escrita que falhe sumiria em silêncio — e o
 * registro se perderia sem ninguém saber. Por isso toda escrita passa por
 * `persistSafely`, que reporta o MOTIVO e segue: o run não cai, mas a falha não
 * fica invisível.
 */

import {
  RUN_STATUSES,
  type RunStatus,
  type RunTrigger,
  type StepType,
} from '../definitions/aiObservability';
import type { IModelPricing, NUsage } from '../core/types';
import { fetchModelPricing } from './pricing';
import {
  buildInvocationRow,
  buildRunClosePatch,
  buildRunRow,
  buildStepRow,
  MISSING_PRICING_REASON,
} from './rows';
import type { IAiDbAdapter } from '../dbAdapter/dbAdapter';

// ============== CONSTANTS ==============

export const PERSISTENCE_ERROR_PREFIX = '[agent:observability]';

// ============== TYPES ==============

export interface IRunRecorderParams {
  dbAdapter: IAiDbAdapter;
  runId: string;
  agent: string;
  provider: string;
  companyId?: string;
  trigger: RunTrigger;
  cronJobId?: string;
}

export interface IInvocationRecord {
  model: string;
  usage: NUsage;
  latencyMs?: number;
  toolCalls: number;
}

export interface IStepRecord {
  stepType: StepType;
  payload: Record<string, unknown>;
  durationMs?: number;
}

// ============== FAILURE REPORTING ==============

export function reportPersistenceFailure(
  { label, reason }: { label: string; reason: unknown },
): void {
  console.error(PERSISTENCE_ERROR_PREFIX, label, reason);
}

async function persistSafely(
  { label, operation }: { label: string; operation: () => Promise<void> },
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    reportPersistenceFailure({ label, reason: error });
  }
}

// ============== PRICING CACHE ==============

function createPricingResolver(
  { dbAdapter, provider }: { dbAdapter: IAiDbAdapter; provider: string },
): (model: string) => Promise<IModelPricing | null> {
  const byModel = new Map<string, IModelPricing | null>();

  return async function resolvePricing(model: string): Promise<IModelPricing | null> {
    const cached = byModel.get(model);
    if (cached !== undefined) {
      return cached;
    }

    let pricing: IModelPricing | null = null;
    try {
      pricing = await fetchModelPricing({ dbAdapter, provider, model });
      if (!pricing) {
        reportPersistenceFailure({
          label: `pricing:missing ${provider}/${model}`,
          reason: MISSING_PRICING_REASON,
        });
      }
    } catch (error) {
      reportPersistenceFailure({ label: `pricing:lookup ${provider}/${model}`, reason: error });
    }

    byModel.set(model, pricing);
    return pricing;
  };
}

// ============== RECORDER ==============

/**
 * Guarda o estado de um run: a sequência dos steps, o preço já resolvido e se o
 * run já foi fechado. O PRIMEIRO fechamento vence — sem isso o estado final
 * dependeria da ordem dos eventos, e um `onRunEnd` reabriria como `ok` um run já
 * fechado como `error`.
 */
export function createRunRecorder(params: IRunRecorderParams) {
  const { dbAdapter, runId, agent, provider, companyId, trigger, cronJobId } = params;
  const resolvePricing = createPricingResolver({ dbAdapter, provider });
  let seq = 0;
  let closed = false;

  return {
    openRun(): Promise<void> {
      return persistSafely({
        label: 'insert:ai_agent_runs',
        operation: () => dbAdapter.openRun({
          id: runId,
          agent,
          tenantId: companyId,
          trigger,
          status: RUN_STATUSES.RUNNING,
        }).then(() => {}),
      });
    },

    closeRun({ status, error }: { status: RunStatus; error?: string }): Promise<void> {
      if (closed) {
        return Promise.resolve();
      }
      closed = true;
      return persistSafely({
        label: 'update:ai_agent_runs',
        operation: () => dbAdapter.closeRun(runId, status, error),
      });
    },

    async recordInvocation(record: IInvocationRecord): Promise<void> {
      const pricing = await resolvePricing(record.model);
      const row = buildInvocationRow({
        runId,
        provider,
        model: record.model,
        usage: record.usage,
        pricing,
        latencyMs: record.latencyMs,
        toolCalls: record.toolCalls,
      });
      await persistSafely({
        label: 'insert:ai_invocations',
        operation: () => dbAdapter.recordInvocation({
          runId,
          provider,
          model: record.model,
          promptTokens: record.usage.promptTokens,
          completionTokens: record.usage.completionTokens,
          totalTokens: record.usage.totalTokens,
          costUsd: row['cost_usd'] as number | null,
          latencyMs: record.latencyMs ?? null,
          toolCalls: record.toolCalls,
        }),
      });
    },

    recordStep(record: IStepRecord): Promise<void> {
      seq += 1;
      const row = buildStepRow({
        runId,
        seq,
        stepType: record.stepType,
        payload: record.payload,
        durationMs: record.durationMs,
      });
      return persistSafely({
        label: 'insert:ai_run_steps',
        operation: () => dbAdapter.recordStep({
          runId,
          seq,
          stepType: record.stepType,
          payload: row['payload'] as Record<string, unknown> | null,
          durationMs: record.durationMs ?? null,
        }),
      });
    },

    isClosed(): boolean {
      return closed;
    },
  };
}

export type RunRecorder = ReturnType<typeof createRunRecorder>;
