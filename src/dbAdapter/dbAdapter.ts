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
  /** Lista todos os providers ativos e habilitados. */
  listProviders(): Promise<IAiProvider[]>;
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
}
