-- =============================================================================
-- CbAIEngine — Schema completo (SQLite)
-- =============================================================================
-- Gerado pela concatenação das 6 migrations.
-- NÃO editar manualmente — editar a migration individual e regenerar.
-- =============================================================================


-- ###########################################################################
-- 001_ai_config.sql
-- ###########################################################################

-- =============================================================================
-- Migration 001 — Providers, configuração de agentes e pricing
-- =============================================================================
--- Catálogo de providers (ai_providers), config por agente com override por
--- tenant (ai_config) e pricing declarativo por (provider, model).
--- Depende de: nada (primeira migration do AI engine)
-- =============================================================================


-- =============================================================================
-- TABELA: ai_providers
-- Catálogo de providers (plug-and-play: adicionar via tela de admin, sem deploy).
-- Nasce VAZIO — o operador cadastra os providers que vai usar.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_providers (
  id              TEXT PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  base_url        TEXT,
  protocol        TEXT NOT NULL CHECK (protocol IN ('anthropic', 'openai-compatible')),
  enabled         INTEGER NOT NULL DEFAULT 1,
  active          INTEGER NOT NULL DEFAULT 1,
  deleted_at      TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now')),
  created_by      TEXT,
  updated_by      TEXT,
  CHECK (base_url IS NOT NULL OR NOT enabled)
);

CREATE TRIGGER IF NOT EXISTS ai_providers_updated_at AFTER UPDATE ON ai_providers
BEGIN UPDATE ai_providers SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS ai_providers_soft_delete AFTER UPDATE OF active ON ai_providers
  WHEN OLD.active = 1 AND NEW.active = 0
BEGIN UPDATE ai_providers SET deleted_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS ai_providers_restore AFTER UPDATE OF active ON ai_providers
  WHEN OLD.active = 0 AND NEW.active = 1
BEGIN UPDATE ai_providers SET deleted_at = NULL WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS ai_providers_audit_insert AFTER INSERT ON ai_providers
BEGIN
  INSERT INTO audit_log (id, table_name, record_id, action, new_data, created_at)
  VALUES (lower(hex(randomblob(16))), 'ai_providers', NEW.id, 'INSERT',
    json_object('slug', NEW.slug, 'name', NEW.name, 'protocol', NEW.protocol),
    datetime('now'));
END;

CREATE TRIGGER IF NOT EXISTS ai_providers_audit_update AFTER UPDATE ON ai_providers
BEGIN
  INSERT INTO audit_log (id, table_name, record_id, action, old_data, new_data, created_at)
  VALUES (lower(hex(randomblob(16))), 'ai_providers', NEW.id, 'UPDATE',
    json_object('slug', OLD.slug, 'name', OLD.name, 'enabled', OLD.enabled, 'active', OLD.active),
    json_object('slug', NEW.slug, 'name', NEW.name, 'enabled', NEW.enabled, 'active', NEW.active),
    datetime('now'));
END;


-- =============================================================================
-- TABELA: ai_config
-- Config de IA: provider + modelo por agente. NÃO guarda API keys.
-- tenant_id NULL = default global; preenchido = override do tenant.
-- Cascata: override do tenant → global do agente → agente 'default' → ConfigError.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_config (
  id              TEXT PRIMARY KEY,
  agent           TEXT NOT NULL,
  tenant_id       TEXT,
  provider        TEXT NOT NULL REFERENCES ai_providers(slug),
  model           TEXT NOT NULL,
  params          TEXT NOT NULL DEFAULT '{}',
  enabled         INTEGER NOT NULL DEFAULT 1,
  active          INTEGER NOT NULL DEFAULT 1,
  deleted_at      TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now')),
  created_by      TEXT,
  updated_by      TEXT,
  UNIQUE (agent, tenant_id)
);

-- Garante UM default global por agente (NULL não colide com NULL no SQLite sem esse índice)
CREATE UNIQUE INDEX IF NOT EXISTS ai_config_agent_global_uk
  ON ai_config (agent) WHERE tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_config_tenant ON ai_config(tenant_id);

