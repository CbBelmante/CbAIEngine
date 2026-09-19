/**
 * 🔧 rows — Montagem das linhas de observabilidade, sem efeito colateral
 *
 * Funções puras: recebem o que aconteceu e devolvem a linha pronta. Separadas do
 * gravador porque a forma da linha (quais colunas ficam nulas, o que o banco
 * preenche por default) é a parte que o teste quer inspecionar sem passar por
 * client nenhum.
 */

import {
  OBSERVABILITY_TABLES,
  type RunStatus,
  type RunTrigger,
  type StepType,
} from '../definitions/aiObservability';
import { PII_TRACE_KEY } from '../definitions/piiCatalog';
import type { IModelPricing, NUsage } from '../core/types';
import { redactRecord } from '../middleware/piiRedaction';
import { TOOL_RESULT_MAX_CHARS } from '../core/toolRunner';
import { calculateCostUsd } from './pricing';
import type { DbRow } from './types';

// ============== CONSTANTS ==============

/**
 * Teto do `payload` de `ai_run_steps`. Deliberadamente o MESMO número do tool
 * result, e não uma constante nova: o comment da coluna (020_ai_runs.sql) fixa o
 * teto como "mesmo teto do tool_result". Dois números independentes divergiriam
 * no primeiro ajuste.
 */
export const STEP_PAYLOAD_MAX_CHARS = TOOL_RESULT_MAX_CHARS;

// ============== PAYLOAD ==============

/**
 * Corta o payload no teto. O recorte não pode ser a string cortada crua: a coluna
 * é `jsonb` e JSON pela metade não entra. Estourando o teto, grava um objeto que
 * diz o que foi cortado e quanto.
 */
export function truncatePayload(payload: DbRow): DbRow {
  const serialized = JSON.stringify(payload) ?? '';
  if (serialized.length <= STEP_PAYLOAD_MAX_CHARS) {
    return payload;
  }
  return {
    truncated: true,
    originalChars: serialized.length,
    preview: serialized.slice(0, STEP_PAYLOAD_MAX_CHARS),
  };
}

/**
 * 🛡️ Redige o payload ANTES do teto, e um ponto cobre TODO `step_type`.
 *
 * A ordem importa duas vezes. Redigir antes de truncar impede que o `preview`
 * do corte carregue o dado; e o marcador `piiRedacted` é reposto DEPOIS porque
 * o teto substitui o payload inteiro por `{ truncated, preview }` — perder no
 * corte o registro DE QUE houve redação esvaziaria justamente o que a auditoria
 * lê. É o `changed_fields` da `029`: o valor sai, o fato de que existiu fica.
 *
 * Cobrir aqui, e não só no `pre-model`, é deliberado: o middleware limpa o
 * `prompt` do `model_call` por consequência, mas `tool_result.content`,
 * `tool_call.args` e `model_response.text` também são payload.
 */
export function buildStepPayload(payload: DbRow): DbRow {
  const { record, counts } = redactRecord(payload);
  if (!counts) {
    return truncatePayload(record);
  }

  const marked: DbRow = { ...record, [PII_TRACE_KEY]: counts };
  const capped = truncatePayload(marked);
  return capped === marked ? marked : { ...capped, [PII_TRACE_KEY]: counts };
}

// ============== ROWS ==============

/** `started_at` fica com o default do banco: o relógio do Postgres é o único comparável entre runs. */
export function buildRunRow(
  { runId, agent, trigger, companyId, cronJobId, status }: {
    runId: string;
    agent: string;
    trigger: RunTrigger;
    status: RunStatus;
    companyId?: string;
    cronJobId?: string;
  },
): DbRow {
  const row: DbRow = { id: runId, agent, trigger, status };
  if (companyId !== undefined) { row['company_id'] = companyId; }
  if (cronJobId !== undefined) { row['cron_job_id'] = cronJobId; }
  return row;
}

export function buildRunClosePatch(
  { status, error }: { status: RunStatus; error?: string },
): DbRow {
  const patch: DbRow = { status, finished_at: new Date().toISOString() };
  if (error !== undefined) { patch['error'] = error; }
  return patch;
}

export function buildInvocationRow(
  { runId, provider, model, usage, pricing, latencyMs, toolCalls }: {
    runId: string;
    provider: string;
    model: string;
    usage: NUsage;
    pricing: IModelPricing | null;
    toolCalls: number;
    latencyMs?: number;
  },
): DbRow {
  const row: DbRow = {
    run_id: runId,
    provider,
    model,
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
    total_tokens: usage.totalTokens,
    cost_usd: calculateCostUsd({ pricing, usage }),
    tool_calls: toolCalls,
  };
  if (latencyMs !== undefined) { row['latency_ms'] = latencyMs; }
  return row;
}

export function buildStepRow(
  { runId, seq, stepType, payload, durationMs }: {
    runId: string;
    seq: number;
    stepType: StepType;
    payload: DbRow;
    durationMs?: number;
  },
): DbRow {
  const row: DbRow = {
    run_id: runId,
    seq,
    step_type: stepType,
    payload: buildStepPayload(payload),
  };
  if (durationMs !== undefined) { row['duration_ms'] = durationMs; }
  return row;
}

// ============== LABELS ==============

/** Rótulo do log de falha: `insert:ai_run_steps` diz de cara o que se perdeu. */
export function buildWriteLabel(
  { operation, table }: { operation: 'insert' | 'update'; table: string },
): string {
  return `${operation}:${table}`;
}

export const MISSING_PRICING_REASON =
  `no active row in ${OBSERVABILITY_TABLES.PRICING} — cost_usd stays null`;
