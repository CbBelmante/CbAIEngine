/**
 * IAiDbAdapter — Contrato de acesso a dados para o AI engine.
 *
 * Abstração entre o engine e o backend concreto.
 * Implementações: createMemoryAdapter (testes), createKyselyAdapter (Postgres/SQLite),
 * createSupabaseAdapter, etc.
 *
 * Cada operação recebe/retorna objetos em camelCase — a conversão
 * snake↔camel fica na implementação do adapter.
 *
 * Segue o padrão IDataAdapter do CRUD genérico: interface mínima,
 * toda lógica de backend dentro do adapter.
 */

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

// ============== INTERFACE ==============

export interface IAiDbAdapter {
  // ── Config ──────────────────────────────────────────────────────────────
  /** Resolve config com cascata: tenant → global → agente default → null. */
  getConfig(agent: string, tenantId?: string | null): Promise<IAiResolvedConfig | null>;

  // ── Credentials ─────────────────────────────────────────────────────────
  /** Resolve credencial com cascata: tenant → global → null. */
  getCredential(provider: string, tenantId?: string | null): Promise<IAiCredentialResult | null>;

  // ── Providers ───────────────────────────────────────────────────────────
  /** Lista providers ativos e habilitados. */
  listProviders(): Promise<IAiProvider[]>;
  /** Lista TODOS os providers (inclusive disabled/inactive). Necessário para o providerCatalog montar a lista de recusados. */
  listAllProviders(): Promise<IAiProvider[]>;
  /** Busca um provider pelo slug. */
  getProvider(slug: string): Promise<IAiProvider | null>;

  // ── Observability ───────────────────────────────────────────────────────
  /** Abre um run (status 'running'). Retorna o runId. */
  openRun(run: IAiRunInput): Promise<string>;
  /** Fecha um run (status 'ok' ou 'error'). */
  closeRun(runId: string, status: string, error?: string | null): Promise<void>;
  /** Grava uma invocação de modelo dentro de um run. */
  recordInvocation(inv: IAiInvocationInput): Promise<void>;
  /** Grava um passo do trace dentro de um run. */
  recordStep(step: IAiStepInput): Promise<void>;

  // ── Pricing ─────────────────────────────────────────────────────────────
  /** Busca preço por (provider, model). null = sem preço cadastrado. */
  getModelPricing(provider: string, model: string): Promise<IAiModelPricing | null>;

  // ── Quota ───────────────────────────────────────────────────────────────
  /** Status de consumo do tenant. null = sem tenant ou sem limite. */
  getConsumptionStatus(tenantId: string): Promise<IAiConsumptionStatus | null>;

  // ── Knowledge / RAG ─────────────────────────────────────────────────────
  /** Busca vetorial. Roda com RLS do caller, não admin. */
  searchKnowledge(params: IAiKnowledgeSearchParams): Promise<IAiKnowledgeHit[]>;
  /** Busca categoria de conhecimento pelo slug. */
  getKnowledgeCategoryBySlug(slug: string): Promise<{ id: string } | null>;
  /** Insere entrada de conhecimento. Retorna id criado. */
  insertKnowledgeEntry(entry: IAiKnowledgeEntryInput): Promise<{ id: string } | null>;

  // ── Insights ────────────────────────────────────────────────────────────
  /** Insere insights em lote. Retorna ids inseridos. */
  insertInsights(rows: Array<Record<string, unknown>>): Promise<string[]>;
  /** Verifica se já existem insights desta origem (dedup). */
  hasInsightsFrom(origin: IAiInsightOrigin): Promise<boolean>;

  // ── Tool messages ───────────────────────────────────────────────────────
  /** Grava mensagem de tool (fail-soft). */
  recordToolMessage(message: IAiToolMessageInput): Promise<void>;
}
