/**
 * Adapter de memória — para testes e desenvolvimento.
 *
 * Armazena tudo em Maps/arrays em memória. Não persiste nada.
 * Implementa a cascata de config (tenant → global → default) fielmente.
 */

import type { IAiDbAdapter } from './dbAdapter';
import type {
  IAiProvider,
  IAiResolvedConfig,
  IAiCredentialResult,
  IAiModelPricing,
  IAiConsumptionStatus,
  IAiRunInput,
  IAiInvocationInput,
  IAiStepInput,
} from './types';

// ============== STATE ==============

interface IMemoryState {
  providers: Map<string, IAiProvider>;
  configs: IAiResolvedConfig[];
  credentials: IAiCredentialResult[];
  pricing: Map<string, IAiModelPricing>;
  runs: Map<string, IAiRunInput & { id: string; status: string; error?: string | null }>;
  invocations: IAiInvocationInput[];
  steps: IAiStepInput[];
  limits: Map<string, number>;
}

// ============== HELPERS ==============

function generateId(): string {
  return crypto.randomUUID();
}

function configKey(agent: string, tenantId?: string | null): string {
  return `${agent}:${tenantId ?? '__global__'}`;
}

// ============== ADAPTER ==============

export function createMemoryAdapter(seed?: Partial<IMemoryState>): IAiDbAdapter & { state: IMemoryState } {
  const state: IMemoryState = {
    providers: seed?.providers ?? new Map(),
    configs: seed?.configs ?? [],
    credentials: seed?.credentials ?? [],
    pricing: seed?.pricing ?? new Map(),
    runs: seed?.runs ?? new Map(),
    invocations: seed?.invocations ?? [],
    steps: seed?.steps ?? [],
    limits: seed?.limits ?? new Map(),
  };

  const adapter: IAiDbAdapter & { state: IMemoryState } = {
    state,

    async getConfig(agent: string, tenantId?: string | null): Promise<IAiResolvedConfig | null> {
      const tenantConfig = tenantId
        ? state.configs.find(c => c.agent === agent && c.tenantId === tenantId && c.enabled)
        : null;
      if (tenantConfig) return tenantConfig;

      const globalConfig = state.configs.find(c => c.agent === agent && c.tenantId === null && c.enabled);
      if (globalConfig) return globalConfig;

      const defaultConfig = state.configs.find(c => c.agent === 'default' && c.tenantId === null && c.enabled);
      return defaultConfig ?? null;
    },

    async getCredential(provider: string, tenantId?: string | null): Promise<IAiCredentialResult | null> {
      const tenantCred = tenantId
        ? state.credentials.find(c => c.provider === provider && c.tenantId === tenantId)
        : null;
      if (tenantCred) return tenantCred;

      const globalCred = state.credentials.find(c => c.provider === provider && c.tenantId === null);
      return globalCred ?? null;
    },

    async listProviders(): Promise<IAiProvider[]> {
      return Array.from(state.providers.values()).filter(p => p.enabled);
    },

    async getProvider(slug: string): Promise<IAiProvider | null> {
      return state.providers.get(slug) ?? null;
    },

    async openRun(run: IAiRunInput): Promise<string> {
      const id = run.id ?? generateId();
      state.runs.set(id, { ...run, id, status: 'running' });
      return id;
    },

    async closeRun(runId: string, status: string, error?: string | null): Promise<void> {
      const run = state.runs.get(runId);
      if (run) {
        run.status = status;
        if (error) run.error = error;
      }
    },

    async recordInvocation(inv: IAiInvocationInput): Promise<void> {
      state.invocations.push(inv);
    },

    async recordStep(step: IAiStepInput): Promise<void> {
      state.steps.push(step);
    },

    async getModelPricing(provider: string, model: string): Promise<IAiModelPricing | null> {
      return state.pricing.get(`${provider}:${model}`) ?? null;
    },

    async getConsumptionStatus(tenantId: string): Promise<IAiConsumptionStatus | null> {
      const limit = state.limits.get(tenantId);
      if (limit === undefined) return null;

      const consumed = state.invocations
        .filter(i => {
          const run = Array.from(state.runs.values()).find(r => r.id === i.runId);
          return run?.tenantId === tenantId;
        })
        .reduce((sum, i) => sum + (i.costUsd ?? 0), 0);

      return {
        hasLimit: true,
        limitUsd: limit,
        consumedUsd: consumed,
        percent: limit > 0 ? (consumed / limit) * 100 : 0,
      };
    },
  };

  return adapter;
}
