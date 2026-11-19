/**
 * 🧪 Os dois dialetos dizem a mesma coisa
 *
 * ⛔ O MOTOR PROMETE SER AGNÓSTICO DE BANCO, e a promessa quebra em silêncio
 * quando uma coluna entra num dialeto e não no outro: a bateria de conformidade
 * continua verde nos dois — ela mede o que o adapter LÊ —, e a diferença só
 * aparece no dia em que alguém migra de um banco para o outro e descobre que o
 * dado não cabe.
 *
 * Este caso compara as duas migrations coluna a coluna e exige que a ÚNICA
 * diferença seja a declarada abaixo, com a razão escrita.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ============== A EXCEÇÃO, DECLARADA ==============

/**
 * ⚠️ `embedding` É A ÚNICA DIVERGÊNCIA LEGÍTIMA: busca vetorial exige pgvector,
 * que o SQLite não tem. Quem roda em SQLite delega a busca a um serviço externo,
 * e o adapter RECUSA `searchKnowledge` em vez de devolver lista vazia.
 */
const DECLARED_ONLY_IN_POSTGRES: Readonly<Record<string, string[]>> = {
  ai_knowledge_entries: ['embedding'],
};

// ============== A LEITURA DAS MIGRATIONS ==============

const IGNORED_WORDS = new Set(['and', 'or', 'references', 'check', 'constraint', 'unique',
  'primary', 'foreign']);

function columnsOf(dir: string, schemaPrefix: string): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const files = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort();

  for (const file of files) {
    const text = readFileSync(join(dir, file), 'utf8');
    const pattern = /create table (?:if not exists )?([\w."]+)\s*\(([\s\S]*?)\n\);/gi;

    for (const match of text.matchAll(pattern)) {
      const name = match[1]!.replaceAll('"', '').replace(schemaPrefix, '');
      const found = tables.get(name) ?? new Set<string>();

      for (const raw of match[2]!.split('\n')) {
        const line = raw.trim();

        if (line === '' || line.startsWith('--')) {
          continue;
        }

        const column = /^"?([a-z_]+)"?\s+\S/.exec(line);

        if (column && !IGNORED_WORDS.has(column[1]!.toLowerCase())) {
          found.add(column[1]!);
        }
      }

      tables.set(name, found);
    }
  }

  return tables;
}

const POSTGRES = columnsOf('src/migrations/postgres', 'engine.');
const SQLITE = columnsOf('src/migrations/sqlite', '');

// ============== OS CASOS ==============

describe('as migrations dos dois dialetos estão pareadas', () => {
  it('as duas declaram as mesmas tabelas', () => {
    expect([...SQLITE.keys()].sort()).toEqual([...POSTGRES.keys()].sort());
  });

  it('e nenhuma delas está vazia — a varredura precisa ter medido algo', () => {
    expect(POSTGRES.size).toBeGreaterThan(0);

    for (const [table, columns] of POSTGRES) {
      expect(columns.size, `${table} precisa ter colunas`).toBeGreaterThan(0);
    }
  });

  /** ⛔ É O CASO QUE PEGA A COLUNA QUE ALGUÉM ACRESCENTOU DE UM LADO SÓ. */
  it('cada tabela tem as mesmas colunas, salvo a exceção declarada', () => {
    const divergences: string[] = [];

    for (const [table, postgresColumns] of POSTGRES) {
      const sqliteColumns = SQLITE.get(table) ?? new Set<string>();
      const declared = new Set(DECLARED_ONLY_IN_POSTGRES[table] ?? []);

      for (const column of postgresColumns) {
        if (!sqliteColumns.has(column) && !declared.has(column)) {
          divergences.push(`${table}.${column} só existe no Postgres`);
        }
      }

      for (const column of sqliteColumns) {
        if (!postgresColumns.has(column)) {
          divergences.push(`${table}.${column} só existe no SQLite`);
        }
      }
    }

    expect(divergences).toEqual([]);
  });

  /** ⚠️ E A EXCEÇÃO TEM DE SER VERDADE: declarar o que não diverge esconde a régua. */
  it('a exceção declarada existe de fato no Postgres e falta no SQLite', () => {
    for (const [table, columns] of Object.entries(DECLARED_ONLY_IN_POSTGRES)) {
      for (const column of columns) {
        expect(POSTGRES.get(table)?.has(column), `${table}.${column} no Postgres`).toBe(true);
        expect(SQLITE.get(table)?.has(column), `${table}.${column} no SQLite`).toBe(false);
      }
    }
  });
});

// ============== O SCHEMA APLICA SOZINHO ==============

describe('o schema aplica sem depender de tabela do host', () => {
  /**
   * ⛔ A MIGRATION QUE PRECISA DE UMA TABELA QUE A BIBLIOTECA NÃO CRIA não
   * aplica em instalação nenhuma, e o erro aparece no primeiro `migrate` de
   * quem adota o motor — longe daqui, e sem o que consertar à mão.
   */
  it('nenhuma migration escreve em tabela que a biblioteca não declara', () => {
    const declared = new Set([...POSTGRES.keys()]);
    const foreign: string[] = [];

    for (const [dir, prefix] of [['src/migrations/postgres', 'engine.'], ['src/migrations/sqlite', '']]) {
      for (const file of readdirSync(dir!).filter((name) => name.endsWith('.sql'))) {
        const text = readFileSync(join(dir!, file), 'utf8');

        for (const match of text.matchAll(/insert into ([\w."]+)/gi)) {
          const table = match[1]!.replaceAll('"', '').replace(prefix!, '');

          if (!declared.has(table)) {
            foreign.push(`${file}: insert into ${table}`);
          }
        }
      }
    }

    expect(foreign).toEqual([]);
  });

  /** ⚠️ E o consolidado é a soma das migrations: editado à mão, divergiria. */
  it('o schema consolidado do SQLite tem todas as tabelas das migrations', () => {
    const full = readFileSync('src/migrations/sqlite/schema.sql', 'utf8');

    for (const table of SQLITE.keys()) {
      expect(full, `${table} no consolidado`).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });
});
