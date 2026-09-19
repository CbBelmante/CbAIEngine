/**
 * 🔧 hooks — Emissão de eventos read-only e fail-soft
 *
 * Portão único por onde todo hook passa. READ-ONLY: o retorno é descartado de
 * propósito, nenhum hook altera a execução. FAIL-SOFT: hook que lança não derruba
 * o loop — o erro é logado (nunca silenciado) e a volta segue. Observabilidade
 * quebrada não pode quebrar o agente, e isso vale inclusive para o `onError`.
 */

import type { IAgentHooks } from './types';

// ============== CONSTANTS ==============

export const HOOK_ERROR_PREFIX = '[agent:hook]';

// ============== EMISSION ==============

export async function emitHook<K extends keyof IAgentHooks>(
  { hooks, name, args }: {
    hooks: IAgentHooks | undefined;
    name: K;
    args: Parameters<NonNullable<IAgentHooks[K]>>;
  },
): Promise<void> {
  const hook = hooks?.[name];
  if (typeof hook !== 'function') { return; }

  try {
    await (hook as (...hookArgs: unknown[]) => unknown)(...args);
  } catch (error) {
    // Este catch É o fail-soft inteiro: sem ele, um hook de observabilidade
    // quebrado derruba o run do agente.
    console.error(HOOK_ERROR_PREFIX, name, error);
  }
}
