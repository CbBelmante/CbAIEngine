/**
 * 💰 consumptionGate — Teto de consumo mensal de IA, por empresa
 *
 * Padrão híbrido da `020_ai_runs.sql`: o BANCO calcula o status
 * (`get_ai_consumption_status`) e o CÓDIGO decide a ação, comparando com os
 * thresholds de `definitions/aiConfig.ts`. Mudar um threshold não pede migration.
 *
 * A soma do consumo é `coalesce(sum(i.cost_usd), 0)` sobre `ai_invocations`
 * (`020_ai_runs.sql:247`), e `cost_usd` sai de `fetchModelPricing` × uso real
 * (`observability/pricing.ts`). A tela `/admin/ai` é quem grava
 * `ai_model_pricing` — o gate BLOQUEIA de verdade pra todo par
 * `(provider, model)` com preço cadastrado.
 *
 * ⚠️ `ai_model_pricing` continua nascendo SEM SEED. Um par sem preço grava
 * `cost_usd` NULL, o `coalesce` some com ele, e o gate fica inerte SÓ PARA
 * ESSE PAR — nenhum número é fabricado pra "fazer funcionar", porque um teto
 * que bloqueia com valor inventado é pior que teto nenhum. Cadastrar o preço
 * na tela é o que liga o bloqueio para aquele modelo.
 *
 * ⚠️ **Fail-open na falha da RPC** é escolha declarada e permanente, não um
 * item pendente: rede instável ou permissão faltando derrubaria o assistente
 * inteiro por causa de um gate de custo. O erro é logado — nunca silenciado.
 *
 * ⚠️ A RPC é `security definer` com `revoke ... from authenticated`
 * (`020_ai_runs.sql:328`): só o service_role a executa. Passe o client ADMIN,
 * nunca o do caller.
 */

import { AI_LIMIT_THRESHOLDS } from '../definitions/aiConfig';

// ============== TYPES ==============

export interface IConsumptionStatus {
  hasLimit: boolean;
  limit: number | null;
  consumed: number | null;
  percent: number | null;
}

/** Superfície mínima: só a RPC. O client é injetado para o teste não pedir banco. */
export interface IConsumptionDb {
  rpc(name: string, params: Record<string, unknown>): PromiseLike<{
    data: IConsumptionStatus | null;
    error: { message: string } | null;
  }>;
}

export interface IAssertWithinLimitParams {
  admin: IConsumptionDb;
  companyId: string | null;
}

// ============== CONSTANTS ==============

export const CONSUMPTION_STATUS_RPC = 'get_ai_consumption_status';
export const LIMIT_REACHED_PREFIX = 'Limite mensal de IA atingido';

// ============== ERROR ==============

/**
 * Recusa ANTES de gastar a chave. Erro próprio em vez de uma resposta HTTP
 * porque quem conhece o código de status é o handler, não o gate.
 */
export class AiLimitReachedError extends Error {
  override readonly name = 'AiLimitReachedError';
  readonly status: IConsumptionStatus;

  constructor(status: IConsumptionStatus) {
    super(`${LIMIT_REACHED_PREFIX}: $${status.consumed}/$${status.limit}`);
    this.status = status;
  }
}

// ============== GATE ==============

/** Lança `AiLimitReachedError` no bloqueio; alerta e segue no aviso. Fail-open na falha da RPC (ver comment do arquivo). */
export async function assertWithinMonthlyLimit(
  { admin, companyId }: IAssertWithinLimitParams,
): Promise<IConsumptionStatus | null> {
  // Sem empresa não há teto a aplicar: os scopes que não são `company` falam da
  // carteira inteira, e o limite é por empresa.
  if (!companyId) { return null; }

  const { data, error } = await admin.rpc(CONSUMPTION_STATUS_RPC, { p_company_id: companyId });

  if (error || !data) {
    console.warn('[ai:limit] status unavailable, proceeding', error?.message ?? 'no data');
    return null;
  }
  if (!data.hasLimit) { return data; }

  const percent = data.percent ?? 0;
  if (percent >= AI_LIMIT_THRESHOLDS.BLOCK) {
    throw new AiLimitReachedError(data);
  }
  if (percent >= AI_LIMIT_THRESHOLDS.WARNING) {
    console.warn(`[ai:limit] ${percent}% consumed: $${data.consumed}/$${data.limit}`);
  }
  return data;
}