CREATE TRIGGER IF NOT EXISTS ai_config_updated_at AFTER UPDATE ON ai_config
BEGIN UPDATE ai_config SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS ai_config_soft_delete AFTER UPDATE OF active ON ai_config
  WHEN OLD.active = 1 AND NEW.active = 0
BEGIN UPDATE ai_config SET deleted_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS ai_config_restore AFTER UPDATE OF active ON ai_config
  WHEN OLD.active = 0 AND NEW.active = 1
BEGIN UPDATE ai_config SET deleted_at = NULL WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS ai_config_audit_insert AFTER INSERT ON ai_config
BEGIN
  INSERT INTO audit_log (id, table_name, record_id, action, new_data, created_at)
  VALUES (lower(hex(randomblob(16))), 'ai_config', NEW.id, 'INSERT',
    json_object('agent', NEW.agent, 'provider', NEW.provider, 'model', NEW.model),
    datetime('now'));
END;

CREATE TRIGGER IF NOT EXISTS ai_config_audit_update AFTER UPDATE ON ai_config
BEGIN
  INSERT INTO audit_log (id, table_name, record_id, action, old_data, new_data, created_at)
  VALUES (lower(hex(randomblob(16))), 'ai_config', NEW.id, 'UPDATE',
    json_object('agent', OLD.agent, 'provider', OLD.provider, 'model', OLD.model, 'enabled', OLD.enabled),
    json_object('agent', NEW.agent, 'provider', NEW.provider, 'model', NEW.model, 'enabled', NEW.enabled),
    datetime('now'));
END;


-- =============================================================================
-- TABELA: ai_model_pricing
-- Preço declarativo por (provider, model). Fonte do cost_usd em ai_invocations.
-- Nasce VAZIA — o operador cadastra conforme modelos usados.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_model_pricing (
  id              TEXT PRIMARY KEY,
  provider        TEXT NOT NULL REFERENCES ai_providers(slug),
  model           TEXT NOT NULL,
  input_per_1k    REAL NOT NULL,
  output_per_1k   REAL NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'USD',
  active          INTEGER NOT NULL DEFAULT 1,
  deleted_at      TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now')),
  created_by      TEXT,
  updated_by      TEXT,
  UNIQUE (provider, model)
);

CREATE TRIGGER IF NOT EXISTS ai_model_pricing_updated_at AFTER UPDATE ON ai_model_pricing
BEGIN UPDATE ai_model_pricing SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS ai_model_pricing_audit_insert AFTER INSERT ON ai_model_pricing
BEGIN
  INSERT INTO audit_log (id, table_name, record_id, action, new_data, created_at)
  VALUES (lower(hex(randomblob(16))), 'ai_model_pricing', NEW.id, 'INSERT',
    json_object('provider', NEW.provider, 'model', NEW.model, 'input_per_1k', NEW.input_per_1k, 'output_per_1k', NEW.output_per_1k),
    datetime('now'));
END;

CREATE TRIGGER IF NOT EXISTS ai_model_pricing_audit_update AFTER UPDATE ON ai_model_pricing
BEGIN
  INSERT INTO audit_log (id, table_name, record_id, action, old_data, new_data, created_at)
  VALUES (lower(hex(randomblob(16))), 'ai_model_pricing', NEW.id, 'UPDATE',
    json_object('provider', OLD.provider, 'model', OLD.model, 'input_per_1k', OLD.input_per_1k),
    json_object('provider', NEW.provider, 'model', NEW.model, 'input_per_1k', NEW.input_per_1k),
    datetime('now'));
END;


-- ###########################################################################
-- 002_ai_credentials.sql
-- ###########################################################################

-- =============================================================================
-- Migration 002 — Credenciais de API (chaves isoladas por tenant)
-- =============================================================================
--- Chaves de API com isolamento por tenant. api_key NUNCA desce pro client.
--- last4 é coluna GENERATED — suficiente para o operador reconhecer a chave.
--- View ai_credentials_view expõe tudo MENOS api_key.
--- Depende de: 001_ai_config.sql (ai_providers)
-- =============================================================================


