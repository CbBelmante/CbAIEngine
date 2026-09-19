/**
 * 🔧 observability types — Contrato mínimo do client de persistência
 *
 * O client é INJETADO, nunca criado aqui: é isso que permite testar os hooks
 * com um duplo em memória, sem banco de verdade. E o tipo é uma superfície
 * mínima em vez de `IAiDbAdapter` porque quem chama já aplicou
 * the database adapter interface.
 *
 * O VOCABULÁRIO (status, trigger, step_type, tabelas) não mora aqui: é conteúdo
 * declarativo compartilhado com o front, e vive em `definitions/aiObservability.ts`.
 */

// ============== DB SURFACE ==============

export interface IDbResult<T> {
  data: T | null;
  error: unknown;
}

export type DbRow = Record<string, unknown>;

/**
 * Encadeamento de filtros. `PromiseLike` porque o builder do PostgREST é
 * thenable, não uma Promise.
 *
 * O genérico nomeia a LINHA, não o resultado — e é essa distinção que mantém a
 * interface honesta. Do mesmo builder saem DOIS formatos: `await builder` traz
 * o conjunto (o PostgREST responde array mesmo para zero ou uma linha), e
 * `maybeSingle()` traz uma linha só (o header `…pgrst.object+json` pede o
 * objeto, e a ausência vira `null` em vez de erro). Um genérico único servindo
 * as duas saídas obrigaria uma delas a mentir; com `TRow` significando a linha,
 * cada método deriva a própria forma do mesmo fato.
 */
export interface IDbFilterBuilder<TRow> extends PromiseLike<IDbResult<TRow[]>> {
  eq(column: string, value: unknown): IDbFilterBuilder<TRow>;
  maybeSingle(): PromiseLike<IDbResult<TRow>>;
}

export interface IDbTable {
  insert(values: DbRow): PromiseLike<IDbResult<unknown>>;
  update(values: DbRow): IDbFilterBuilder<DbRow>;
  select(columns: string): IDbFilterBuilder<DbRow>;
}

export interface IObservabilityDb {
  from(table: string): IDbTable;
}
