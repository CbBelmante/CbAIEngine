-- =============================================================================
-- Migration 006 — Insights propostos pelo agente, revisados por gente
-- =============================================================================
--- O agente PROPÕE; quem aprova ou descarta é pessoa, e o par revisor+data é
--- cobrado pelo banco. Sem isso, «aprovado» existiria sem ninguém por trás.
--- Depende de: 004_ai_runs.sql
-- =============================================================================

create table if not exists engine.ai_insights (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  entity_type   text not null check (entity_type in ('company', 'thread', 'ticket', 'meeting')),
  entity_id     uuid not null,
  insight_type  text not null check (insight_type in ('rapport', 'risk', 'action', 'praise')),
  title         text not null,
  content       text,
  status        text not null default 'suggested'
                check (status in ('suggested', 'approved', 'dismissed')),
  visibility    text not null default 'internal'
                check (visibility in ('internal', 'portal')),
  source        text not null,
  source_id     uuid,
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  deleted_at    timestamptz,
  deleted_by    uuid,
  -- ⛔ REVISÃO É PAR: quem revisou e quando. Aprovado sem revisor é decisão sem
  -- dono, e sugerido COM revisor é revisão que não mudou nada.
  constraint ai_insights_review_matches_status check (
    (status in ('approved', 'dismissed') and reviewed_by is not null and reviewed_at is not null)
    or (status = 'suggested' and reviewed_by is null and reviewed_at is null)
  )
);

create index if not exists idx_ai_insights_tenant
  on engine.ai_insights (tenant_id, created_at desc);
create index if not exists idx_ai_insights_entity
  on engine.ai_insights (entity_type, entity_id);
create index if not exists idx_ai_insights_pending
  on engine.ai_insights (tenant_id, created_at desc) where status = 'suggested';
create index if not exists idx_ai_insights_source
  on engine.ai_insights (source, source_id);

create trigger ai_insights_touch
  before update on engine.ai_insights
  for each row execute function engine.touch_updated_at();

alter table engine.ai_insights enable row level security;
