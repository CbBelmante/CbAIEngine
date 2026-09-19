// ============== AI OBSERVABILITY (DENO-COMPATIBLE) ==============
// 🔧 Vocabulário e formatos da observabilidade do agente

/**
 * Vocabulário de `ai_agent_runs` e `ai_run_steps`, espelhando os
 * CHECK constraints de `020_ai_runs.sql`. Valor fora destas listas é recusado
 * pelo banco — mantê-los aqui evita que cada consumidor redigite a string.
 *
 * Compartilhado de propósito: os hooks de persistência (edge) GRAVAM estes
 * valores e a aba de Observabilidade (front) os LÊ para renderizar. Duplicar
 * seria a porta pela qual os dois lados divergem.
 */

// ============== RUN TRIGGER ==============

/** Origem do run. CHECK `ai_agent_runs_trigger_check`. */
export const RUN_TRIGGERS = {
  /** Invoke direto. */
  MANUAL: 'manual',
  /** Job agendado. */
  CRON: 'cron',
  /** Ação de usuário na UI. */
  USER: 'user',
} as const satisfies Record<string, string>;

export type RunTrigger = typeof RUN_TRIGGERS[keyof typeof RUN_TRIGGERS];

// ============== RUN STATUS ==============

/** Ciclo de vida do run. CHECK `ai_agent_runs_status_check`. */
export const RUN_STATUSES = {
  RUNNING: 'running',
  OK: 'ok',
  ERROR: 'error',
} as const satisfies Record<string, string>;

export type RunStatus = typeof RUN_STATUSES[keyof typeof RUN_STATUSES];

// ============== STEP TYPE ==============

/**
 * Tipos de passo do trace. CHECK `ai_run_steps_type_check`.
 *
 * `RAG_SEARCH` existe no banco mas ainda não tem emissor: `IAgentHooks` não
 * possui hook de busca vetorial. Fica declarado porque o CHECK o aceita — quem
 * implementar RAG grava por aqui, sem migration.
 */
export const STEP_TYPES = {
  MODEL_CALL: 'model_call',
  MODEL_RESPONSE: 'model_response',
  RAG_SEARCH: 'rag_search',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  MIDDLEWARE: 'middleware',
  ERROR: 'error',
} as const satisfies Record<string, string>;

export type StepType = typeof STEP_TYPES[keyof typeof STEP_TYPES];

// ============== TABLES ==============

/** Tabelas de observabilidade no schema. */
export const OBSERVABILITY_TABLES = {
  RUNS: 'ai_agent_runs',
  INVOCATIONS: 'ai_invocations',
  STEPS: 'ai_run_steps',
  PRICING: 'ai_model_pricing',
  /** Registro dos jobs, e desde a `034` a fonte de verdade do agendamento. */
  CRON_JOBS: 'ai_cron_jobs',
} as const satisfies Record<string, string>;

// ============== COST FORMAT ==============

/** Preço é cotado por 1.000 tokens — as colunas são `input_per_1k` / `output_per_1k`. */
export const TOKENS_PER_PRICING_UNIT = 1000;

/** `ai_invocations.cost_usd` é `numeric(10,6)`: arredondar na origem evita que o banco arredonde por nós. */
export const COST_DECIMAL_PLACES = 6;