-- =============================================================================
-- TABELA: ai_credentials
-- Chaves de API isoladas. Cascata: tenant → global → ConfigError.
-- api_key na deny-list do audit (nunca aparece no audit_log).
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_credentials (
  id              TEXT PRIMARY KEY,
  provider        TEXT NOT NULL REFERENCES ai_providers(slug),
  tenant_id       TEXT,
  api_key         TEXT NOT NULL,
  last4           TEXT GENERATED ALWAYS AS (substr(api_key, -4)) STORED,
  rotated_at      TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  deleted_at      TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now')),
  created_by      TEXT,
  updated_by      TEXT,
  UNIQUE (provider, tenant_id)
);

-- Garante UMA credencial global por provider
CREATE UNIQUE INDEX IF NOT EXISTS ai_credentials_provider_global_uk
  ON ai_credentials (provider) WHERE tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_credentials_provider ON ai_credentials(provider);
CREATE INDEX IF NOT EXISTS idx_ai_credentials_tenant ON ai_credentials(tenant_id);

CREATE TRIGGER IF NOT EXISTS ai_credentials_updated_at AFTER UPDATE ON ai_credentials
BEGIN UPDATE ai_credentials SET updated_at = datetime('now') WHERE id = NEW.id; END;

-- Audit: NÃO grava api_key (deny-list). Registra QUE mudou, sem o valor.
CREATE TRIGGER IF NOT EXISTS ai_credentials_audit_insert AFTER INSERT ON ai_credentials
BEGIN
  INSERT INTO audit_log (id, table_name, record_id, action, new_data, created_at)
  VALUES (lower(hex(randomblob(16))), 'ai_credentials', NEW.id, 'INSERT',
    json_object('provider', NEW.provider, 'tenant_id', NEW.tenant_id, 'last4', NEW.last4),
    datetime('now'));
END;

CREATE TRIGGER IF NOT EXISTS ai_credentials_audit_update AFTER UPDATE ON ai_credentials
BEGIN
  INSERT INTO audit_log (id, table_name, record_id, action, old_data, new_data, created_at)
  VALUES (lower(hex(randomblob(16))), 'ai_credentials', NEW.id, 'UPDATE',
    json_object('provider', OLD.provider, 'last4', OLD.last4),
    json_object('provider', NEW.provider, 'last4', NEW.last4),
    datetime('now'));
END;


-- =============================================================================
-- VIEW: ai_credentials_view
-- Leitura sem api_key. Só registros ativos.
-- =============================================================================

CREATE VIEW IF NOT EXISTS ai_credentials_view AS
  SELECT id, provider, tenant_id, last4, rotated_at, active, created_at, updated_at
  FROM ai_credentials
  WHERE active = 1;


-- ###########################################################################
-- 003_ai_runs.sql
-- ###########################################################################

-- =============================================================================
-- Migration 003 — Execuções, invocações e trace do agente
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
  finished_at     TEXT
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


-- ###########################################################################
-- 004_ai_knowledge.sql
-- ###########################################################################

-- =============================================================================
-- Migration 004 — Base de conhecimento (RAG)
-- =============================================================================
--- Categorias curadas (ai_knowledge_categories) e entradas com embedding
--- vetorial (ai_knowledge_entries). Ingestão assíncrona:
--- pending → processing → synced/failed.
---
--- ⚠️ VETOR: SQLite não tem pgvector. A coluna embedding NÃO existe aqui.
--- Para busca vetorial em SQLite, use uma extensão externa (sqlite-vss,
--- sqlite-vec) ou um serviço de embedding separado (Pinecone, Qdrant).
--- A migration de Postgres inclui vector(1536) + HNSW index + função
--- ai_knowledge_search.
---
--- Depende de: nada (categorias e entradas são auto-contidas)
-- =============================================================================


-- =============================================================================
-- TABELA: ai_knowledge_categories
-- Categorias curadas de conhecimento. is_system = categoria reservada
-- (não editável/removível pela UI comum).
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_knowledge_categories (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  description     TEXT,
  is_system       INTEGER NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1,
  deleted_at      TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now')),
  created_by      TEXT,
  updated_by      TEXT
);

