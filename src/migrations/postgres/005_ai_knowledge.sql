-- =============================================================================
-- Migration 005 — Base de conhecimento com busca vetorial
-- =============================================================================
--- Categorias curadas e entradas com embedding. Aqui mora a ÚNICA parte do
--- motor que não é agnóstica de banco: busca vetorial exige `pgvector`.
---
--- ⚠️ A VERSÃO SQLITE NÃO TEM A COLUNA `embedding`, e isso é o desenho: quem
--- roda em SQLite delega a busca a um serviço externo ou a uma extensão
--- (sqlite-vec), e o adapter absorve a diferença — o motor não sabe de nenhuma
--- das duas.
--- Depende de: 004_ai_runs.sql · extensão `vector`
-- =============================================================================

create extension if not exists vector;

create table if not exists engine.ai_knowledge_categories (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  slug         text not null unique,
  description  text,
  -- Categoria de fábrica não se apaga: é o que sobra quando alguém remove as outras.
  is_system    boolean not null default false,
  -- A categoria pode pender de outra: é o que dá árvore ao acervo.
  parent_id    uuid references engine.ai_knowledge_categories(id) on delete set null,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  updated_by   uuid,
  deleted_at   timestamptz,
  deleted_by   uuid
);

create trigger ai_knowledge_categories_touch
  before update on engine.ai_knowledge_categories
  for each row execute function engine.touch_updated_at();

-- =============================================================================
-- TABELA: ai_knowledge_entries
-- ⛔ A DIMENSÃO É 1536 e está fixada na coluna. Gravar vetor de outro tamanho
-- é erro de banco, e não uma busca que devolve resultado sem sentido.
-- =============================================================================

create table if not exists engine.ai_knowledge_entries (
  id               uuid primary key default gen_random_uuid(),
  category_id      uuid not null
                   references engine.ai_knowledge_categories(id) on delete cascade,
  title            text not null,
  content          text not null,
  content_format   text not null default 'markdown'
                   check (content_format in ('markdown', 'text')),
  priority         integer not null default 0,
  valid_from       timestamptz,
  valid_until      timestamptz,
  version          integer not null default 1,
  -- Toda entrada nasce `pending`: o embedding é gerado depois, por quem o faz.
  sync_status      text not null default 'pending'
                   check (sync_status in ('pending', 'processing', 'synced', 'failed')),
  embedding        vector(1536),
  embedding_model  text,
  visibility       text not null default 'internal'
                   check (visibility in ('internal', 'portal')),
  tenant_id        uuid,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  deleted_at       timestamptz,
  deleted_by       uuid,
  -- ⛔ SINCRONIZADA SEM VETOR é entrada que a busca nunca encontra, e que
  -- ninguém procura porque o estado diz que está pronta.
  constraint ai_knowledge_synced_has_embedding check (
    sync_status <> 'synced' or embedding is not null
  )
);

create index if not exists idx_ai_knowledge_entries_cat
  on engine.ai_knowledge_entries (category_id);
create index if not exists idx_ai_knowledge_entries_tenant
  on engine.ai_knowledge_entries (tenant_id);
create index if not exists idx_ai_knowledge_entries_sync
  on engine.ai_knowledge_entries (sync_status, created_at desc)
  where sync_status in ('pending', 'failed');

-- ⚠️ HNSW COM DISTÂNCIA DE COSSENO, que é a que o motor usa para similaridade.
-- Índice construído para outra distância devolve vizinho errado sem erro algum.
create index if not exists idx_ai_knowledge_entries_embedding
  on engine.ai_knowledge_entries using hnsw (embedding vector_cosine_ops);

create trigger ai_knowledge_entries_touch
  before update on engine.ai_knowledge_entries
  for each row execute function engine.touch_updated_at();

-- =============================================================================
-- FUNÇÃO: engine.search_knowledge
-- A busca que o adapter chama. Devolve similaridade E prioridade, porque a
-- ordenação do motor pesa as duas.
-- =============================================================================

create or replace function engine.search_knowledge(
  query_embedding vector(1536),
  match_count integer default 5,
  similarity_threshold real default 0.7,
  priority_weight real default 0.2
)
returns table (
  id uuid,
  title text,
  content text,
  category_id uuid,
  priority integer,
  similarity real,
  score real
)
language sql
stable
as $$
  select
    e.id, e.title, e.content, e.category_id, e.priority,
    (1 - (e.embedding <=> query_embedding))::real as similarity,
    ((1 - (e.embedding <=> query_embedding)) + priority_weight * e.priority)::real as score
  from engine.ai_knowledge_entries e
  where e.active = true
    and e.deleted_at is null
    and e.sync_status = 'synced'
    and (e.valid_from is null or e.valid_from <= now())
    and (e.valid_until is null or e.valid_until >= now())
    and (1 - (e.embedding <=> query_embedding)) >= similarity_threshold
  order by score desc
  limit match_count;
$$;

alter table engine.ai_knowledge_categories enable row level security;
alter table engine.ai_knowledge_entries enable row level security;
