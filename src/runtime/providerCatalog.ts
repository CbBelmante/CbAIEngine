/**
 * 🌐 providerCatalog — `ai_providers` (banco) → registry do motor
 *
 * A 019 prometeu no comment da tabela que "adicionar novo provider = INSERT na
 * tela de admin, sem migration", mas nada lia `ai_providers`: o motor resolvia
 * provider e `baseUrl` de uma lista escrita em código. Este arquivo é o elo que
 * faltava — e é ele que torna a promessa verdadeira.
 *
 * O motor continua intocado. `registerProvider` é a porta pública do registry
 * (`Map.set`), e os dois adapters são de PROTOCOLO, não de marca: cadastrar
 * Groq, Together, DeepSeek ou um Ollama local é escolher `openai-compatible` e
 * informar a `base_url`. Nenhum `if` de fornecedor entra no caminho.
 *
 * ⚠️ **Client ADMIN.** `ai_providers` só é legível por the access control layer
 * (the config migration); com o client do caller, um não-interno leria zero
 * linhas e cairia nas embutidas em silêncio.
 */

import {
  anthropicAdapter,
  openaiCompatibleAdapter,
  registerBuiltInProviders,
  BUILT_IN_PROVIDERS,
} from '../providers/index';
import { registerProvider } from '../providers/registry';
import type { IProviderAdapter } from '../core/types';
import { AI_PROTOCOLS, type AiProtocol } from '../definitions/aiProviders';
import type { IAiDbAdapter } from '../dbAdapter/dbAdapter';

// ============== TYPES ==============

/**
 * O que o catálogo do banco produziu. `disabled` volta junto de propósito: sem
 * ela, apontar um agente para um provedor DESLIGADO produziria o mesmo
 * `Unknown provider` de um provedor inexistente — dois problemas diferentes com
 * a mesma mensagem, e o administrador reabrindo a tela sem saber o que procurar.
 */
export interface IProviderCatalog {
  registered: string[];
  disabled: string[];
}

/**
 * Protocolo → dbAdapter. É o mapa inteiro da escolha de porta: o `protocol` da
 * linha do banco entra aqui e sai um dbAdapter. O CHECK da 019 fecha a coluna
 * nestes dois valores, então uma linha do banco nunca cai fora do mapa.
 */
const ADAPTER_BY_PROTOCOL: Record<AiProtocol, IProviderAdapter> = {
  [AI_PROTOCOLS.ANTHROPIC]: anthropicAdapter,
  [AI_PROTOCOLS.OPENAI_COMPATIBLE]: openaiCompatibleAdapter,
};

// ============== ENV KEY ==============

/**
 * A `envKey` é metadado do registro — a validação do motor recusa provider
 * registrado sem ela. Provedor cadastrado pela tela guarda a chave em
 * `ai_credentials`, então nunca chega aqui; mesmo assim o nome é derivado do
 * slug, e não deixado em branco, como convenção de nomenclatura previsível.
 */
export function deriveEnvKey(slug: string): string {
  const normalized = slug
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `AI_PROVIDER_${normalized}_API_KEY`;
}

/** As embutidas mantêm a `envKey` histórica — renomear quebraria deploys. */
function envKeyFor(slug: string): string {
  const builtIn = BUILT_IN_PROVIDERS.find((provider) => provider.id === slug);
  return builtIn?.envKey ?? deriveEnvKey(slug);
}

// ============== REGISTRO ==============

/**
 * Lê o catálogo e registra cada provedor LIGADO. As embutidas entram antes, e a
 * linha do banco as sobrescreve quando existir — é assim que a `base_url` do
 * `ai-gateway`, que nascia vazia e derrubava toda chamada, passa a vir da tela.
 *
 * 🔴 A leitura NÃO filtra por `active` no banco — de propósito. Um provider
 * DESCARTADO (`active=false`) precisa CHEGAR ao loop pra cair em `disabled`,
 * senão a linha some da resposta e uma embutida do mesmo slug (`anthropic`,
 * `ai-gateway`) fica registrada pra sempre, porque nada além deste loop teria
 * como saber que ela foi descartada. Filtrar no `.eq()` escondia exatamente o
 * caso que `disabled` existe pra sinalizar.
 *
 * Falha de leitura NÃO derruba a IA e NÃO é silenciada: as embutidas seguem
 * registradas e o erro vai para o log. Um catálogo indisponível degrada para o
 * que já funcionava — nunca para nenhum provider.
 */
export async function registerProvidersFromDb(
  dbAdapter: IAiDbAdapter,
): Promise<IProviderCatalog> {
  registerBuiltInProviders();

  let allProviders;
  try {
    allProviders = await dbAdapter.listAllProviders();
  } catch (err) {
    console.warn(
      '[ai:providers] catálogo indisponível, usando apenas as embutidas',
      err instanceof Error ? err.message : 'unknown error',
    );
    return { registered: BUILT_IN_PROVIDERS.map((provider) => provider.id), disabled: [] };
  }

  const registered: string[] = [];
  const disabled: string[] = [];

  for (const row of allProviders) {
    if (!row.enabled) {
      disabled.push(row.slug);
      continue;
    }

    const protocolAdapter = ADAPTER_BY_PROTOCOL[row.protocol as AiProtocol];
    if (!protocolAdapter) {
      console.warn(`[ai:providers] "${row.slug}" declara protocolo desconhecido "${row.protocol}"`);
      continue;
    }

    registerProvider({
      id: row.slug,
      name: row.name,
      envKey: envKeyFor(row.slug),
      adapter: protocolAdapter,
      ...(row.baseUrl ? { baseUrl: row.baseUrl } : {}),
    });
    registered.push(row.slug);
  }

  return { registered, disabled };
}
