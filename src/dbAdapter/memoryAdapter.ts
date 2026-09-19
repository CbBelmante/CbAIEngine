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
  IAiKnowledgeHit,
  IAiKnowledgeSearchParams,
  IAiKnowledgeEntryInput,
  IAiInsightOrigin,
  IAiToolMessageInput,
} from './types';

// ============== STATE ==============

interface IMemoryCategory {
  id: string;
  slug: string;
}

interface IMemoryKnowledgeEntry extends IAiKnowledgeEntryInput {
  id: string;
}

interface IMemoryInsight extends Record<string, unknown> {
  id: string;
}

interface IMemoryState {
  providers: Map<string, IAiProvider>;
  configs: IAiResolvedConfig[];
  credentials: IAiCredentialResult[];
  pricing: Map<string, IAiModelPricing>;
  runs: Map<string, IAiRunInput & { id: string; status: string; error?: string | null }>;
  invocations: IAiInvocationInput[];
  steps: IAiStepInput[];
  limits: Map<string, number>;
  categories: Map<string, IMemoryCategory>;
  knowledgeEntries: IMemoryKnowledgeEntry[];
  insights: IMemoryInsight[];
  toolMessages: IAiToolMessageInput[];
}

// ============== HELPERS ==============

function generateId(): string {
  return crypto.randomUUID();
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
    categories: seed?.categories ?? new Map(),
    knowledgeEntries: seed?.knowledgeEntries ?? [],
    insights: seed?.insights ?? [],
    toolMessages: seed?.toolMessages ?? [],
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

    async listAllProviders(): Promise<IAiProvider[]> {
      return Array.from(state.providers.values());
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

      let consumed = 0;
      for (const inv of state.invocations) {
        const run = Array.from(state.runs.values()).find(r => r.id === inv.runId);
        if (run?.tenantId === tenantId) {
          consumed += inv.costUsd ?? 0;
        }
      }

      return {
        hasLimit: true,
        limitUsd: limit,
        consumedUsd: consumed,
        percent: limit > 0 ? (consumed / limit) * 100 : 0,
      };
    },

    async searchKnowledge(_params: IAiKnowledgeSearchParams): Promise<IAiKnowledgeHit[]> {
      return [];
    },

    async getKnowledgeCategoryBySlug(slug: string): Promise<{ id: string } | null> {
      for (const cat of state.categories.values()) {
        if (cat.slug === slug) return { id: cat.id };
      }
      return null;
    },

    async insertKnowledgeEntry(entry: IAiKnowledgeEntryInput): Promise<{ id: string } | null> {
      const id = generateId();
      state.knowledgeEntries.push({ ...entry, id });
      return { id };
    },

    async insertInsights(rows: Array<Record<string, unknown>>): Promise<string[]> {
      const ids: string[] = [];
      for (const row of rows) {
        const id = generateId();
        state.insights.push({ ...row, id });
        ids.push(id);
      }
      return ids;
    },

    async hasInsightsFrom(origin: IAiInsightOrigin): Promise<boolean> {
      for (const insight of state.insights) {
        if (insight.source === origin.source && insight.source_id === origin.sourceId) {
          if (origin.since) {
            const createdAt = insight.created_at as string | undefined;
            if (createdAt && createdAt >= origin.since) return true;
          } else {
            return true;
          }
        }
      }
      return false;
    },

    async recordToolMessage(message: IAiToolMessageInput): Promise<void> {
      state.toolMessages.push(message);
    },
  };

  return adapter;
}
