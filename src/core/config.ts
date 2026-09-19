/**
 * 🔧 config — Cascata de config (ai_config) e credencial (ai_credentials)
 *
 * resolveConfig: provider/model/params — TUDO do banco, sem fallback estático.
 * resolveApiKey: ai_credentials(empresa) → ai_credentials(global).
 *
 * 🔴 Agnóstico a modelo e provedor: nada hardcoded em código nenhum lugar da
 * cascata, nem `.env` como rede de segurança. O que não estiver cadastrado no
 * sistema, `ConfigError` recusa em vez de assumir.
 *
 * Dois eixos ortogonais: `active` responde "o registro existe?"
 * (`false` = EXCLUÍDO) e `enabled` responde "está em uso?" (`false` = pausado
 * pela tela de admin, sem excluir). Toda leitura de config filtra pelos DOIS —
 * sem o segundo, o toggle de pausa da tela não teria efeito.
 */

import { ConfigError } from '../providers/registry';
import { AI_AGENTS } from '../definitions/aiAgents';
import type { IAiDbAdapter } from '../dbAdapter/dbAdapter';

// ============== TYPES ==============

export interface IResolvedConfig {
  provider: string;
  model: string;
  params: Record<string, unknown>;
}

export interface IResolveApiKeyParams {
  provider: string;
  companyId?: string;
}

// ============== HELPERS ==============

/** Mescla params campo a campo. `null` explícito no override REMOVE a chave herdada. */
export function mergeParams(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...base, ...override };
  for (const key of Object.keys(merged)) {
    if (merged[key] === null) {
      delete merged[key];
    }
  }
  return merged;
}

// ============== CONFIG CASCADE ==============

/**
 * Resolve config com cascata de 3 níveis via adapter:
 * 1. ai_config da empresa (company override)
 * 2. ai_config global do agente
 * 3. ai_config do agente 'default' (catch-all)
 *
 * Se nenhum nível resolve: ConfigError.
 */
export async function resolveConfig(
  { agent, companyId, adapter }: {
    agent: string;
    companyId?: string;
    adapter: IAiDbAdapter;
  },
): Promise<IResolvedConfig> {
  const config = await adapter.getConfig(agent, companyId);

  if (config) {
    return {
      provider: config.provider,
      model: config.model,
      params: config.params ?? {},
    };
  }

  // Fallback: agente 'default' — só quando `agent` não é 'default'
  if (agent !== AI_AGENTS.DEFAULT) {
    const fallback = await adapter.getConfig(AI_AGENTS.DEFAULT, null);
    if (fallback) {
      return {
        provider: fallback.provider,
        model: fallback.model,
        params: fallback.params ?? {},
      };
    }
  }

  throw new ConfigError(
    `No config found for agent "${agent}": no ai_config row (empresa, global, nem "default"). `
    + 'Cadastre no sistema.',
  );
}

// ============== CREDENTIAL CASCADE ==============

/**
 * Resolve credencial via adapter:
 * 1. ai_credentials da empresa
 * 2. ai_credentials global
 *
 * Se nenhum nível resolve: ConfigError.
 */
export async function resolveApiKey(
  { provider, companyId }: IResolveApiKeyParams,
  adapter: IAiDbAdapter,
): Promise<string> {
  const credential = await adapter.getCredential(provider, companyId);

  if (credential?.apiKey) {
    return credential.apiKey;
  }

  throw new ConfigError(
    `No API key configured for provider "${provider}". `
    + `Checked: ai_credentials (company=${companyId ?? 'none'}, global). `
    + 'Cadastre a chave no sistema.',
  );
}
