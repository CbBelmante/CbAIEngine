# Próxima Sessão — CbAIEngine

**Estado:** ✅ Motor portado, desacoplado, 120/124 testes passando, build ESM+CJS+DTS
funcionando, migrations SQLite prontas, zero Supabase no código.

**Repo:** https://github.com/CbBelmante/CbAIEngine (privado, 5 commits na main)

**Origem:** Portado do motor de IA do Volan Pulso (`_common/agent/` + `core/ai/` +
`pulso-assistant/`). Abordagem: `cp` + `sed` mecânico + desacoplamento via `IAiDbAdapter`.

---

## O que é este projeto

Motor de IA TypeScript que faz para inteligência artificial o que o Better Auth
faz para autenticação: **database-first, provider-agnostic, multi-tenant**,
com observabilidade e quotas embutidas.

Segue o padrão `IDataAdapter` do BelmarsalBallet — interface mínima, implementações
concretas por backend, toda diferença absorvida dentro do adapter.

---

## O que está PRONTO

### Core engine (100% funcional)
- Loop de tool-calling genérico (`runAgentLoop`)
- Tool runner que nunca lança (erro vira tool result)
- Providers: Anthropic + OpenAI-compatible (fetch puro)
- Middleware pipeline: 3 fases (pre-context, pre-model, post-model)
- PII redaction (CPF módulo 11 + telefone BR, 3 pontos de redação)
- Moderação bidirecional (input + output)
- Context summarization memoizada
- Structured output com retry automático
- Prompt template stable/volatile (prompt caching por construção)
- Presets de comportamento (separado de modelo)
- Validação na entrada (todos os defeitos de uma vez)

### Desacoplamento (100% feito)
- `IAiDbAdapter` com 18 métodos (config, credentials, providers, observability, pricing, quota, knowledge, insights, messages)
- `createMemoryAdapter` para testes
- Zero queries `.from().select().eq()` em todo `src/`
- Parâmetro nomeado `dbAdapter` (não confundir com `IProviderAdapter`)

### Migrations SQLite (estilo BelmarsalBallet)
- 6 migrations agrupadas por domínio + `schema.sql` + `migrate.ts` runner
- 001: providers + config + pricing
- 002: credentials + view
- 003: cron jobs
- 004: runs + invocations + steps
- 005: knowledge (categories + entries, sem vector)
- 006: insights

### Docs
- README.md (completo, com API surface e quick start)
- CLAUDE.md (diretivas de trabalho)
- CODE_STYLE_GUIDE.md + JSDOC_GUIDE.md (copiados do iPetite)

### Testes
- 7 arquivos, 120/124 passando
- 4 falhas em `contextSummarization.test.ts` (formato de payload do mock — ver abaixo)

---

## O que FALTA (próximas sessões)

### Prioridade 1 — Fazer funcionar end-to-end

#### 4 testes de contextSummarization
- Os testes assertam sobre o payload snake_case que o mock antigo (`IObservabilityDb`)
  gravava. O mock novo (`IAiDbAdapter`) grava via `recordStep()` que recebe camelCase.
- A função `stepsOf(rows)` filtra por `step_type` (snake) mas agora é `stepType` (camel).
- Corrigir o helper `stepsOf` e as assertivas de payload.

#### Kysely adapter (`createKyselyAdapter`)
- Implementação real do `IAiDbAdapter` para Postgres e SQLite
- Usa Kysely query builder (mesmo que o Better Auth usa)
- Testa contra SQLite real via `better-sqlite3`
- É o que faz o engine rodar em produção

#### Migrations Postgres
- Versão Postgres das 6 migrations (uuid, timestamptz, jsonb, vector, RLS)
- Mesma estrutura domain-grouped do SQLite
- RLS policies por tabela (como no Pulso original)

#### Testes de integração
- Rodar Kysely adapter contra SQLite real
- Testar cascata de config, credenciais, observability
- Testar com migrations aplicadas

### Prioridade 2 — Features novas

#### Streaming (MUST HAVE)
- `ai.agent().stream()` retornando `AsyncIterable<NStreamChunk>`
- Stream adapter por provider (Anthropic SSE → chunks neutros, OpenAI SSE → chunks neutros)
- Helpers: `toTextStreamResponse()`, `toDataStreamResponse()`
- Frontend hooks em pacotes separados (`@cbai/react`, `@cbai/vue`)

#### Zod no outputSchema
- Aceitar Zod schema OU JSON Schema (converter via `zod-to-json-schema`)
- Retry com feedback de validação Zod

#### OpenTelemetry
- Exportar spans OTEL além da gravação em banco
- GenAI Semantic Conventions
- Privacy-by-default

### Prioridade 3 — Polish

#### CLI
- `npx cbai generate --dialect postgres|sqlite` → gera migrations
- `npx cbai migrate` → aplica pendentes (como `dbMigrate.ts` do Ballet)

#### Adapter Supabase
- Para o Pulso migrar e usar o engine como dependência
- Implementa `IAiDbAdapter` com Supabase client

---

## Decisões já tomadas

1. **Nome do repo:** CbAIEngine
2. **Padrão de adapter:** `IAiDbAdapter` (inspirado no `IDataAdapter` do Ballet)
3. **Parâmetro:** `dbAdapter` (não `adapter` — clareza vs `IProviderAdapter`)
4. **Portabilidade:** `cp` + `sed` — cópia fiel com ajustes mecânicos
5. **Migrations:** SQL puro por domínio (estilo Ballet), não gerador TS
6. **Dialetos separados:** `sqlite/` e `postgres/` (SQL diferente, não dá pra unificar)
7. **IObservabilityDb:** mantido como interface interna genérica (não é acoplamento)
8. **Streaming e Zod:** deixados pra depois (Prioridade 2)
9. **NoSQL (Firestore):** suportável via `IAiDbAdapter` (sem migrations, adapter-only)

## Referências

- **Plano completo:** `~/Workspaces/plano-tenantai.html`
- **Análise técnica:** `~/Workspaces/pulso-ai-analise.html`
- **Adapter pattern:** `~/Workspaces/BelmarsalBallet/composables/crud/useDataAdapter.ts`
- **Migration runner:** `~/Workspaces/BelmarsalBallet/scripts/dbMigrate.ts`
- **Better Auth config:** `~/Workspaces/BelmarsalBallet/server/utils/auth.ts`

---

*📅 Atualizado em*: 19 SET 2026
