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
