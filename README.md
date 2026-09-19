<div align="center">
<pre>
   ██████╗██████╗  █████╗ ██╗
  ██╔════╝██╔══██╗██╔══██╗██║
  ██║     ██████╔╝███████║██║
  ██║     ██╔══██╗██╔══██║██║
  ╚██████╗██████╔╝██║  ██║██║
   ╚═════╝╚═════╝ ╚═╝  ╚═╝╚═╝
      ███████╗███╗   ██╗ ██████╗ ██╗███╗   ██╗███████╗
      ██╔════╝████╗  ██║██╔════╝ ██║████╗  ██║██╔════╝
      █████╗  ██╔██╗ ██║██║  ███╗██║██╔██╗ ██║█████╗
      ██╔══╝  ██║╚██╗██║██║   ██║██║██║╚██╗██║██╔══╝
      ███████╗██║ ╚████║╚██████╔╝██║██║ ╚████║███████╗
      ╚══════╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝╚═╝  ╚═══╝╚══════╝
</pre>

🔧 **Motor de IA provider-agnostic** · 🏢 Multi-tenant nativo · 🗄️ Database-first · 🔍 Observabilidade built-in

![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?style=for-the-badge)
![Build](https://img.shields.io/badge/Build-ESM+CJS-green?style=for-the-badge)
![Vitest](https://img.shields.io/badge/Vitest-2.0-yellow?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-orange?style=for-the-badge)

[Sobre](#-sobre) • [Stack](#-tech-stack) • [Estrutura](#-estrutura-do-projeto) • [Quick Start](#-quick-start) • [API](#-api-surface) • [Documentação](#-documentação)

</div>

## 📖 Sobre

Motor de IA TypeScript que faz para inteligência artificial o que o Better Auth faz para autenticação: **database-first, provider-agnostic, multi-tenant**, com observabilidade e quotas embutidas.

### O problema

Quem coloca IA num app SaaS multi-tenant precisa resolver:
- Gerenciar chaves de API por tenant (com isolamento)
- Controlar quotas de consumo por empresa
- Trocar modelo/provider sem deploy
- Tool-calling loop com retry e structured output
- PII redaction, moderação, sumarização de contexto
- Observabilidade (runs, invocações, custo por chamada)

Nenhuma lib do mercado empacota isso. O CbAIEngine resolve tudo num pacote só.

### Diferencial

| Capacidade | CbAIEngine | Vercel AI SDK | LangChain |
|---|---|---|---|
| Multi-provider | ✅ Anthropic + OpenAI-compat | ✅ | ✅ |
| Config banco-driven | ✅ | ❌ | ❌ |
| Multi-tenant nativo | ✅ Cascata tenant→global→default | ❌ | ❌ |
| Credenciais isoladas/tenant | ✅ last4, RLS | ❌ | ❌ |
| Quotas por tenant | ✅ USD/mês, warning+block | ❌ | ❌ |
| Tool-calling loop | ✅ Genérico, retry | ✅ | ✅ |
| Middleware pipeline | ✅ 3 fases | ❌ | Callbacks |
| PII redaction | ✅ Built-in (CPF, telefone BR) | ❌ | ❌ |
| Moderação bidirecional | ✅ Input + output | ❌ | ❌ |
| Observabilidade | ✅ Runs/invocações/steps | OTEL | LangSmith |
| Prompt caching | ✅ stable/volatile por tipo | ❌ | ❌ |
| Streaming | 🔜 v0.2 | ✅ | ✅ |

## 🛠️ Tech Stack

- **🔒 TypeScript** — Tipagem estrita, tipos neutros (`NMessage`, `NResponse`, `NToolCall`)
- **📦 tsup** — Build ESM + CJS + DTS com tree-shaking
- **🧪 Vitest** — Testes unitários
- **🔌 Provider adapters** — Anthropic + OpenAI-compatible (fetch puro, zero SDK)
- **🗄️ Database adapter pattern** — `IAiDbAdapter` (Kysely, Drizzle, Supabase, memória)
- **🛡️ Middleware pipeline** — PII redaction, moderação, context summarization

## 📂 Estrutura do Projeto

```text
src/
├── core/                 # 🔧 Motor principal (14 arquivos)
│   ├── types.ts          # Tipos neutros: NMessage, NResponse, NToolCall, IProviderAdapter
│   ├── loop.ts           # Loop de tool-calling genérico (runAgentLoop)
│   ├── toolRunner.ts     # Execução de tools (nunca lança — erro vira tool result)
│   ├── tools.ts          # Registry de tools (defineTool, createToolRegistry)
│   ├── hooks.ts          # Hooks read-only, fail-soft (emitHook)
│   ├── structuredOutput.ts # Saída tipada com retry automático
│   ├── jsonSchema.ts     # Validador JSON Schema mínimo (sem dependência)
│   ├── prompt.ts         # Templates stable/volatile (prompt caching por construção)
│   ├── preset.ts         # Presets de comportamento (sem modelo)
│   ├── config.ts         # Cascata de config via adapter (tenant→global→default)
│   ├── validation.ts     # Validação de config na entrada (todos os defeitos de uma vez)
│   ├── middleware.ts      # Pipeline de middleware (pre-context, pre-model, post-model)
│   ├── agentConfigSchema.ts # Schema de validação do config do agente
│   └── index.ts          # createAgent + barrel exports
│
├── providers/            # 🔌 Adapters de provider (5 arquivos)
│   ├── anthropic.ts      # /v1/messages + x-api-key
│   ├── openaiCompatible.ts # /chat/completions + Bearer (Groq, Together, DeepSeek, Ollama)
│   ├── registry.ts       # Map de providers + ConfigError
│   ├── errors.ts         # ProviderParseError, ProviderHttpError
│   └── index.ts          # Barrel + registro built-in
│
├── middleware/            # 🛡️ Middlewares plugáveis (5 arquivos)
│   ├── piiRedaction.ts   # CPF (módulo 11) + telefone BR — ordinais estáveis
│   ├── moderation.ts     # Bidirecional (input pre-context + output post-model)
│   ├── catalogProvider.ts # Provider de moderação determinístico (sem rede)
│   ├── contextSummarization.ts # Condensação memoizada de contexto longo
│   └── index.ts
│
├── observability/        # 🔍 Rastreabilidade (7 arquivos)
│   ├── types.ts          # IObservabilityDb interface
│   ├── runRecorder.ts    # Grava runs com pricing cache
│   ├── stepSink.ts       # Canal diferido para middleware gravar steps
│   ├── pricing.ts        # fetchModelPricing + calculateCostUsd (null, nunca zero)
│   ├── persistenceHooks.ts # Conecta recorder ao loop via IAgentHooks
│   ├── rows.ts           # Builders de linhas (PII redigido + truncado)
│   └── index.ts
│
├── definitions/          # 📋 Vocabulários e constantes (11 arquivos)
│   ├── aiProviders.ts    # Protocolos: 'anthropic' | 'openai-compatible'
│   ├── aiConfig.ts       # Thresholds: WARNING=80%, BLOCK=100%
│   ├── aiObservability.ts # Triggers, statuses, step types, tabelas
│   ├── aiAgents.ts       # Agentes: default, assistant, summarize, analyze, meeting, embedding
│   ├── ragConfig.ts      # Defaults da busca vetorial
│   ├── piiCatalog.ts     # Categorias PII, patterns, placeholders
│   ├── moderationCatalog.ts # Categorias, termos, labels, thresholds
│   ├── contextSummarization.ts # Política de sumarização
│   ├── knowledgeConfig.ts # Config do pipeline de knowledge
│   ├── knowledgeVocabulary.ts # Vocabulário do sistema de conhecimento
│   └── index.ts
│
├── dbAdapter/            # 🗄️ Adapter de banco (4 arquivos)
│   ├── dbAdapter.ts      # IAiDbAdapter — contrato (como IDataAdapter do CRUD)
│   ├── types.ts          # Tipos do adapter (IAiProvider, IAiResolvedConfig, etc.)
│   ├── memoryAdapter.ts  # Adapter de memória (testes e dev)
│   └── index.ts
│
├── index.ts              # 🔧 Barrel export principal
│
tests/                    # 🧪 9 arquivos de teste (41 testes)
docs/                     # 📚 Guias (CODE_STYLE_GUIDE, JSDOC_GUIDE)
```

## 🚀 Quick Start

### Instalação

```bash
npm install cb-ai-engine
```

### Setup básico

```typescript
import { createAgent, defineAgentPreset, defineTool } from 'cb-ai-engine';
import { createMemoryAdapter } from 'cb-ai-engine/dbAdapter';

// 1. Adapter (memória para dev, Kysely/Supabase para prod)
const adapter = createMemoryAdapter({
  configs: [
    { agent: 'assistant', tenantId: null, provider: 'anthropic',
      model: 'claude-sonnet-4-20250514', params: {}, enabled: true },
  ],
  credentials: [
    { provider: 'anthropic', tenantId: null, apiKey: 'sk-ant-...' },
  ],
});

// 2. Tools
const listItems = defineTool({
  name: 'list_items',
  description: 'Lista itens do sistema',
  category: 'read',
  schema: { type: 'object', properties: {} },
  handler: async (_input, _ctx) => ({ result: ['item1', 'item2'] }),
});

// 3. Preset (comportamento sem modelo)
const preset = defineAgentPreset({
  name: 'assistant',
  systemPrompt: 'Você é um assistente útil.',
  tools: [listItems],
  defaults: { maxTokens: 1500, maxToolLoops: 5 },
});

// 4. Executar
const agent = createAgent({ preset, adapter });
const result = await agent.run({
  messages: [{ role: 'user', content: 'Liste os itens' }],
});

console.log(result.text);
```

## 🔧 API Surface

### Providers

Dois adapters built-in, de igual estatuto:

- **Anthropic** — `/v1/messages` + `x-api-key`
- **OpenAI-compatible** — `/chat/completions` + Bearer (Groq, Together, DeepSeek, Ollama, qualquer endpoint compatível)

Cadastrar um novo provider é uma linha no banco, não código.

### Middleware Pipeline

3 fases, plugável:

| Fase | Quando roda | Exemplo |
|---|---|---|
| `pre-context` | 1x antes do loop | Moderação de input |
| `pre-model` | Cada volta do loop | PII redaction, context summarization |
| `post-model` | Cada volta do loop | Moderação de output, structured output validation |

### Observabilidade

Grava automaticamente:

- **Runs** — uma execução do agente (status, duração, erro)
- **Invocações** — cada chamada de modelo (tokens, custo, latência)
- **Steps** — trace passo a passo (tool calls, middleware, erros)
- **Pricing** — custo por (provider, model). `null` quando sem preço (nunca zero)

### Config Cascata

3 níveis, tudo no banco:

```
ai_config da empresa  →  ai_config global do agente  →  ai_config do agente 'default'  →  ConfigError
```

Trocar modelo é UPDATE, não deploy.

## 📋 Scripts

```bash
npm run build        # Build ESM + CJS + DTS
npm run dev          # Build em watch mode
npm run typecheck    # TypeScript sem emitir
npm run test         # Vitest (watch)
npm run test:run     # Vitest (single run)
npm run lint         # ESLint
```

## 📚 Documentação

| Doc | Conteúdo |
|---|---|
| `docs/CODE_STYLE_GUIDE.md` | Nomenclatura, imports, estrutura de arquivos |
| `docs/JSDOC_GUIDE.md` | Documentação inline — o que documentar e o que não |

## 🏗️ Decisões Arquiteturais

1. **Zero fallback silencioso** — sem config = ConfigError, nunca assume modelo
2. **Validação na entrada** — todos os defeitos de uma vez, antes de gastar token
3. **Hooks read-only e fail-soft** — observabilidade nunca derruba o agente
4. **Tool runner sem exceção** — erro vira tool result, modelo se adapta
5. **Preset separado de modelo** — portabilidade entre provedores sem reescrever
6. **Pricing nunca estimado** — sem cadastro → null, nunca zero
7. **PII redigido em 3 pontos** — mensagens→provider, save_memory, trace
8. **Dois eixos ortogonais** — `active` (existe?) vs `enabled` (em uso?)

## 🔮 Roadmap

- [x] Core engine (loop, tools, providers, middleware)
- [x] Database adapter pattern (IAiDbAdapter)
- [x] Memory adapter (testes)
- [ ] Streaming (SSE + AsyncIterable)
- [ ] Zod schemas no outputSchema
- [ ] Kysely adapter (Postgres + SQLite)
- [ ] OpenTelemetry spans
- [ ] CLI (`npx cbai generate`, `npx cbai migrate`)
- [ ] Checkpointing / human-in-the-loop

---

*📅 Criado em*: 18 SET 2026
*📋 Versão*: 0.1.0
*👥 Responsável*: CbBelmante
*🏷️ Tags*: [ia, llm, multi-tenant, provider-agnostic, tool-calling, middleware, observabilidade]
