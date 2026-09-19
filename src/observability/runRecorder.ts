/**
 * 🔧 runRecorder — As escritas de observabilidade, com falha VISÍVEL
 *
 * O motor engole exceção de hook para não derrubar o run (`emitHook`, fail-soft).
 * O efeito colateral é que uma escrita minha que falhe sumiria em silêncio — e o
 * registro se perderia sem ninguém saber. Por isso toda escrita passa por
 * `persistSafely`, que reporta o MOTIVO e segue: o run não cai, mas a falha não
 * fica invisível.
 */

import {
  OBSERVABILITY_TABLES,
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
  buildWriteLabel,
  MISSING_PRICING_REASON,
} from './rows';
import type { DbRow, IDbResult, IObservabilityDb } from './types';

// ============== CONSTANTS ==============

export const PERSISTENCE_ERROR_PREFIX = '[agent:observability]';

// ============== TYPES ==============

export interface IRunRecorderParams {
  db: IObservabilityDb;
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
  /** Ausente só se `onModelResponse` chegar sem o `onModelCall` par — a coluna é nullable. */
  latencyMs?: number;
  toolCalls: number;
}

export interface IStepRecord {
  stepType: StepType;
  payload: DbRow;
  durationMs?: number;
}

// ============== FAILURE REPORTING ==============

export function reportPersistenceFailure(
  { label, reason }: { label: string; reason: unknown },
): void {
  console.error(PERSISTENCE_ERROR_PREFIX, label, reason);
}

/** Cobre as DUAS formas de falha do PostgREST: exceção lançada e `{ error }` devolvido. */
async function persistSafely(
  { label, operation }: { label: string; operation: () => PromiseLike<IDbResult<unknown>> },
): Promise<void> {
  try {
    const { error } = await operation();
    if (error) {
      reportPersistenceFailure({ label, reason: error });
    }
  } catch (error) {
    reportPersistenceFailure({ label, reason: error });
  }
}

// ============== PRICING CACHE ==============

/** Uma leitura de preço por modelo, não por invocação — o preço não muda no meio do run. */
function createPricingResolver(
  { db, provider }: { db: IObservabilityDb; provider: string },
): (model: string) => Promise<IModelPricing | null> {
  const byModel = new Map<string, IModelPricing | null>();

  return async function resolvePricing(model: string): Promise<IModelPricing | null> {
    const cached = byModel.get(model);
    if (cached !== undefined) {
      return cached;
    }

    let pricing: IModelPricing | null = null;
    try {
      pricing = await fetchModelPricing({ db, provider, model });
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
  const { db, runId, agent, provider, companyId, trigger, cronJobId } = params;
  const resolvePricing = createPricingResolver({ db, provider });
  let seq = 0;
  let closed = false;

  function writeRow(
    { operation, table, row }: { operation: 'insert' | 'update'; table: string; row: DbRow },
  ): Promise<void> {
    const label = buildWriteLabel({ operation, table });
    if (operation === 'insert') {
      return persistSafely({ label, operation: () => db.from(table).insert(row) });
    }
    return persistSafely({ label, operation: () => db.from(table).update(row).eq('id', runId) });
  }

  return {
    openRun(): Promise<void> {
      const row = buildRunRow({
        runId,
        agent,
        trigger,
        companyId,
        cronJobId,
        status: RUN_STATUSES.RUNNING,
      });
      return writeRow({ operation: 'insert', table: OBSERVABILITY_TABLES.RUNS, row });
    },

    closeRun({ status, error }: { status: RunStatus; error?: string }): Promise<void> {
      if (closed) {
        return Promise.resolve();
      }
      closed = true;
      const row = buildRunClosePatch({ status, error });
      return writeRow({ operation: 'update', table: OBSERVABILITY_TABLES.RUNS, row });
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
      await writeRow({ operation: 'insert', table: OBSERVABILITY_TABLES.INVOCATIONS, row });
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
      return writeRow({ operation: 'insert', table: OBSERVABILITY_TABLES.STEPS, row });
    },

    isClosed(): boolean {
      return closed;
    },
  };
}

export type RunRecorder = ReturnType<typeof createRunRecorder>;
