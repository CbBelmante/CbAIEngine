/**
 * 🔧 providers — Registro das duas portas (ADR §8.4)
 *
 * Entradas são DADO: `id` casa com `ai_config.provider`, e é por ele que a
 * escolha de porta acontece em runtime, por empresa e por agente, sem deploy.
 */

import { registerProvider } from './registry';
import type { IRegisteredProvider } from './registry';
import { openaiCompatibleAdapter } from './openaiCompatible';
import { anthropicAdapter } from './anthropic';

// ============== ENTRIES ==============

/**
 * `baseUrl` fica indefinido enquanto a URL não for valor de deploy: o adapter é
 * de protocolo e recusa com erro claro se rodar sem ela — melhor do que assumir
 * um provedor por default e mandar a chave de um pra outro.
 */
export const AI_GATEWAY_PROVIDER: IRegisteredProvider = {
  id: 'ai-gateway',
  name: 'AI Gateway (OpenAI-compatible)',
  envKey: 'AI_GATEWAY_API_KEY',
  adapter: openaiCompatibleAdapter,
};

export const ANTHROPIC_PROVIDER: IRegisteredProvider = {
  id: 'anthropic',
  name: 'Anthropic',
  envKey: 'ANTHROPIC_API_KEY',
  adapter: anthropicAdapter,
};

export const BUILT_IN_PROVIDERS: readonly IRegisteredProvider[] = [
  AI_GATEWAY_PROVIDER,
  ANTHROPIC_PROVIDER,
];

// ============== REGISTRATION ==============

/**
 * Chamada explícita, não side-effect de import: um `import` que popula registry
 * global surpreende quem só queria um tipo, e colidiria com o `clearRegistry()`
 * dos testes. Idempotente — `registerProvider` é um `Map.set`.
 */
export function registerBuiltInProviders(): void {
  for (const provider of BUILT_IN_PROVIDERS) { registerProvider(provider); }
}

export { anthropicAdapter, openaiCompatibleAdapter };
