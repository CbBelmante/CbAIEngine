-- =============================================================================
-- Migration 004 — Execuções, invocações e trace do agente
-- =============================================================================
--- Registro de execuções (ai_agent_runs), invocações de modelo (ai_invocations)
--- e trace passo a passo (ai_run_steps).
--- Alto volume de log → SEM audit triggers em runs/invocations/steps.
--- Depende de: 001_ai_config.sql
-- =============================================================================


-- =============================================================================
-- TABELA: ai_agent_runs
-- Uma execução do agente. Agrupa N invocações de modelo.
-- Alto volume → SEM audit triggers.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_agent_runs (
  id              TEXT PRIMARY KEY,
  agent           TEXT NOT NULL,
  tenant_id       TEXT,
  trigger         TEXT NOT NULL DEFAULT 'user' CHECK (trigger IN ('manual', 'cron', 'user')),
  cron_job_id     TEXT REFERENCES ai_cron_jobs(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'error')),
  error           TEXT,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at     TEXT,
  -- O handle da chamada assíncrona, quando o run saiu de um agendamento.
  net_request_id  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_started ON ai_agent_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_agent ON ai_agent_runs(agent);
CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_tenant ON ai_agent_runs(tenant_id, started_at);
CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_cron ON ai_agent_runs(cron_job_id);


-- =============================================================================
-- TABELA: ai_invocations
-- Log por chamada de modelo (observabilidade). Alto volume → sem audit.
-- cost_usd calculado via lookup em ai_model_pricing (provider, model).
-- NULL quando sem preço cadastrado — NUNCA zero.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_invocations (
  id                TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL REFERENCES ai_agent_runs(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,
  model             TEXT NOT NULL,
  prompt_tokens     INTEGER,
  -- ⚠️ NULO É «o provedor não informa»; zero é «informa e não aproveitou».
  -- Colapsar os dois faz o painel dizer que nada cacheou onde ninguém mediu.
  cached_prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens      INTEGER,
  cost_usd          REAL,
  latency_ms        INTEGER,
  tool_calls        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_invocations_run ON ai_invocations(run_id);
CREATE INDEX IF NOT EXISTS idx_ai_invocations_created ON ai_invocations(created_at DESC);


-- =============================================================================
-- TABELA: ai_run_steps
-- Trace passo a passo do run. payload TRUNCADO a ~8 KB antes de gravar.
-- ⚠️ CONTÉM CONTEÚDO DE USUÁRIO (model_call guarda o prompt, tool_result guarda
-- o retorno da ferramenta). Retenção e expurgo passam a valer aqui.
-- Alto volume → sem audit triggers.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_run_steps (
  id              TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL REFERENCES ai_agent_runs(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,
  step_type       TEXT NOT NULL CHECK (step_type IN
    ('model_call', 'model_response', 'rag_search', 'tool_call', 'tool_result', 'middleware', 'error')),
  payload         TEXT,
  duration_ms     INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_run_steps_run ON ai_run_steps(run_id, seq);
