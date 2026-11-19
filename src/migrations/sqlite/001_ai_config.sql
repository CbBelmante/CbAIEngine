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

