# CLAUDE.md — CbAIEngine

Diretivas específicas pro trabalho neste repo. Lidas automaticamente toda
sessão. Adendo às regras globais do `~/CLAUDE.md`.

## 🛠️ Stack

- **Tipo**: Biblioteca TypeScript (não app) — build gera ESM + CJS + DTS via tsup
- **Runtime**: Node.js, Deno, Bun, Cloudflare Workers (fetch puro, sem SDK)
- **Testes**: Vitest — 7 arquivos, 124 testes
- **Providers**: 2 adapters built-in (Anthropic + OpenAI-compatible)
- **Banco**: Agnóstico via `IAiDbAdapter` — adapters concretos por backend
- **Origem**: Portado do motor de IA do Volan Pulso, desacoplado de Supabase

## 🏗️ Estrutura do Projeto

```
src/
├── core/                 → Motor principal (14 arquivos)
│   ├── types.ts          → Tipos neutros: NMessage, NResponse, NToolCall, IProviderAdapter
│   ├── loop.ts           → Loop de tool-calling genérico (runAgentLoop)
│   ├── toolRunner.ts     → Execução de tools (nunca lança — erro vira tool result)
│   ├── tools.ts          → Registry de tools (defineTool, createToolRegistry)
│   ├── hooks.ts          → Hooks read-only, fail-soft (emitHook)
│   ├── structuredOutput.ts → Saída tipada com retry automático
│   ├── jsonSchema.ts     → Validador JSON Schema mínimo (sem dependência)
│   ├── prompt.ts         → Templates stable/volatile (prompt caching por construção)
│   ├── preset.ts         → Presets de comportamento (sem modelo)
│   ├── config.ts         → Cascata de config via adapter (tenant→global→default)
│   ├── validation.ts     → Validação na entrada (todos os defeitos de uma vez)
│   ├── middleware.ts      → Pipeline de middleware (pre-context, pre-model, post-model)
│   ├── agentConfigSchema.ts → Schema de validação do config
│   ├── presets/assistant.ts → Preset padrão do assistente
│   └── index.ts          → createAgent + barrel exports
│
├── providers/            → Adapters de provider (5 arquivos)
│   ├── anthropic.ts      → /v1/messages + x-api-key
│   ├── openaiCompatible.ts → /chat/completions + Bearer (Groq, Together, DeepSeek, Ollama)
│   ├── registry.ts       → Map de providers + ConfigError
│   ├── errors.ts         → ProviderParseError, ProviderHttpError
│   └── index.ts
│
├── middleware/            → Middlewares plugáveis (5 arquivos)
│   ├── piiRedaction.ts   → CPF (módulo 11) + telefone BR — ordinais estáveis
│   ├── moderation.ts     → Bidirecional (input pre-context + output post-model)
│   ├── catalogProvider.ts → Provider de moderação determinístico (sem rede)
│   ├── contextSummarization.ts → Condensação memoizada de contexto longo
│   └── index.ts
│
├── observability/        → Rastreabilidade (7 arquivos)
│   ├── types.ts          → IObservabilityDb — interface genérica de persistência
│   ├── runRecorder.ts    → Grava runs com pricing cache
│   ├── stepSink.ts       → Canal diferido para middleware gravar steps
│   ├── pricing.ts        → fetchModelPricing + calculateCostUsd (null, nunca zero)
│   ├── persistenceHooks.ts → Conecta recorder ao loop via IAgentHooks
│   ├── rows.ts           → Builders de linhas (PII redigido + truncado)
│   └── index.ts
│
├── definitions/          → Vocabulários e constantes (13 arquivos)
│   ├── aiProviders.ts    → Protocolos: 'anthropic' | 'openai-compatible'
│   ├── aiConfig.ts       → Thresholds: WARNING=80%, BLOCK=100%
│   ├── aiObservability.ts → Triggers, statuses, step types
│   ├── aiAgents.ts       → Agentes: default, assistant, summarize, analyze, meeting, embedding
│   ├── ragConfig.ts      → Defaults da busca vetorial
│   ├── piiCatalog.ts     → Categorias PII, patterns, placeholders
│   ├── moderationCatalog.ts → Categorias, termos, labels
│   ├── contextSummarization.ts → Política de sumarização
│   ├── knowledgeConfig.ts → Config do pipeline de knowledge
│   ├── knowledgeVocabulary.ts → Vocabulário do sistema de conhecimento
│   ├── assistantContract.ts → Contrato request/response do assistente
│   ├── assistantPrompt.ts → Prompt base do assistente
│   └── index.ts
│
├── dbAdapter/            → Adapter de banco — padrão IDataAdapter (4 arquivos)
│   ├── dbAdapter.ts      → IAiDbAdapter — contrato completo (config, credentials, providers, observability, knowledge, insights, messages)
│   ├── types.ts          → Tipos do adapter
│   ├── memoryAdapter.ts  → Adapter de memória (testes e dev)
│   └── index.ts
│
├── runtime/              → Runtimes que orquestram o engine (10 arquivos)
│   ├── agentRuntime.ts   → Factory: config + recorder + hooks → agente pronto
│   ├── aiPort.ts         → Porta unificada: resolve provider + config + key
│   ├── providerCatalog.ts → Lê providers do banco e registra no Map
│   ├── promptCache.ts    → Blocos stable/volatile para Anthropic (cache_control)
│   ├── embeddingRuntime.ts → Monta embedder pela mesma porta
│   ├── knowledgeSearch.ts → Busca vetorial via adapter
│   ├── moderationRuntime.ts → Monta pipeline de moderação
│   ├── summarizerRuntime.ts → Monta sumarizador
│   ├── embedDispatch.ts  → Fire-and-forget de embedding
│   └── insightWriter.ts  → Grava insights da IA
│
├── engine/               → Módulos do engine (7 arquivos)
│   ├── consumptionGate.ts → Gate de quota (warning + block)
│   ├── memoryWriter.ts   → Grava memórias com PII redigido
│   ├── knowledgeRetrieval.ts → Retrieval de conhecimento
│   └── tools/            → Tools padrão do engine
│       ├── memory.ts     → Tool save_memory
│       ├── context.ts    → Tool context (grava mensagens)
│       ├── sanitize.ts   → Sanitização de tools
│       └── db.ts         → Helpers de DB para tools
│
└── index.ts              → Barrel export principal

tests/                    → 7 arquivos de teste (124 testes)
docs/                     → CODE_STYLE_GUIDE.md + JSDOC_GUIDE.md
```

