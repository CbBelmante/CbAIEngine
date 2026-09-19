/**
 * 🌐 moderationRuntime — Qual provider de moderação roda, e com que régua
 *
 * O middleware (`_common/agent/middleware/moderation.ts`) é puro: recebe um
 * `IModerationProvider` pronto e não sabe de onde ele veio. A ESCOLHA mora
 * aqui, junto das outras resoluções de ambiente (`embeddingRuntime.ts`,
 * `agentRuntime.ts`) — é o mesmo motivo pelo qual `config.ts` fica fora do
 * barrel do motor: quem lê `Deno.env` não deve ser arrastado para dentro de um
 * import de tipo.
 *
 * A regra, em uma linha: **ausência é padrão, presença errada é recusa.**
 */

import {
  createCatalogModerationProvider,
} from '../middleware/catalogProvider';
import {
  createModerationMiddlewares,
  registerModerationProvider,
  resolveModerationProvider,
  type IModerationMiddlewares,
  type IModerationProvider,
} from '../middleware/moderation';
import {
  DEFAULT_MODERATION_THRESHOLD,
  MODERATION_PROVIDER_ENV_KEY,
  MODERATION_THRESHOLD_ENV_KEY,
} from '../definitions/moderationCatalog';

// ============== REGISTRY BOOTSTRAP ==============

/**
 * O embutido é registrado na carga do módulo, como os adapters de provider em
 * `providers/index.ts`. Registrar é declarar que ele EXISTE — não é escolhê-lo.
 */
registerModerationProvider(createCatalogModerationProvider());

// ============== RESOLUTION ==============

/**
 * O provider configurado, ou o embutido quando ninguém configurou.
 *
 * 🔴 Sem variável, roda o catálogo — a moderação NUNCA fica desligada por
 * esquecimento. É a assimetria certa: um guarda ausente por omissão é o modo
 * de falha que a moderação existe para impedir, e o embutido não gasta
 * credencial nem escolhe fornecedor de LLM, então ligá-lo por padrão não
 * contradiz a cascata que recusa em vez de assumir.
 *
 * 🔴 Com variável apontando para um `id` não registrado, `resolveModerationProvider`
 * lança `ConfigError`. Cair de volta no catálogo aqui daria ao operador um
 * guarda diferente do que ele pediu, em silêncio.
 */
export function resolveConfiguredModerationProvider(): IModerationProvider {
  const configured = process.env[MODERATION_PROVIDER_ENV_KEY]?.trim();
  if (!configured) {
    return createCatalogModerationProvider();
  }
  return resolveModerationProvider(configured);
}

/**
 * A régua dos providers que pontuam. Valor inválido (não numérico, fora de
 * [0,1]) volta ao padrão em vez de derrubar o assistente: um typo em variável
 * de ambiente não deve tirar o chat do ar, e o padrão é neutro, não permissivo.
 */
export function resolveModerationThreshold(): number {
  // `Number('')` é 0, não `NaN` — sem o teste de vazio, uma variável em branco
  // viraria limiar zero, que bloqueia tudo o que o provider pontuar.
  const raw = process.env[MODERATION_THRESHOLD_ENV_KEY]?.trim();
  if (!raw) {
    return DEFAULT_MODERATION_THRESHOLD;
  }
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 1) {
    return DEFAULT_MODERATION_THRESHOLD;
  }
  return parsed;
}

// ============== FACTORY ==============

/** Os dois middlewares já resolvidos — o que as edges consomem. */
export function buildModerationMiddlewares(): IModerationMiddlewares {
  return createModerationMiddlewares({
    provider: resolveConfiguredModerationProvider(),
    threshold: resolveModerationThreshold(),
  });
}
