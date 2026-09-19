/**
 * 🔧 db — Superfície mínima do PostgREST que as tools do assistente consomem
 *
 * O client é INJETADO, nunca criado aqui — é o que permite exercitar as 17
 * tools contra um duplo em memória, sem banco de verdade. Mesma doutrina de
 * `_common/agent/observability/types.ts`, e pelo mesmo motivo: quem chama já
 * aplicou `.schema()`, cujo retorno não é mais um `IAiDbAdapter`.
 *
 * `select<T>()` é genérico de propósito. O `assistant.f.ts` de hoje afirma o
 * tipo de cada row com `as Array<{ … }>` depois da query; com o parâmetro de
 * tipo, a mesma informação é dada ANTES e o compilador passa a conferi-la
 * contra o uso, em vez de aceitar a afirmação.
 */

// ============== RESULT ==============

export type DbRow = Record<string, unknown>;

export interface IDbError {
  message: string;
}

export interface IDbResult<T> {
  data: T | null;
  error: IDbError | null;
  /** Preenchido só quando a query pediu `{ count: 'exact' }`. */
  count?: number | null;
}

// ============== QUERY BUILDER ==============

export interface IDbOrderOptions {
  ascending?: boolean;
  nullsFirst?: boolean;
}

export interface IDbSelectOptions {
  count?: 'exact';
  head?: boolean;
}

/**
 * Encadeamento de filtros. `PromiseLike` porque o builder do PostgREST é
 * thenable, não uma `Promise` — `await` funciona, `.then` do contrato basta.
 */
export interface IDbQuery<T> extends PromiseLike<IDbResult<T[]>> {
  eq(column: string, value: unknown): IDbQuery<T>;
  neq(column: string, value: unknown): IDbQuery<T>;
  is(column: string, value: null): IDbQuery<T>;
  in(column: string, values: readonly unknown[]): IDbQuery<T>;
  gte(column: string, value: unknown): IDbQuery<T>;
  lt(column: string, value: unknown): IDbQuery<T>;
  /** Filtro OR do PostgREST. ⚠️ Todo termo de usuário passa por `sanitizeFilterTerm` antes. */
  or(filter: string): IDbQuery<T>;
  order(column: string, options?: IDbOrderOptions): IDbQuery<T>;
  limit(count: number): IDbQuery<T>;
  maybeSingle(): PromiseLike<IDbResult<T>>;
  single(): PromiseLike<IDbResult<T>>;
}

/** `insert`/`update` só viram linha devolvida quando alguém pede `.select()`. */
export interface IDbMutation<T> extends PromiseLike<IDbResult<T[]>> {
  eq(column: string, value: unknown): IDbMutation<T>;
  /** Filtro por conjunto no UPDATE — é ele que torna o claim da fila de embedding atômico. */
  in(column: string, values: readonly unknown[]): IDbMutation<T>;
  select(columns?: string): IDbQuery<T>;
}

export interface IDbTable {
  select<T = DbRow>(columns?: string, options?: IDbSelectOptions): IDbQuery<T>;
  insert<T = DbRow>(values: DbRow | DbRow[]): IDbMutation<T>;
  update<T = DbRow>(values: DbRow): IDbMutation<T>;
  upsert<T = DbRow>(values: DbRow, options?: { onConflict?: string }): IDbMutation<T>;
}

export interface ICbAIEngineDb {
  from(table: string): IDbTable;
}
