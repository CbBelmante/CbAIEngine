/**
 * O `IAiDbAdapter` sobre Kysely — um para Postgres e SQLite.
 *
 * ⛔ TODA DIFERENÇA DE BANCO MORRE AQUI DENTRO. O motor não sabe em que banco
 * está, e é esta a promessa que o adapter existe para cumprir. O que diverge de
 * verdade entre os dois é UMA coisa só — busca vetorial —, e ela está nomeada
 * abaixo, com recusa clara em vez de resultado vazio.
 *
 * ⚠️ O HOST CONSTRÓI O `Kysely`, e não a biblioteca: é ele que sabe a URL, o
 * pool, o dialeto e se a conexão ignora RLS. É o mesmo desenho do Better Auth,
 * que recebe o banco pronto em vez de um nome de banco.
 */

// ============== DEPENDÊNCIAS ==============

import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { IAiDbAdapter } from './dbAdapter';
import type { IEngineDatabase } from './kyselyTables';
import type {
  IAiConsumptionStatus,
  IAiCredentialResult,
  IAiInsightOrigin,
  IAiInvocationInput,
  IAiKnowledgeEntryInput,
  IAiKnowledgeHit,
  IAiKnowledgeSearchParams,
  IAiModelPricing,
  IAiProvider,
  IAiResolvedConfig,
  IAiRunInput,
  IAiStepInput,
  IAiToolMessageInput,
} from './types';

// ============== TIPOS ==============

export type TEngineDialect = 'postgres' | 'sqlite';

export interface IKyselyAdapterOptions {
  /** Postgres tem schema; SQLite não — e o adapter absorve a diferença. */
  dialect: TEngineDialect;
  /** O schema do motor no Postgres. O padrão é o mesmo do runtime: `engine`. */
  schema?: string;
  /**
   * Quanto aquele tenant pode gastar, em dólares no mês.
   *
   * ⚠️ O MOTOR NÃO TEM TABELA DE LIMITE, de propósito: quota é regra de
   * negócio do host — plano, contrato, cortesia. Sem esta função não há limite,
   * e `getConsumptionStatus` devolve o consumo sem teto.
   */
  limitUsdOf?: (tenantId: string) => Promise<number | null>;
}

// ============== CONSTANTES ==============

const DEFAULT_SCHEMA = 'engine';
const TOP_K = 5;
const SIMILARITY_THRESHOLD = 0.7;
const PRIORITY_WEIGHT = 0.2;
const WHOLE = 100;

