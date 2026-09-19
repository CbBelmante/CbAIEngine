import { describe, it, expect } from 'vitest';
/**
 * Testes — observability/types.ts contract verification
 *
 * A superfície mínima de banco tem DOIS eixos de formato saindo do MESMO
 * builder: `await builder` traz o conjunto, `builder.maybeSingle()` traz uma
 * linha. Este arquivo é a contraprova de que a interface descreve os dois com
 * fidelidade — e a vedação mora no COMPILADOR, não nas asserções.
 *
 * O duplo abaixo obedece ao PostgREST, não à interface: `select()` sem fecho
 * resolve para ARRAY porque é isso que o servidor responde. Se a interface
 * voltar a prometer uma linha nesse caminho, o duplo deixa de satisfazê-la e
 * `deno check` fica vermelho aqui — que é o inverso do duplo que só concorda
 * com o próprio tipo e por isso nunca detecta nada.
 */

import { expect } from 'vitest';

import type {
  DbRow,
  IDbFilterBuilder,
  IDbResult,
  IDbTable,
  IObservabilityDb,
} from '../src/observability/types';

// ============== POSTGREST-FAITHFUL DOUBLE ==============

/** As linhas que a "tabela" contém — duas de propósito, para o array ter o que provar. */
const STORED_ROWS: DbRow[] = [
  { provider: 'anthropic', input_per_1k: 0.001 },
  { provider: 'openai', input_per_1k: 0.002 },
];

/**
 * Reproduz o contrato do PostgREST, não o da interface: sem fecho a resposta é
 * a coleção; com `maybeSingle()` é a primeira linha (ou `null` quando não há).
 */
function makePostgrestLikeBuilder(rows: DbRow[]): IDbFilterBuilder<DbRow> {
  const builder: IDbFilterBuilder<DbRow> = {
    eq(): IDbFilterBuilder<DbRow> {
      return builder;
    },
    maybeSingle(): PromiseLike<IDbResult<DbRow>> {
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    },
    then(onfulfilled, onrejected) {
      const result: IDbResult<DbRow[]> = { data: rows, error: null };
      return Promise.resolve(result).then(onfulfilled, onrejected);
    },
  };
  return builder;
}

/**
 * A ATRIBUIÇÃO é o teste. Um objeto que se comporta como o PostgREST tem de
 * satisfazer `IObservabilityDb` — sem `as`, sem `any`. É esta linha que o
 * compilador rejeita se o contrato voltar a mentir sobre o formato.
 */
const postgrestLikeDb: IObservabilityDb = {
  from(): IDbTable {
    return {
      insert(): PromiseLike<IDbResult<unknown>> {
        return Promise.resolve({ data: null, error: null });
      },
      update(): IDbFilterBuilder<DbRow> {
        return makePostgrestLikeBuilder(STORED_ROWS);
      },
      select(): IDbFilterBuilder<DbRow> {
        return makePostgrestLikeBuilder(STORED_ROWS);
      },
    };
  },
};

// ============== CONTRAPROVA — o await direto entrega ARRAY ==============

it('select sem maybeSingle - await resolve para ARRAY de linhas', async () => {
  const result = await postgrestLikeDb.from('ai_model_pricing').select('provider, input_per_1k');

  // Asserção de TIPO: com o contrato antigo `data` seria `DbRow | null` e esta
  // atribuição não compilaria. É aqui que a reversão fica vermelha.
  const rows: DbRow[] | null = result.data;

  expect(Array.isArray(rows), true);
  expect(rows?.length, 2);
  expect(rows?.[0].provider, 'anthropic');
});

it('select sem maybeSingle - filtros encadeados preservam o formato de conjunto', async () => {
  const result = await postgrestLikeDb
    .from('ai_model_pricing')
    .select('provider, input_per_1k')
    .eq('provider', 'anthropic')
    .eq('active', true);

  const rows: DbRow[] | null = result.data;

  expect(Array.isArray(rows), true);
  expect(rows?.length, 2);
});

// ============== O OUTRO EIXO — maybeSingle entrega UMA LINHA ==============

it('maybeSingle - resolve para UMA linha, nunca um array', async () => {
  const result = await postgrestLikeDb
    .from('ai_model_pricing')
    .select('provider, input_per_1k')
    .eq('provider', 'anthropic')
    .maybeSingle();

  // Asserção de TIPO no eixo oposto: trocar o contrato para `TRow[]` em vez de
  // separar os eixos deixaria ESTA linha vermelha — a mentira só mudaria de lado.
  const row: DbRow | null = result.data;

  expect(Array.isArray(row), false);
  expect(row?.provider, 'anthropic');
});

it('maybeSingle - ausência de linha é null, não erro', async () => {
  const emptyDb: IObservabilityDb = {
    from(): IDbTable {
      return {
        insert(): PromiseLike<IDbResult<unknown>> {
          return Promise.resolve({ data: null, error: null });
        },
        update(): IDbFilterBuilder<DbRow> {
          return makePostgrestLikeBuilder([]);
        },
        select(): IDbFilterBuilder<DbRow> {
          return makePostgrestLikeBuilder([]);
        },
      };
    },
  };

  const result = await emptyDb.from('ai_model_pricing').select('provider').maybeSingle();

  expect(result.data, null);
  expect(result.error, null);
});

it('select sem maybeSingle - tabela vazia é array vazio, não null', async () => {
  const emptyDb: IObservabilityDb = {
    from(): IDbTable {
      return {
        insert(): PromiseLike<IDbResult<unknown>> {
          return Promise.resolve({ data: null, error: null });
        },
        update(): IDbFilterBuilder<DbRow> {
          return makePostgrestLikeBuilder([]);
        },
        select(): IDbFilterBuilder<DbRow> {
          return makePostgrestLikeBuilder([]);
        },
      };
    },
  };

  const result = await emptyDb.from('ai_model_pricing').select('provider');
  const rows: DbRow[] | null = result.data;

  expect(Array.isArray(rows), true);
  expect(rows?.length, 0);
});
