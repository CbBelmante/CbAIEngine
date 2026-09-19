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
