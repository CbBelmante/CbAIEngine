-- =============================================================================
-- Migration 002 — Credenciais por provider, com isolamento por tenant
-- =============================================================================
--- A chave de API mora aqui, e só aqui. `last4` é derivada da própria coluna,
--- para a tela identificar a chave sem nunca lê-la inteira.
--- Depende de: 001_ai_config.sql
-- =============================================================================

create table if not exists engine.ai_credentials (
  id          uuid primary key default gen_random_uuid(),
  provider    text not null references engine.ai_providers(slug),
  -- Nulo é a credencial GLOBAL; preenchido é a do tenant, que a precede.
  tenant_id   uuid,
  api_key     text not null,
  -- ⛔ COLUNA GERADA, e não um campo que alguém preenche: `last4` divergindo da
  -- chave faria a tela identificar a credencial errada na hora de girá-la.
  last4       text generated always as (right(api_key, 4)) stored,
  rotated_at  timestamptz,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  deleted_at  timestamptz,
  deleted_by  uuid
);

create unique index if not exists ai_credentials_provider_global_uk
  on engine.ai_credentials (provider) where tenant_id is null;

create unique index if not exists ai_credentials_provider_tenant_uk
  on engine.ai_credentials (provider, tenant_id) where tenant_id is not null;

create index if not exists idx_ai_credentials_provider on engine.ai_credentials (provider);
create index if not exists idx_ai_credentials_tenant on engine.ai_credentials (tenant_id);

create trigger ai_credentials_touch
  before update on engine.ai_credentials
  for each row execute function engine.touch_updated_at();

-- ⛔ A VISÃO EXISTE PARA QUE A CHAVE NÃO PRECISE SAIR DA TABELA. Quem monta
-- tela de credencial lê daqui, e aqui `api_key` não existe.
create or replace view engine.ai_credentials_view as
  select id, provider, tenant_id, last4, rotated_at, active, created_at, updated_at
  from engine.ai_credentials
  where active = true;

-- ⛔ E A CHAVE NÃO SAI NEM POR ENGANO: quem puder ler a visão não herda leitura
-- da tabela, e é por isso que a permissão é concedida aqui e revogada lá.
revoke all on engine.ai_credentials from public;

alter table engine.ai_credentials enable row level security;
