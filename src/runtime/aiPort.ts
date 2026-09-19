/**
 * 🌐 aiPort — A porta única: agente + empresa → provider resolvido, pronto pra chamar
 *
 * `AI_PLATFORM_ARCHITECTURE` sempre disse que os consumidores de IA "passam pela
 * MESMA porta". A frase era falsa: a porta era um trecho solto dentro do
 * `agentRuntime.ts`, e quem embeda tinha a própria cópia — com três passos a
 * menos. Aqui a porta é um lugar, e as duas trilhas entram por ela.
 *
 * 🔴 Os três passos moram AQUI, e não no chamador, porque cada um falha CALADO
 * quando esquecido — foi assim que a trilha de embed divergiu sem nada acusar:
 *
 *   1. `.schema()` — o PostgREST cai em `public` por padrão, e as três
 *      leituras descartam o `error`: tabela inexistente fica indistinguível de
 *      "nada cadastrado".
 *   2. `registerProvidersFromDb` — é o que faz a `base_url` da tela chegar ao
 *      registry; só com as embutidas, o provedor cadastrado não existe.
 *   3. A recusa por DESLIGADO — sem ela, quem o administrador desligou vira AUSÊNCIA,
 *      a mesma mensagem de um provedor que nunca existiu.
 *
 * ⚠️ **Client ADMIN.** `ai_config` e `ai_providers` só são legíveis por
 * the access control layer (the config migration) e `ai_credentials` guarda segredo.
 * Com o client do caller, um não-interno não acharia linha nenhuma (RLS) e a
 * chamada recusaria sem dizer que o problema é o client, não a config.
 */

import type { IAiDbAdapter } from '../dbAdapter/dbAdapter';
import { resolveApiKey, resolveConfig } from '../core/config';
import type { IResolvedConfig } from '../core/config';
import { ConfigError, resolveProvider } from '../providers/registry';
import type { IRegisteredProvider } from '../providers/registry';
import { registerProvidersFromDb } from './providerCatalog';
import type { IProviderCatalog } from './providerCatalog';

// ============== CONSTANTS ==============

/** O schema de TODA tabela do engine — `public` é o default do PostgREST, não o nosso. */
export const CBAI_SCHEMA = 'engine';

// ============== TYPES ==============

export interface IResolveAiPortParams {
  admin: IAiDbAdapter;
  /** A MESMA chave de `ai_config.agent` — `assistant`, `summarize`, `embedding`… */
  agent: string;
  /** Empresa dona da config/credencial. `null` resolve pelo global. */
  companyId: string | null;
}

export interface IAiPort {
  /** provider/model/params já resolvidos pela cascata empresa → global → `default`. */
  config: IResolvedConfig;
  /** O provider REGISTRADO — é dele que saem `adapter` e `baseUrl`. */
  provider: IRegisteredProvider;
  /** Pronto pro `createAgent`/adapter: a chave é sempre a DESTE provider. */
  credentials: { apiKey: string; baseUrl?: string };
}

// ============== PORTA ==============

/**
 * O registro roda a cada chamada de propósito: o registry é um `Map` global e
 * `registerProvider` é um `set` idempotente, mas o edge runtime recicla
 * isolates, e depender de um efeito de import deixaria a primeira chamada de um
 * isolate novo sem provider nenhum.
 *
 * Quem manda no catálogo é `ai_providers` — a tela cadastra o provedor e o
 * motor o encontra na chamada seguinte, sem deploy. As embutidas continuam
 * registradas antes, como piso.
 */
export async function resolveAiPort(
  { admin, agent, companyId }: IResolveAiPortParams,
): Promise<IAiPort> {
  const engine = admin;
  // Uma vez só: `null` é ausência de empresa e `undefined` é o que a cascata
  // espera. Reconverter em cada chamada é onde um dos lados acaba divergindo.
  const company = companyId ?? undefined;

  const catalog = await registerProvidersFromDb(engine);

  const config = await resolveConfig({ agent, companyId: company, dbAdapter: engine });
  const apiKey = await resolveApiKey({ provider: config.provider, companyId: company }, engine);

  assertProviderEnabled({ catalog, provider: config.provider });

  // A URL base vem do PROVIDER REGISTRADO — e o registro acabou de ser
  // reconstruído a partir de `ai_providers`. Informar a `base_url` na tela é o
  // que dá ao adapter de protocolo um lugar para onde ligar; sem ela o adapter
  // RECUSA com erro claro, em vez de assumir um destino e mandar a credencial
  // pro provedor errado.
  const provider = resolveProvider(config.provider);

  return {
    config,
    provider,
    credentials: provider.baseUrl ? { apiKey, baseUrl: provider.baseUrl } : { apiKey },
  };
}

// ============== HELPERS ==============

/**
 * Provedor DESLIGADO é um estado que a TELA produz, e sem esta recusa ele
 * chegaria ao registry como AUSÊNCIA — o mesmo `Unknown provider` de um
 * provedor que nunca existiu. São dois problemas diferentes, e quem desligou
 * a porta precisa reconhecer o próprio ato na mensagem.
 */
function assertProviderEnabled(
  { catalog, provider }: { catalog: IProviderCatalog; provider: string },
): void {
  if (!catalog.disabled.includes(provider)) { return; }

  throw new ConfigError(
    `Provider "${provider}" está desligado em ai_providers. `
    + 'Ligue o provedor ou aponte o agente para outro.',
  );
}
