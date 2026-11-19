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

