/**
 * 🧪 O adapter de Kysely contra Postgres de VERDADE
 *
 * ⛔ A MESMA BATERIA DO ADAPTER DE MEMÓRIA, e é esse o ponto: interface só
 * promete; o que prova é um conjunto único de casos rodando contra toda
 * implementação. Divergência entre backends aparece aqui, e não em produção.
 *
 * ⚠️ PRECISA DE UM POSTGRES, e por isso se recusa a correr sem ele — em vez de
 * passar vazio, que seria pior do que não existir. Quem roda:
 *
 *   CBAI_TEST_DATABASE_URL=postgres://... npm run test:run
 */

import { afterAll, describe, it } from 'vitest';

import { runAdapterConformance } from './adapterConformance.test';
import { createKyselyAdapter } from '../src/dbAdapter/kyselyAdapter';

// ============== O BANCO DO TESTE ==============

const URL = process.env.CBAI_TEST_DATABASE_URL;
const SCHEMA = 'engine_test';

/* eslint-disable @typescript-eslint/no-explicit-any */
async function connect() {
  const { Kysely, PostgresDialect, sql } = await import('kysely');
  const pg = await import('pg');
  const pool = new pg.default.Pool({ connectionString: URL });
  const db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });

  return { db, sql };
}

if (URL === undefined) {
  describe('o adapter de Kysely', () => {
    it.skip('precisa de CBAI_TEST_DATABASE_URL para correr', () => undefined);
  });
} else {
  const ready = connect();

  runAdapterConformance({
    name: 'kysely/postgres',
    async make() {
      const { db, sql } = await ready;

      /* Cada caso num schema limpo: estado de um não atravessa para o outro. */
      await sql.raw(`drop schema if exists ${SCHEMA} cascade`).execute(db);
      await sql.raw(`create schema ${SCHEMA}`).execute(db);

      const { readFileSync, readdirSync } = await import('node:fs');
      const { join } = await import('node:path');
      const dir = join(process.cwd(), 'src/migrations/postgres');

      for (const file of readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()) {
        const text = readFileSync(join(dir, file), 'utf8')
          .replaceAll('engine.', `${SCHEMA}.`)
          .replace('create schema if not exists engine;', '');

        await sql.raw(text).execute(db);
      }

      const adapter = createKyselyAdapter(db, { dialect: 'postgres', schema: SCHEMA });

      return {
        adapter,
        async seed(data) {
          for (const provider of data.providers ?? []) {
            await sql`insert into ${sql.raw(SCHEMA)}.ai_providers (slug, name, base_url, protocol, enabled)
              values (${provider.slug}, ${provider.name}, ${provider.baseUrl},
                      ${provider.protocol}, ${provider.enabled})`.execute(db);
          }

          for (const config of data.configs ?? []) {
            await sql`insert into ${sql.raw(SCHEMA)}.ai_config (agent, tenant_id, provider, model)
              values (${config.agent}, ${config.tenantId}, ${config.provider}, ${config.model})`
              .execute(db);
          }

          for (const credential of data.credentials ?? []) {
            await sql`insert into ${sql.raw(SCHEMA)}.ai_credentials (provider, tenant_id, api_key)
              values (${credential.provider}, ${credential.tenantId}, ${credential.apiKey})`
              .execute(db);
          }

          for (const price of data.pricing ?? []) {
            await sql`insert into ${sql.raw(SCHEMA)}.ai_model_pricing
                        (provider, model, input_per_1k, output_per_1k)
              values (${price.provider}, ${price.model}, ${price.inputPer1k}, ${price.outputPer1k})`
              .execute(db);
          }
        },
      };
    },
  });

  /* ⚠️ `db.destroy()` JÁ FECHA O POOL que o dialeto recebeu: chamar `end()`
     depois estoura com «Called end on pool more than once», e o arquivo falha
     no fim mesmo com todos os casos verdes. */
  afterAll(async () => {
    const { db, sql } = await ready;

    await sql.raw(`drop schema if exists ${SCHEMA} cascade`).execute(db);
    await db.destroy();
  });
}
