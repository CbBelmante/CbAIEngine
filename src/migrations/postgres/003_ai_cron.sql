-- =============================================================================
-- Migration 003 — Tarefas agendadas do motor
-- =============================================================================
--- O que roda sozinho, com qual agente e com que carga. `last_run_at` é o que
--- separa «nunca rodou» de «rodou e falhou» — e os dois precisam de resposta
--- diferente de quem opera.
--- Depende de: 001_ai_config.sql
-- =============================================================================

create table if not exists engine.ai_cron_jobs (
  id               uuid primary key default gen_random_uuid(),
  name             text not null unique,
  schedule         text not null,
  target_function  text not null,
  agent            text not null default 'default',
  payload          jsonb not null default '{}'::jsonb,
  enabled          boolean not null default true,
  last_run_at      timestamptz,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  deleted_at       timestamptz,
  deleted_by       uuid
);

create trigger ai_cron_jobs_touch
  before update on engine.ai_cron_jobs
  for each row execute function engine.touch_updated_at();

alter table engine.ai_cron_jobs enable row level security;