/** O primeiro dia do mês corrente, que é a janela da quota. */
function monthStart(): string {
  const now = new Date();

  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** SQLite devolve 0 e 1 onde o Postgres devolve booleano. */
function isOn(value: boolean | number | null | undefined): boolean {
  return value === true || value === 1;
}

function asNumber(value: number | string | null): number | null {
  if (value === null) { return null; }

  const parsed = typeof value === 'number' ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

/** O `params` volta como objeto no Postgres e como texto no SQLite. */
function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  return (value ?? {}) as Record<string, unknown>;
}

function asPayload(value: Record<string, unknown> | null, dialect: TEngineDialect): unknown {
  if (value === null) { return null; }

  return dialect === 'sqlite' ? JSON.stringify(value) : value;
}

// ============== O ADAPTER ==============

export function createKyselyAdapter(
  database: Kysely<IEngineDatabase>,
  options: IKyselyAdapterOptions,
): IAiDbAdapter {
  const db = options.dialect === 'postgres'
    ? database.withSchema(options.schema ?? DEFAULT_SCHEMA)
    : database;

  return {
    // ── Config ────────────────────────────────────────────────────────────
    /**
     * ⛔ A CASCATA É EXPLÍCITA, e cada degrau é uma consulta: tenant → global
     * → agente `default`. Um `or` só, com `order by`, daria o mesmo resultado
     * na maioria dos casos e o errado no dia em que houvesse empate.
     */
    async getConfig(agent: string, tenantId?: string | null): Promise<IAiResolvedConfig | null> {
      const base = () => db
        .selectFrom('ai_config')
        .select(['agent', 'tenant_id', 'provider', 'model', 'params', 'enabled'])
        .where('active', '=', true as never)
        .where('deleted_at', 'is', null);

      const found = (tenantId
        ? await base().where('agent', '=', agent).where('tenant_id', '=', tenantId).executeTakeFirst()
        : undefined)
        ?? await base().where('agent', '=', agent).where('tenant_id', 'is', null).executeTakeFirst()
        ?? await base().where('agent', '=', 'default').where('tenant_id', 'is', null).executeTakeFirst();

      if (!found) { return null; }

      return {
        agent: found.agent,
        tenantId: found.tenant_id,
        provider: found.provider,
        model: found.model,
        params: asRecord(found.params),
        enabled: isOn(found.enabled),
      };
    },

    // ── Credentials ───────────────────────────────────────────────────────
    async getCredential(
      provider: string,
      tenantId?: string | null,
    ): Promise<IAiCredentialResult | null> {
      const base = () => db
        .selectFrom('ai_credentials')
        .select(['api_key', 'provider', 'tenant_id'])
        .where('provider', '=', provider)
        .where('active', '=', true as never)
        .where('deleted_at', 'is', null);

      const found = (tenantId
        ? await base().where('tenant_id', '=', tenantId).executeTakeFirst()
        : undefined)
        ?? await base().where('tenant_id', 'is', null).executeTakeFirst();

      if (!found) { return null; }

      return { apiKey: found.api_key, provider: found.provider, tenantId: found.tenant_id };
    },

    // ── Providers ─────────────────────────────────────────────────────────
    async listProviders(): Promise<IAiProvider[]> {
      const rows = await db
        .selectFrom('ai_providers')
        .select(['slug', 'name', 'base_url', 'protocol', 'enabled'])
        .where('active', '=', true as never)
        .where('enabled', '=', true as never)
        .where('deleted_at', 'is', null)
        .execute();

      return rows.map(asProvider);
    },

    /**
     * ⚠️ TODOS, inclusive os desligados: é com esta lista que o catálogo
     * distingue «provedor que alguém desligou» de «provedor que nunca existiu»
     * — duas falhas com consertos diferentes.
     */
    async listAllProviders(): Promise<IAiProvider[]> {
      const rows = await db
        .selectFrom('ai_providers')
        .select(['slug', 'name', 'base_url', 'protocol', 'enabled'])
        .where('deleted_at', 'is', null)
        .execute();

      return rows.map(asProvider);
    },

    async getProvider(slug: string): Promise<IAiProvider | null> {
      const found = await db
        .selectFrom('ai_providers')
        .select(['slug', 'name', 'base_url', 'protocol', 'enabled'])
        .where('slug', '=', slug)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();

      return found ? asProvider(found) : null;
    },

    // ── Observability ─────────────────────────────────────────────────────
    async openRun(run: IAiRunInput): Promise<string> {
      const row = await db
        .insertInto('ai_agent_runs')
        .values({
          ...(run.id ? { id: run.id } : {}),
          agent: run.agent,
          tenant_id: run.tenantId ?? null,
          trigger: run.trigger,
          status: run.status,
        } as never)
        .returningAll()
        .executeTakeFirst()
        .catch(() => undefined);

      /* SQLite não tem `returning` em toda versão: o id informado é a volta. */
      return (row as { id?: string } | undefined)?.id ?? run.id ?? '';
    },

    async closeRun(runId: string, status: string, error?: string | null): Promise<void> {
      await db
        .updateTable('ai_agent_runs')
        .set({ status, error: error ?? null, finished_at: new Date().toISOString() } as never)
        .where('id', '=', runId)
        .execute();
    },

    async recordInvocation(invocation: IAiInvocationInput): Promise<void> {
      await db
        .insertInto('ai_invocations')
        .values({
          run_id: invocation.runId,
          provider: invocation.provider,
          model: invocation.model,
          prompt_tokens: invocation.promptTokens,
          completion_tokens: invocation.completionTokens,
          total_tokens: invocation.totalTokens,
          cost_usd: invocation.costUsd,
          latency_ms: invocation.latencyMs,
          tool_calls: invocation.toolCalls,
        } as never)
        .execute();
    },

    async recordStep(step: IAiStepInput): Promise<void> {
      await db
        .insertInto('ai_run_steps')
        .values({
          run_id: step.runId,
          seq: step.seq,
          step_type: step.stepType,
          payload: asPayload(step.payload, options.dialect),
          duration_ms: step.durationMs,
        } as never)
        .execute();
    },

    // ── Pricing ───────────────────────────────────────────────────────────
    /** ⛔ SEM PREÇO CADASTRADO devolve NULO, e jamais zero: zero diria «de graça». */
    async getModelPricing(provider: string, model: string): Promise<IAiModelPricing | null> {
      const found = await db
        .selectFrom('ai_model_pricing')
        .select(['provider', 'model', 'input_per_1k', 'output_per_1k', 'currency'])
        .where('provider', '=', provider)
        .where('model', '=', model)
        .where('active', '=', true as never)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();

      if (!found) { return null; }

      return {
        provider: found.provider,
        model: found.model,
        inputPer1k: asNumber(found.input_per_1k) ?? 0,
        outputPer1k: asNumber(found.output_per_1k) ?? 0,
        currency: found.currency,
      };
    },

    // ── Quota ─────────────────────────────────────────────────────────────
    /**
     * O consumido sai das invocações do mês; o teto, do host.
     *
     * ⚠️ A INVOCAÇÃO SEM PREÇO NÃO ENTRA NA SOMA — e é por isso que ela some
     * como nula em vez de zero: somar zero faria o consumo parecer menor do que
     * é, que é o erro caro desta conta.
     */
    async getConsumptionStatus(tenantId: string): Promise<IAiConsumptionStatus | null> {
      const spent = await db
        .selectFrom('ai_invocations')
        .innerJoin('ai_agent_runs', 'ai_agent_runs.id', 'ai_invocations.run_id')
        .select(({ fn }) => [fn.sum<number>('ai_invocations.cost_usd').as('total')])
        .where('ai_agent_runs.tenant_id', '=', tenantId)
        .where('ai_agent_runs.started_at', '>=', monthStart() as never)
        .executeTakeFirst();

      const consumedUsd = asNumber((spent?.total ?? null) as number | null) ?? 0;
      const limitUsd = options.limitUsdOf ? await options.limitUsdOf(tenantId) : null;

      return {
        hasLimit: limitUsd !== null,
        limitUsd,
        consumedUsd,
        percent: limitUsd === null || limitUsd === 0 ? 0 : consumedUsd / limitUsd * WHOLE,
      };
    },

    // ── Knowledge / RAG ───────────────────────────────────────────────────
    /**
     * ⛔ É A ÚNICA PARTE QUE NÃO É AGNÓSTICA, e por isso ela RECUSA em vez de
     * devolver lista vazia. Vazio seria indistinguível de «não há nada parecido»
     * — e a resposta do agente sairia sem o conhecimento, sem ninguém notar.
     */
    async searchKnowledge(params: IAiKnowledgeSearchParams): Promise<IAiKnowledgeHit[]> {
      if (options.dialect !== 'postgres') {
        throw new Error(
          'searchKnowledge exige Postgres com pgvector; em SQLite, delegue a busca vetorial a um serviço externo',
        );
      }

      const schema = options.schema ?? DEFAULT_SCHEMA;
      const vector = `[${params.queryEmbedding.join(',')}]`;
      const rows = await sql<{
        id: string;
        category_id: string;
        title: string;
        content: string;
        similarity: number;
        score: number;
      }>`select * from ${sql.raw(schema)}.search_knowledge(
            ${vector}::vector,
            ${params.topK ?? TOP_K},
            ${params.similarityThreshold ?? SIMILARITY_THRESHOLD},
            ${params.priorityWeight ?? PRIORITY_WEIGHT})`
        .execute(database);

      return rows.rows.map((row) => ({
        entryId: row.id,
        categoryId: row.category_id,
        title: row.title,
        content: row.content,
        similarity: Number(row.similarity),
        combinedScore: Number(row.score),
      }));
    },

    async getKnowledgeCategoryBySlug(slug: string): Promise<{ id: string } | null> {
      const found = await db
        .selectFrom('ai_knowledge_categories')
        .select(['id'])
        .where('slug', '=', slug)
        .where('active', '=', true as never)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();

      return found ? { id: found.id } : null;
    },

    async insertKnowledgeEntry(entry: IAiKnowledgeEntryInput): Promise<{ id: string } | null> {
      const row = await db
        .insertInto('ai_knowledge_entries')
        .values({
          category_id: entry.categoryId,
          title: entry.title,
          content: entry.content,
          visibility: entry.visibility,
          tenant_id: entry.companyId,
          sync_status: entry.syncStatus,
          created_by: entry.createdBy,
        } as never)
        .returning('id')
        .executeTakeFirst();

      return row ? { id: row.id as string } : null;
    },

    // ── Insights ──────────────────────────────────────────────────────────
    async insertInsights(rows: Array<Record<string, unknown>>): Promise<string[]> {
      if (rows.length === 0) { return []; }

      const inserted = await db
        .insertInto('ai_insights')
        .values(rows as never)
        .returning('id')
        .execute();

      return inserted.map((row) => row.id as string);
    },

    /** ⚠️ A DEDUPLICAÇÃO OLHA A ORIGEM, e não o conteúdo: o mesmo e-mail relido não vira insight novo. */
    async hasInsightsFrom(origin: IAiInsightOrigin): Promise<boolean> {
      let query = db
        .selectFrom('ai_insights')
        .select(['id'])
        .where('source', '=', origin.source)
        .where('source_id', '=', origin.sourceId);

      if (origin.since) {
        query = query.where('created_at', '>=', origin.since as never);
      }

      return (await query.executeTakeFirst()) !== undefined;
    },

    // ── Tool messages ─────────────────────────────────────────────────────
    /**
     * ⚠️ NÃO EXISTE TABELA DE MENSAGEM NO MOTOR, e isso é desenho: a conversa é
     * do host — cada app a guarda do jeito dele. Sem destino, o método é um
     * nada que não mente; o contrato já o declara fail-soft.
     */
    async recordToolMessage(_message: IAiToolMessageInput): Promise<void> {
      return undefined;
    },
  };
}

// ============== HELPERS ==============

function asProvider(row: {
  slug: string;
  name: string;
  base_url: string | null;
  protocol: string;
  enabled: boolean | number;
}): IAiProvider {
  return {
    slug: row.slug,
    name: row.name,
    baseUrl: row.base_url,
    protocol: row.protocol as 'anthropic' | 'openai-compatible',
    enabled: isOn(row.enabled),
  };
}