## 🚨 Regras Duras

### Adapter — toda persistência via IAiDbAdapter
- **NUNCA** fazer queries diretas ao banco (`.from()`, `.select()`, `.eq()`, `.rpc()`)
- **SEMPRE** via métodos nomeados do `IAiDbAdapter`
- `IObservabilityDb` é a única exceção — interface genérica interna de observabilidade

### Config — zero fallback silencioso
- Sem config cadastrada = `ConfigError`, **NUNCA** assume modelo/provider
- Cascata explícita: tenant → global → agente `default` → erro
- `active` (existe?) e `enabled` (em uso?) são eixos ortogonais

### Tools — nunca lança
- Tool inexistente, negada, ou handler quebrado → vira `IToolOutput` de erro
- O modelo recebe o erro e se adapta — o agente não crasha

### Observabilidade — fail-soft
- Hooks são read-only: retorno descartado, exceção logada e engolida
- Observabilidade quebrada não derruba o agente

### Pricing — nunca estimado
- Sem preço cadastrado → `null`, **NUNCA** zero
- A tela é obrigada a exibir "sem preço", não US$ 0,00

### PII — 3 pontos de redação
1. Mensagens antes de ir ao provider
2. save_memory antes de gravar
3. Payload do trace antes de persistir

### Providers — agnóstico
- Dois protocolos: `anthropic` e `openai-compatible`
- Nenhum `if` de marca no motor — assimetrias morrem dentro do adapter
- Cadastrar novo provider é dado no banco, não código

## ✍️ Convenções

- **Types**: Interfaces com prefixo `I` (`IAiProvider`, `IAgentConfig`), types sem prefixo
- **Constantes**: `SCREAMING_SNAKE_CASE` com `as const satisfies`
- **Imports**: Relativos (`../core/types`), sem extensão `.ts`
- **Commits**: Conventional commits em português. NUNCA adicionar `Co-Authored-By`
- **Testes**: Vitest, sem `.forEach()` (usar `for...of`)
- **JSDoc**: Seguir `docs/JSDOC_GUIDE.md` — documentar só o NÃO óbvio
- **CSS**: N/A (biblioteca server-side, sem UI)

## 🔧 Comandos

```bash
npm run build            # Build ESM + CJS + DTS (tsup)
npm run dev              # Build em watch mode
npm run typecheck        # TypeScript sem emitir
npm run test             # Vitest (watch)
npm run test:run         # Vitest (single run)
npm run lint             # ESLint
```

## 📦 Consumers

1 projeto usa o engine em produção:
- `~/Workspaces/volan-pulso/` — Volan Pulso (CS Platform — origem do engine)

Futuros:
- `~/Workspaces/BelmarsalBallet/` — Belmarsal Ballet (quando migrar IA)

## 📚 Referências

### Guias
- **CODE_STYLE_GUIDE** — convenções de código, naming, imports, iteração
- **JSDOC_GUIDE** — documentação inline (JSDoc) — o que documentar e o que não
→ `docs/`

### Docs do projeto
- **README.md** — visão geral, stack, API surface, quick start, roadmap
→ raíz

### Adapter pattern
- **IAiDbAdapter** — contrato completo de acesso a dados (`src/dbAdapter/dbAdapter.ts`)
- **createMemoryAdapter** — adapter de memória para testes (`src/dbAdapter/memoryAdapter.ts`)
- **Referência**: `IDataAdapter` do BelmarsalBallet (`composables/crud/useDataAdapter.ts`) — mesmo padrão

### Decisões arquiteturais
- Zero fallback silencioso
- Validação na entrada (todos os defeitos de uma vez)
- Preset separado de modelo (portabilidade entre provedores)
- Prompt caching por construção (stable/volatile)
- Dois eixos ortogonais (active vs enabled)
- Consumption gate fail-open declarado

### Plano de evolução
- `~/Workspaces/plano-tenantai.html` — plano de extração completo
- `~/Workspaces/pulso-ai-analise.html` — análise técnica do engine

## 🔮 Roadmap

- [x] Core engine (loop, tools, providers, middleware)
- [x] Database adapter pattern (IAiDbAdapter)
- [x] Memory adapter (testes)
- [x] Desacoplamento Supabase (runtime + engine via adapter)
- [ ] Streaming (SSE + AsyncIterable)
- [ ] Zod schemas no outputSchema
- [ ] Kysely adapter (Postgres + SQLite)
- [ ] OpenTelemetry spans
- [ ] CLI (`npx cbai generate`, `npx cbai migrate`)

---

*📅 Última atualização*: 19 SET 26
*📋 Versão*: 1.0
*🏷️ Tags*: [ia, llm, motor, multi-tenant, provider-agnostic, tool-calling, middleware, observabilidade, adapter]
