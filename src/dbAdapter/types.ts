/**
 * Tipos do adapter de dados — contrato entre o engine e o backend concreto.
 *
 * Seguindo o padrão IDataAdapter: interface mínima, implementações concretas
 * por backend (Kysely, Drizzle, Supabase, memória). Toda diferença de banco
 * fica dentro do adapter, nunca no core.
 */

// ============== PROVIDER ==============

export interface IAiProvider {
  slug: string;
  name: string;
  baseUrl: string | null;
  protocol: 'anthropic' | 'openai-compatible';
  enabled: boolean;
}

// ============== CONFIG ==============

export interface IAiResolvedConfig {
  agent: string;
  tenantId: string | null;
  provider: string;
  model: string;
  params: Record<string, unknown>;
  enabled: boolean;
}

// ============== CREDENTIAL ==============

export interface IAiCredentialResult {
  apiKey: string;
  provider: string;
  tenantId: string | null;
}

// ============== PRICING ==============

export interface IAiModelPricing {
  provider: string;
  model: string;
  inputPer1k: number;
  outputPer1k: number;
  currency: string;
}

// ============== QUOTA ==============

export interface IAiConsumptionStatus {
  hasLimit: boolean;
  limitUsd: number | null;
  consumedUsd: number;
  percent: number;
}

// ============== OBSERVABILITY RECORDS ==============

export interface IAiRunInput {
  id?: string;
  agent: string;
  tenantId?: string | null;
  trigger: string;
  status: string;
}

export interface IAiInvocationInput {
  runId: string;
  provider: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  latencyMs: number | null;
  toolCalls: number;
}

export interface IAiStepInput {
  runId: string;
  seq: number;
  stepType: string;
  payload: Record<string, unknown> | null;
  durationMs: number | null;
}
