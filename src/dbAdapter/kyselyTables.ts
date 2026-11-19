/**
 * As tabelas do motor, como o Kysely as enxerga.
 *
 * ⚠️ UM TIPO SÓ PARA OS DOIS BANCOS, de propósito: o que muda entre Postgres e
 * SQLite é o TIPO DA COLUNA (uuid/timestamptz contra text), e não o nome dela.
 * Declarar duas interfaces faria a consulta divergir onde ela é idêntica — e a
 * diferença que existe de verdade (busca vetorial) o adapter trata à parte.
 */

// ============== AS LINHAS ==============

export interface IAiProvidersTable {
  id: string;
  slug: string;
  name: string;
  base_url: string | null;
  protocol: string;
  enabled: boolean | number;
  active: boolean | number;
  deleted_at: string | null;
}

export interface IAiConfigTable {
  id: string;
  agent: string;
  tenant_id: string | null;
  provider: string;
  model: string;
  params: unknown;
  enabled: boolean | number;
  active: boolean | number;
  deleted_at: string | null;
}

export interface IAiCredentialsTable {
  id: string;
  provider: string;
  tenant_id: string | null;
  api_key: string;
  last4: string | null;
  active: boolean | number;
  deleted_at: string | null;
}

export interface IAiModelPricingTable {
  id: string;
  provider: string;
  model: string;
  input_per_1k: number | string;
  output_per_1k: number | string;
  currency: string;
  active: boolean | number;
  deleted_at: string | null;
}

export interface IAiAgentRunsTable {
  id: string;
  agent: string;
  tenant_id: string | null;
  trigger: string;
  cron_job_id: string | null;
  net_request_id?: number | null;
  status: string;
  error: string | null;
  started_at: string | Date;
  finished_at: string | Date | null;
}

export interface IAiInvocationsTable {
  id?: string;
  run_id: string;
  provider: string;
  model: string;
  prompt_tokens: number | null;
  cached_prompt_tokens?: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cost_usd: number | string | null;
  latency_ms: number | null;
  tool_calls: number;
}

export interface IAiRunStepsTable {
  id?: string;
  run_id: string;
  seq: number;
  step_type: string;
  payload: unknown;
  duration_ms: number | null;
}

export interface IAiKnowledgeCategoriesTable {
  id: string;
  slug: string;
  active: boolean | number;
  deleted_at: string | null;
}

export interface IAiKnowledgeEntriesTable {
  id?: string;
  category_id: string;
  title: string;
  content: string;
  visibility: string;
  tenant_id: string | null;
  sync_status: string;
  created_by: string | null;
}

export interface IAiInsightsTable {
  id?: string;
  tenant_id: string;
  entity_type: string;
  entity_id: string;
  insight_type: string;
  title: string;
  content: string | null;
  status: string;
  visibility: string;
  source: string;
  source_id: string | null;
  created_at?: string | Date;
}

// ============== O BANCO ==============

export interface IEngineDatabase {
  ai_providers: IAiProvidersTable;
  ai_config: IAiConfigTable;
  ai_credentials: IAiCredentialsTable;
  ai_model_pricing: IAiModelPricingTable;
  ai_agent_runs: IAiAgentRunsTable;
  ai_invocations: IAiInvocationsTable;
  ai_run_steps: IAiRunStepsTable;
  ai_knowledge_categories: IAiKnowledgeCategoriesTable;
  ai_knowledge_entries: IAiKnowledgeEntriesTable;
  ai_insights: IAiInsightsTable;
}
