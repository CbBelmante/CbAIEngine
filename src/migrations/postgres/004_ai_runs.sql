-- =============================================================================
-- Migration 004 — Observabilidade: execuções, invocações e passos
-- =============================================================================
--- Um `run` por chamada do agente; uma `invocation` por ida ao modelo; um
--- `step` por passo do trace. É daqui que saem custo e latência por tenant.
--- Depende de: 003_ai_cron.sql
-- =============================================================================

create table if not exists engine.ai_agent_runs (
  id           uuid primary key default gen_random_uuid(),
  agent        text not null,
  tenant_id    uuid,
  trigger      text not null default 'user' check (trigger in ('manual', 'cron', 'user')),
  cron_job_id  uuid references engine.ai_cron_jobs(id) on delete set null,
  status       text not null default 'running' check (status in ('running', 'ok', 'error')),
  error        text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  -- O handle da chamada assíncrona, quando o run foi disparado por agendamento.
  -- É por ele que a coleta de resultado reencontra o que disparou.
  net_request_id  bigint
);

create index if not exists idx_ai_agent_runs_started
  on engine.ai_agent_runs (started_at desc);
create index if not exists idx_ai_agent_runs_agent on engine.ai_agent_runs (agent);
create index if not exists idx_ai_agent_runs_tenant
  on engine.ai_agent_runs (tenant_id, started_at);
create index if not exists idx_ai_agent_runs_cron on engine.ai_agent_runs (cron_job_id);

-- =============================================================================
-- TABELA: ai_invocations
-- ⚠️ `cost_usd` NULO É «SEM PREÇO CADASTRADO», e nunca zero: zero diria que a
-- chamada foi de graça, e é assim que uma conta grande passa despercebida.
-- =============================================================================

create table if not exists engine.ai_invocations (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid not null references engine.ai_agent_runs(id) on delete cascade,
  provider           text not null,
  model              text not null,
  prompt_tokens      integer,
  -- ⚠️ NULO E ZERO SÃO COISAS DIFERENTES: nulo é «o provedor não informa» —
  -- não cacheia este modelo, ou o recurso não está na conta; zero é «informa e
  -- não houve aproveitamento». Colapsar os dois faria o painel afirmar que
  -- nada cacheou quando na verdade ninguém mediu.
  cached_prompt_tokens  integer,
  completion_tokens  integer,
  total_tokens       integer,
  cost_usd           numeric(12,6),
  latency_ms         integer,
  tool_calls         integer not null default 0,
  created_at         timestamptz not null default now()
);

create index if not exists idx_ai_invocations_run on engine.ai_invocations (run_id);
create index if not exists idx_ai_invocations_created
  on engine.ai_invocations (created_at desc);

create table if not exists engine.ai_run_steps (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references engine.ai_agent_runs(id) on delete cascade,
  seq          integer not null,
  step_type    text not null check (step_type in
                 ('model_call', 'model_response', 'rag_search',
                  'tool_call', 'tool_result', 'middleware', 'error')),
  -- ⚠️ O PAYLOAD JÁ CHEGA REDIGIDO: a redação de PII acontece antes de gravar,
  -- e não na leitura — o trace é lido por gente e exportado por máquina.
  payload      jsonb,
  duration_ms  integer,
  created_at   timestamptz not null default now()
);

create index if not exists idx_ai_run_steps_run on engine.ai_run_steps (run_id, seq);

alter table engine.ai_agent_runs enable row level security;
alter table engine.ai_invocations enable row level security;
alter table engine.ai_run_steps enable row level security;
