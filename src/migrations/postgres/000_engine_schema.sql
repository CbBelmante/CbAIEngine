-- =============================================================================
-- Migration 000 — O schema do motor, e o gatilho de `updated_at`
-- =============================================================================
--- Toda tabela do motor mora no schema `engine`, e não em `public`. A razão é
--- do PostgREST: `public` é o que ele expõe por padrão, e a tabela de
--- CREDENCIAIS do motor não tem o que fazer numa API REST.
---
--- ⛔ RLS LIGADA E SEM POLICY NENHUMA, de propósito. Zero policy é zero acesso
--- para todo papel comum: só a conexão de serviço — que ignora RLS — alcança
--- estas tabelas, e é exatamente por ela que o motor fala. O host que quiser
--- expor alguma delas a um papel seu escreve a policy no repositório DELE.
---
--- ⚠️ AUDITORIA É POLÍTICA DO HOST, e por isso não está aqui. A versão SQLite
--- grava em `audit_log` porque nasceu dentro de um app que tinha essa tabela;
--- uma biblioteca não pode presumir o nome nem o formato da auditoria de quem a
--- usa. O que vai junto é o `updated_at`, que é da própria linha.
--- Depende de: nada (primeira migration do motor)
-- =============================================================================

create schema if not exists engine;

-- =============================================================================
-- FUNÇÃO: engine.touch_updated_at
-- O carimbo de alteração da própria linha.
-- =============================================================================

create or replace function engine.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();

  return new;
end;
$$;
