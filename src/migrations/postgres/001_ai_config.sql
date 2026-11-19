-- =============================================================================
-- Migration 001 — Providers, configuração de agentes e pricing
-- =============================================================================
--- Catálogo de providers (ai_providers), config por agente com override por
--- tenant (ai_config) e pricing declarativo por (provider, model).
--- Depende de: 000_engine_schema.sql
-- =============================================================================

-- =============================================================================
-- TABELA: ai_providers
-- Catálogo de providers: cadastrar um novo é DADO, não deploy.
-- Nasce VAZIO — o operador cadastra os que vai usar.
-- =============================================================================

create table if not exists engine.ai_providers (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  base_url    text,
  protocol    text not null check (protocol in ('anthropic', 'openai-compatible')),
  -- `enabled` é «em uso?» e `active` é «existe?»: eixos ortogonais, e juntar os
  -- dois faria desligar um provedor virar apagá-lo.
  enabled     boolean not null default true,

  -- POLÍTICA DE ESPERA QUANDO O PROVEDOR RECUSA POR EXCESSO (HTTP 429)
  --
  -- Mora no PROVEDOR, e não no agente, porque o teto é da CONTA: seis agentes
  -- apontando para a mesma casa disputam a mesma cota por minuto, e guardar
  -- isso por agente espalharia o mesmo número por seis lugares que divergiriam.
  --
  -- ⚠️ OS DOIS VALORES SÃO TETO, NÃO DURAÇÃO. O motor não espera este tempo:
  -- ele espera o que o provedor PEDIU, e usa estes números só para decidir se
  -- topa esperar tanto. Lidos como duração, parecem atraso que alguém impôs — e
  -- quem quisesse resposta rápida os baixaria sem notar que o efeito real é
  -- DESISTIR mais cedo.
  --
  -- São dois porque quem espera é diferente em cada caso: num turno de conversa
  -- há alguém olhando a tela, e trinta segundos de silêncio são
  -- indistinguíveis de travamento; num lote de fundo ninguém está olhando, e
  -- esperar é melhor do que perder o item.
  retry_max_attempts             smallint not null default 3,
  retry_max_wait_interactive_ms  integer not null default 10000,
  retry_max_wait_batch_ms        integer not null default 60000,

  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  deleted_at  timestamptz,
  deleted_by  uuid,
  -- ⛔ PROVEDOR LIGADO SEM ENDEREÇO não tem para onde ligar, e o adapter
  -- recusaria com «Unknown provider» — erro que não diz o que falta.
  constraint ai_providers_enabled_needs_url check (base_url is not null or not enabled),
  constraint ai_providers_retry_attempts_check check (retry_max_attempts between 0 and 10),
  -- Espera negativa não existe, e zero desliga a espera daquele eixo. O teto de
  -- cinco minutos é o ponto em que insistir deixou de ser espera e virou fila:
  -- a decisão passa a ser de quem agenda, não de quem tenta.
  constraint ai_providers_retry_wait_check check (
    retry_max_wait_interactive_ms between 0 and 300000
    and retry_max_wait_batch_ms between 0 and 300000
  )
);

create trigger ai_providers_touch
  before update on engine.ai_providers
  for each row execute function engine.touch_updated_at();

-- =============================================================================
-- TABELA: ai_config
-- Provider + modelo por agente. NÃO guarda chave de API.
-- Cascata: override do tenant → global do agente → agente `default` → erro.
-- =============================================================================

create table if not exists engine.ai_config (
  id          uuid primary key default gen_random_uuid(),
  agent       text not null,
  -- Nulo é o DEFAULT GLOBAL daquele agente; preenchido é override do tenant.
  tenant_id   uuid,
  provider    text not null references engine.ai_providers(slug),
  model       text not null,
  params      jsonb not null default '{}'::jsonb,
  enabled     boolean not null default true,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  deleted_at  timestamptz,
  deleted_by  uuid
);

-- ⛔ UM DEFAULT GLOBAL POR AGENTE. Em SQL, `null` não colide com `null` num
-- `unique` comum: dois globais do mesmo agente entrariam, e a cascata
-- escolheria um por sorte.
create unique index if not exists ai_config_agent_global_uk
  on engine.ai_config (agent) where tenant_id is null;

create unique index if not exists ai_config_agent_tenant_uk
  on engine.ai_config (agent, tenant_id) where tenant_id is not null;

create index if not exists idx_ai_config_tenant on engine.ai_config (tenant_id);

create trigger ai_config_touch
  before update on engine.ai_config
  for each row execute function engine.touch_updated_at();

-- =============================================================================
-- TABELA: ai_model_pricing
-- Preço por (provider, model). É a fonte do custo de cada invocação.
--
-- ⚠️ NASCE VAZIA, e isso é regra: sem preço cadastrado o custo é NULO, nunca
-- zero. A tela é obrigada a dizer «sem preço» em vez de «US$ 0,00».
-- =============================================================================

create table if not exists engine.ai_model_pricing (
  id             uuid primary key default gen_random_uuid(),
  provider       text not null references engine.ai_providers(slug),
  model          text not null,
  input_per_1k   numeric(12,6) not null check (input_per_1k >= 0),
  output_per_1k  numeric(12,6) not null check (output_per_1k >= 0),
  currency       text not null default 'USD',
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  updated_by     uuid,
  deleted_at     timestamptz,
  deleted_by     uuid,
  constraint ai_model_pricing_pair_uk unique (provider, model)
);

create trigger ai_model_pricing_touch
  before update on engine.ai_model_pricing
  for each row execute function engine.touch_updated_at();

alter table engine.ai_providers enable row level security;
alter table engine.ai_config enable row level security;
alter table engine.ai_model_pricing enable row level security;
