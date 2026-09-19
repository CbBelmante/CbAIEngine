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
