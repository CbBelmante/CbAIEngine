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

-- ⚠️ A AUDITORIA É POLÍTICA DO HOST, e por isso não está aqui: nome, formato e
-- retenção são de quem usa o motor. Gravar numa tabela que a biblioteca não
-- declara faria o schema não aplicar sozinho.

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

  -- POLÍTICA DE ESPERA QUANDO O PROVEDOR RECUSA POR EXCESSO (HTTP 429)
  --
  -- Mora no PROVEDOR, e não no agente, porque o teto é da CONTA: seis agentes
  -- apontando para a mesma casa disputam a mesma cota por minuto.
  --
  -- ⚠️ SÃO TETO, NÃO DURAÇÃO: o motor espera o que o provedor PEDIU, e usa
  -- estes números só para decidir se topa esperar tanto. Lidos como duração,
  -- quem quisesse resposta rápida os baixaria sem notar que o efeito real é
  -- DESISTIR mais cedo.
  retry_max_attempts             INTEGER NOT NULL DEFAULT 3,
  retry_max_wait_interactive_ms  INTEGER NOT NULL DEFAULT 10000,
  retry_max_wait_batch_ms        INTEGER NOT NULL DEFAULT 60000,

  active          INTEGER NOT NULL DEFAULT 1,
  deleted_at      TEXT,
  deleted_by      TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now')),
  created_by      TEXT,
  updated_by      TEXT,
  CHECK (base_url IS NOT NULL OR NOT enabled),
  CHECK (retry_max_attempts BETWEEN 0 AND 10),
  -- Espera negativa não existe, e zero desliga a espera daquele eixo. Cinco
  -- minutos é onde insistir virou fila: a decisão passa a ser de quem agenda.
  CHECK (retry_max_wait_interactive_ms BETWEEN 0 AND 300000
         AND retry_max_wait_batch_ms BETWEEN 0 AND 300000)
);

CREATE TRIGGER IF NOT EXISTS ai_providers_updated_at AFTER UPDATE ON ai_providers
BEGIN UPDATE ai_providers SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS ai_providers_soft_delete AFTER UPDATE OF active ON ai_providers
  WHEN OLD.active = 1 AND NEW.active = 0
BEGIN UPDATE ai_providers SET deleted_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS ai_providers_restore AFTER UPDATE OF active ON ai_providers
  WHEN OLD.active = 0 AND NEW.active = 1
BEGIN UPDATE ai_providers SET deleted_at = NULL WHERE id = NEW.id; END;


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
  deleted_by      TEXT,
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
  deleted_by      TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now')),
  created_by      TEXT,
  updated_by      TEXT,
  UNIQUE (provider, model)
);

CREATE TRIGGER IF NOT EXISTS ai_model_pricing_updated_at AFTER UPDATE ON ai_model_pricing
BEGIN UPDATE ai_model_pricing SET updated_at = datetime('now') WHERE id = NEW.id; END;


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

-- ⚠️ A AUDITORIA É POLÍTICA DO HOST, e por isso não está aqui: nome, formato e
-- retenção são de quem usa o motor. Gravar numa tabela que a biblioteca não
-- declara faria o schema não aplicar sozinho.

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
  deleted_by      TEXT,
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

-- =============================================================================
-- VIEW: ai_credentials_view
-- Leitura sem api_key. Só registros ativos.
-- =============================================================================

CREATE VIEW IF NOT EXISTS ai_credentials_view AS
  SELECT id, provider, tenant_id, last4, rotated_at, active, created_at, updated_at
  FROM ai_credentials
  WHERE active = 1;

-- ###########################################################################
-- 003_ai_cron.sql
-- ###########################################################################

-- =============================================================================
-- Migration 003 — Jobs de cron
-- =============================================================================
--- Registro de jobs agendados (ai_cron_jobs). Fonte de verdade do agendamento.
--- Em Postgres, a 034 materializa cada linha em cron.schedule por trigger.
--- Em SQLite/D1, o agendamento é feito pelo app (cron externo, Cloudflare Cron
--- Triggers, ou scheduler do runtime).
--- Depende de: nada
-- =============================================================================

-- ⚠️ A AUDITORIA É POLÍTICA DO HOST, e por isso não está aqui: nome, formato e
-- retenção são de quem usa o motor. Gravar numa tabela que a biblioteca não
-- declara faria o schema não aplicar sozinho.

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
  deleted_by      TEXT,
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


-- ###########################################################################
-- 004_ai_runs.sql
-- ###########################################################################

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

-- ###########################################################################
-- 005_ai_knowledge.sql
-- ###########################################################################

-- =============================================================================
-- Migration 005 — Base de conhecimento (RAG)
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

-- ⚠️ A AUDITORIA É POLÍTICA DO HOST, e por isso não está aqui: nome, formato e
-- retenção são de quem usa o motor. Gravar numa tabela que a biblioteca não
-- declara faria o schema não aplicar sozinho.

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
  -- A categoria pode pender de outra: é o que dá árvore ao acervo.
  parent_id       TEXT REFERENCES ai_knowledge_categories(id) ON DELETE SET NULL,
  active          INTEGER NOT NULL DEFAULT 1,
  deleted_at      TEXT,
  deleted_by      TEXT,
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
  deleted_by      TEXT,
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

-- ⚠️ A AUDITORIA É POLÍTICA DO HOST, e por isso não está aqui: nome, formato e
-- retenção são de quem usa o motor. Gravar numa tabela que a biblioteca não
-- declara faria o schema não aplicar sozinho.

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
  deleted_by      TEXT,
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

