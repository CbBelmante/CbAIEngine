/**
 * 🔧 pricing — Custo real da invocação, derivado de `ai_model_pricing`
 *
 * O motor entrega tokens crus e deixa `costUsd: null`; a conversão em dólar sai
 * daqui. Sem linha de preço cadastrada o custo continua `null`: `ai_model_pricing`
 * nasce VAZIA, e estimar um número seria pior que a ausência — o consumo por
 * empresa é somado desta coluna.
 */

import {
  COST_DECIMAL_PLACES,
  TOKENS_PER_PRICING_UNIT,
} from '../definitions/aiObservability';
import type { IModelPricing, NUsage } from '../core/types';
import type { IAiDbAdapter } from '../dbAdapter/dbAdapter';

// ============== LOOKUP ==============

/**
 * Busca o preço de `(provider, model)` via dbAdapter. Devolve `null` quando não
 * há preço cadastrado — o caso normal, já que a tabela nasce sem seed.
 */
export async function fetchModelPricing(
  { dbAdapter, provider, model }: { dbAdapter: IAiDbAdapter; provider: string; model: string },
): Promise<IModelPricing | null> {
  const data = await dbAdapter.getModelPricing(provider, model);

  if (!data) {
    return null;
  }

  const inputPer1k = toFiniteNumber(data.inputPer1k);
  const outputPer1k = toFiniteNumber(data.outputPer1k);
  if (inputPer1k === null || outputPer1k === null) {
    return null;
  }

  return { provider, model, inputPer1k, outputPer1k };
}

// ============== CALCULATION ==============

/**
 * `(prompt/1000 × input) + (completion/1000 × output)`, conforme o comment de
 * `ai_invocations.cost_usd`. Sem pricing, `null` — nunca um valor estimado.
 */
export function calculateCostUsd(
  { pricing, usage }: { pricing: IModelPricing | null; usage: NUsage },
): number | null {
  if (!pricing) {
    return null;
  }

  const inputCost = (usage.promptTokens / TOKENS_PER_PRICING_UNIT) * pricing.inputPer1k;
  const outputCost = (usage.completionTokens / TOKENS_PER_PRICING_UNIT) * pricing.outputPer1k;
  const total = inputCost + outputCost;

  if (!Number.isFinite(total)) {
    return null;
  }

  return Number(total.toFixed(COST_DECIMAL_PLACES));
}

// ============== HELPERS ==============

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
