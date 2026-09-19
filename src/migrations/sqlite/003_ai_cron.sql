-- =============================================================================
-- Migration 003 — Jobs de cron
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