CREATE TRIGGER IF NOT EXISTS ai_knowledge_categories_updated_at AFTER UPDATE ON ai_knowledge_categories
BEGIN UPDATE ai_knowledge_categories SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS ai_knowledge_categories_soft_delete AFTER UPDATE OF active ON ai_knowledge_categories
  WHEN OLD.active = 1 AND NEW.active = 0
BEGIN UPDATE ai_knowledge_categories SET deleted_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS ai_knowledge_categories_restore AFTER UPDATE OF active ON ai_knowledge_categories
  WHEN OLD.active = 0 AND NEW.active = 1
BEGIN UPDATE ai_knowledge_categories SET deleted_at = NULL WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS ai_knowledge_categories_audit_insert AFTER INSERT ON ai_knowledge_categories
BEGIN
  INSERT INTO audit_log (id, table_name, record_id, action, new_data, created_at)
  VALUES (lower(hex(randomblob(16))), 'ai_knowledge_categories', NEW.id, 'INSERT',
    json_object('name', NEW.name, 'slug', NEW.slug, 'is_system', NEW.is_system),
    datetime('now'));
END;

CREATE TRIGGER IF NOT EXISTS ai_knowledge_categories_audit_update AFTER UPDATE ON ai_knowledge_categories
BEGIN
  INSERT INTO audit_log (id, table_name, record_id, action, old_data, new_data, created_at)
  VALUES (lower(hex(randomblob(16))), 'ai_knowledge_categories', NEW.id, 'UPDATE',
    json_object('name', OLD.name, 'slug', OLD.slug, 'active', OLD.active),
    json_object('name', NEW.name, 'slug', NEW.slug, 'active', NEW.active),
    datetime('now'));
END;


-- =============================================================================
-- SEED: Categoria reservada 'agent-memories'
-- Categoria do sistema para memória durável do agente.
-- Escrita pela tool save_memory.
-- =============================================================================

INSERT OR IGNORE INTO ai_knowledge_categories (id, name, slug, description, is_system)
VALUES (lower(hex(randomblob(16))), 'Memórias do agente', 'agent-memories',
  'Fatos duráveis lembrados pelo agente', 1);


