/**
 * 🔧 dbMigrate — Aplica migrations pendentes no D1
 *
 * Le server/database/migrations/*.sql em ordem, compara com a tabela
 * _migrations no banco e executa so as novas. Idempotente.
 *
 * Uso:
 *   npx tsx scripts/dbMigrate.ts          → local
 *   npx tsx scripts/dbMigrate.ts --remote → remoto (D1 cloud)
 */

import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ============== CONFIG ==============

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_NAME = 'ai-engine-db';
const MIGRATIONS_DIR = resolve(__dirname, './postgres');
const isRemote = process.argv.includes('--remote');
const flag = isRemote ? '--remote' : '--local';

// ============== HELPERS ==============

function runFile(path: string): void {
  execSync(`wrangler d1 execute ${DB_NAME} ${flag} --file="${path}"`, { stdio: 'inherit' });
}

function runCommand(sql: string): string {
  try {
    const escaped = sql.replace(/"/g, '\\"');
    return execSync(`wrangler d1 execute ${DB_NAME} ${flag} --command="${escaped}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err: any) {
    const stderr = err.stderr?.toString() ?? '';
    const stdout = err.stdout?.toString() ?? '';
    console.error(`  ⚠️  Erro SQL: ${sql.substring(0, 60)}`);
    if (stderr) { console.error(`  ${stderr.trim()}`); }
    return stdout;
  }
}

// ============== MAIN ==============

console.log('');
console.log(`  📦 Migrations D1 (${isRemote ? 'REMOTO' : 'LOCAL'})`);
console.log('');

// 1. Criar tabela _migrations se nao existe
runCommand('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT DEFAULT (datetime(\'now\')))');

// 2. Ler migrations aplicadas
const appliedRaw = runCommand('SELECT name FROM _migrations ORDER BY name');
const applied = new Set<string>();
for (const match of appliedRaw.matchAll(/"name":\s*"([^"]+)"/g)) {
  applied.add(match[1]);
}

console.log(`  📋 ${applied.size} migration(s) ja registrada(s)`);
if (applied.size > 0) {
  console.log(`  └ ${[...applied].join(', ')}`);
}
console.log('');

// 3. Ler arquivos de migration
const files = readdirSync(MIGRATIONS_DIR)
  .filter(f => f.endsWith('.sql'))
  .sort();

// 4. Aplicar pendentes
let count = 0;
for (const file of files) {
  if (applied.has(file)) {
    console.log(`  ✅ ${file} (ja aplicada)`);
    continue;
  }

  console.log(`  🔄 ${file} ...`);
  runFile(resolve(MIGRATIONS_DIR, file));
  runCommand(`INSERT OR IGNORE INTO _migrations (name) VALUES ('${file}')`);
  console.log(`  ✅ ${file} aplicada`);
  count++;
}

console.log('');
if (count === 0) {
  console.log('  Nenhuma migration pendente.');
} else {
  console.log(`  ${count} migration(s) aplicada(s).`);
}
console.log('');
