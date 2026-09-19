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

// ============== KNOWLEDGE / RAG ==============

export interface IAiKnowledgeHit {
  entryId: string;
  categoryId: string;
  title: string;
  content: string;
  similarity: number;
  combinedScore: number;
}

export interface IAiKnowledgeSearchParams {
  queryEmbedding: number[];
  topK?: number;
  similarityThreshold?: number;
  priorityWeight?: number;
}

export interface IAiKnowledgeEntryInput {
  categoryId: string;
  title: string;
  content: string;
  visibility: string;
  companyId: string | null;
  syncStatus: string;
  createdBy: string;
}

// ============== INSIGHTS ==============

export interface IAiInsightOrigin {
  source: string;
  sourceId: string;
  since?: string | null;
}

// ============== TOOL MESSAGES ==============

export interface IAiToolMessageInput {
  threadId: string;
  role: string;
  content: string | null;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolResult: unknown;
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