-- =============================================================================
-- TABELA: ai_knowledge_entries
-- Entradas de conhecimento: 1 embedding POR ENTRADA (curadas/curtas).
-- Ingestão assíncrona: nasce pending → embed gera embedding → synced/failed.
--
-- ⚠️ SEM coluna embedding (pgvector é Postgres-only).
-- Em SQLite, o vetor vive em serviço externo ou extensão sqlite-vss/sqlite-vec.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_knowledge_entries (
  id              TEXT PRIMARY KEY,
  category_id     TEXT NOT NULL REFERENCES ai_knowledge_categories(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  content         TEXT NOT NULL,
  content_format  TEXT NOT NULL DEFAULT 'markdown'
    CHECK (content_format IN ('markdown', 'text')),
  priority        INTEGER NOT NULL DEFAULT 0,
  valid_from      TEXT,
  valid_until     TEXT,
  version         INTEGER NOT NULL DEFAULT 1,
  sync_status     TEXT NOT NULL DEFAULT 'pending'
    CHECK (sync_status IN ('pending', 'processing', 'synced', 'failed')),
  embedding_model TEXT,
  visibility      TEXT NOT NULL DEFAULT 'internal'
    CHECK (visibility IN ('internal', 'portal')),
  tenant_id       TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  deleted_at      TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now')),
  created_by      TEXT,
  updated_by      TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_entries_cat ON ai_knowledge_entries(category_id);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_entries_tenant ON ai_knowledge_entries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_entries_sync
  ON ai_knowledge_entries(sync_status, created_at DESC)
  WHERE sync_status IN ('pending', 'failed');

CREATE TRIGGER IF NOT EXISTS ai_knowledge_entries_updated_at AFTER UPDATE ON ai_knowledge_entries
BEGIN UPDATE ai_knowledge_entries SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS ai_knowledge_entries_soft_delete AFTER UPDATE OF active ON ai_knowledge_entries
  WHEN OLD.active = 1 AND NEW.active = 0
BEGIN UPDATE ai_knowledge_entries SET deleted_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS ai_knowledge_entries_restore AFTER UPDATE OF active ON ai_knowledge_entries
  WHEN OLD.active = 0 AND NEW.active = 1
BEGIN UPDATE ai_knowledge_entries SET deleted_at = NULL WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS ai_knowledge_entries_audit_insert AFTER INSERT ON ai_knowledge_entries
BEGIN
  INSERT INTO audit_log (id, table_name, record_id, action, new_data, created_at)
  VALUES (lower(hex(randomblob(16))), 'ai_knowledge_entries', NEW.id, 'INSERT',
    json_object('title', NEW.title, 'category_id', NEW.category_id, 'visibility', NEW.visibility),
    datetime('now'));
END;

CREATE TRIGGER IF NOT EXISTS ai_knowledge_entries_audit_update AFTER UPDATE ON ai_knowledge_entries
BEGIN
  INSERT INTO audit_log (id, table_name, record_id, action, old_data, new_data, created_at)
  VALUES (lower(hex(randomblob(16))), 'ai_knowledge_entries', NEW.id, 'UPDATE',
    json_object('title', OLD.title, 'sync_status', OLD.sync_status, 'active', OLD.active),
    json_object('title', NEW.title, 'sync_status', NEW.sync_status, 'active', NEW.active),
    datetime('now'));
END;


-- ###########################################################################
-- 005_ai_cron.sql
-- ###########################################################################

-- =============================================================================
-- Migration 005 — Jobs de cron
-- =============================================================================
--- Registro de jobs agendados (ai_cron_jobs). Fonte de verdade do agendamento.
--- Em Postgres, a 034 materializa cada linha em cron.schedule por trigger.
--- Em SQLite/D1, o agendamento é feito pelo app (cron externo, Cloudflare Cron
--- Triggers, ou scheduler do runtime).
--- Depende de: nada
-- =============================================================================


-- =============================================================================
-- TABELA: ai_cron_jobs
-- Registro de jobs de cron e fonte de verdade do agendamento.
-- enabled=false desagenda e barra o disparo.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_cron_jobs (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  schedule        TEXT NOT NULL,
  target_function TEXT NOT NULL,
  agent           TEXT NOT NULL DEFAULT 'default',
  payload         TEXT NOT NULL DEFAULT '{}',
  enabled         INTEGER NOT NULL DEFAULT 1,
  last_run_at     TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  deleted_at      TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now')),
  created_by      TEXT,
  updated_by      TEXT
);

CREATE TRIGGER IF NOT EXISTS ai_cron_jobs_updated_at AFTER UPDATE ON ai_cron_jobs
BEGIN UPDATE ai_cron_jobs SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS ai_cron_jobs_soft_delete AFTER UPDATE OF active ON ai_cron_jobs
  WHEN OLD.active = 1 AND NEW.active = 0
BEGIN UPDATE ai_cron_jobs SET deleted_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS ai_cron_jobs_restore AFTER UPDATE OF active ON ai_cron_jobs
  WHEN OLD.active = 0 AND NEW.active = 1
BEGIN UPDATE ai_cron_jobs SET deleted_at = NULL WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS ai_cron_jobs_audit_insert AFTER INSERT ON ai_cron_jobs
BEGIN
  INSERT INTO audit_log (id, table_name, record_id, action, new_data, created_at)
  VALUES (lower(hex(randomblob(16))), 'ai_cron_jobs', NEW.id, 'INSERT',
    json_object('name', NEW.name, 'schedule', NEW.schedule, 'target_function', NEW.target_function),
    datetime('now'));
END;

CREATE TRIGGER IF NOT EXISTS ai_cron_jobs_audit_update AFTER UPDATE ON ai_cron_jobs
BEGIN
  INSERT INTO audit_log (id, table_name, record_id, action, old_data, new_data, created_at)
  VALUES (lower(hex(randomblob(16))), 'ai_cron_jobs', NEW.id, 'UPDATE',
    json_object('name', OLD.name, 'schedule', OLD.schedule, 'enabled', OLD.enabled, 'active', OLD.active),
    json_object('name', NEW.name, 'schedule', NEW.schedule, 'enabled', NEW.enabled, 'active', NEW.active),
    datetime('now'));
END;


-- ###########################################################################
-- 006_ai_insights.sql
-- ###########################################################################

-- =============================================================================
-- Migration 006 — Insights da IA com aprovação humana
-- =============================================================================
--- Observações geradas por IA sobre entidades do domínio (empresa, conversa,
--- ticket, reunião), pendentes de aprovação humana antes de virar fato.
--- entity_id é FK POLIMÓRFICA (não enforced) — rastreabilidade por convenção.
--- Depende de: nada (entity_id é soft ref)
-- =============================================================================


-- =============================================================================
-- TABELA: ai_insights
-- Observação gerada por IA, pendente de aprovação.
-- Status: suggested → approved | dismissed (humano decide).
-- Visibility: internal (só staff) | portal (cliente vê após aprovação).
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_insights (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('company', 'thread', 'ticket', 'meeting')),
  entity_id       TEXT NOT NULL,
  insight_type    TEXT NOT NULL CHECK (insight_type IN ('rapport', 'risk', 'action', 'praise')),
  title           TEXT NOT NULL,
  content         TEXT,
  status          TEXT NOT NULL DEFAULT 'suggested'
    CHECK (status IN ('suggested', 'approved', 'dismissed')),
  visibility      TEXT NOT NULL DEFAULT 'internal'
    CHECK (visibility IN ('internal', 'portal')),
  source          TEXT NOT NULL,
  source_id       TEXT,
  reviewed_by     TEXT,
  reviewed_at     TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  deleted_at      TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now')),
  created_by      TEXT,
  updated_by      TEXT,
  CHECK (
    (status = 'approved' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    OR (status = 'dismissed' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    OR (status = 'suggested' AND reviewed_by IS NULL AND reviewed_at IS NULL)
  )
);

-- Timeline: mais recente primeiro, por tenant
CREATE INDEX IF NOT EXISTS idx_ai_insights_tenant ON ai_insights(tenant_id, created_at DESC);

-- Resolver insights de UMA entidade específica
CREATE INDEX IF NOT EXISTS idx_ai_insights_entity ON ai_insights(entity_type, entity_id);

-- Fila de aprovação: só pendentes (índice parcial)
CREATE INDEX IF NOT EXISTS idx_ai_insights_pending
  ON ai_insights(tenant_id, created_at DESC)
  WHERE status = 'suggested';

-- Auditoria/debug: "quais insights este source gerou"
CREATE INDEX IF NOT EXISTS idx_ai_insights_source ON ai_insights(source, source_id);

CREATE TRIGGER IF NOT EXISTS ai_insights_updated_at AFTER UPDATE ON ai_insights
BEGIN UPDATE ai_insights SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS ai_insights_soft_delete AFTER UPDATE OF active ON ai_insights
  WHEN OLD.active = 1 AND NEW.active = 0
BEGIN UPDATE ai_insights SET deleted_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS ai_insights_restore AFTER UPDATE OF active ON ai_insights
  WHEN OLD.active = 0 AND NEW.active = 1
BEGIN UPDATE ai_insights SET deleted_at = NULL WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS ai_insights_audit_insert AFTER INSERT ON ai_insights
BEGIN
  INSERT INTO audit_log (id, table_name, record_id, action, new_data, created_at)
  VALUES (lower(hex(randomblob(16))), 'ai_insights', NEW.id, 'INSERT',
    json_object('entity_type', NEW.entity_type, 'insight_type', NEW.insight_type,
      'title', NEW.title, 'status', NEW.status, 'source', NEW.source),
    datetime('now'));
END;

CREATE TRIGGER IF NOT EXISTS ai_insights_audit_update AFTER UPDATE ON ai_insights
BEGIN
  INSERT INTO audit_log (id, table_name, record_id, action, old_data, new_data, created_at)
  VALUES (lower(hex(randomblob(16))), 'ai_insights', NEW.id, 'UPDATE',
    json_object('status', OLD.status, 'visibility', OLD.visibility, 'active', OLD.active),
    json_object('status', NEW.status, 'visibility', NEW.visibility, 'active', NEW.active),
    datetime('now'));
END;

