/**
 * 🔧 registry — Provider registry por lookup (Map), zero switch/if de provider
 *
 * Adicionar provider = registerProvider(), sem tocar no motor.
 * Reusa IProvider de types.ts; o `adapter` entra opcional (ver IRegisteredProvider).
 */

import type { IProvider } from '../core/types';

// ============== TYPES ==============

/**
 * Entrada do registry. O `adapter` é OPCIONAL de propósito: resolver o provider e
 * saber falar com ele são perguntas distintas, e o registry serve as duas — a
 * cascata de credencial (config.ts) só precisa de `envKey`, enquanto o motor
 * precisa do adapter. Obrigatório, forçaria todo registro de teste a carregar um
 * adapter que não vai usar.
 */
export type IRegisteredProvider =
  Pick<IProvider, 'id' | 'name' | 'baseUrl' | 'envKey'>
  & Partial<Pick<IProvider, 'adapter'>>;

// ============== ERROR ==============

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

// ============== REGISTRY ==============

const registry = new Map<string, IRegisteredProvider>();

export function registerProvider(provider: IRegisteredProvider): void {
  registry.set(provider.id, provider);
}

export function resolveProvider(id: string): IRegisteredProvider {
  const provider = registry.get(id);
  if (!provider) {
    throw new ConfigError(`Unknown provider: "${id}". Registered: [${[...registry.keys()].join(', ')}]`);
  }
  return provider;
}

export function listRegisteredProviders(): IRegisteredProvider[] {
  return [...registry.values()];
}

export function clearRegistry(): void {
  registry.clear();
}
