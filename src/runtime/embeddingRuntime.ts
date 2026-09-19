/**
 * 🌐 embeddingRuntime — Config → embedder pronto, pela MESMA porta do chat
 *
 * Irmão de `agentRuntime.ts`, e agora por construção: os dois entram pelo
 * `aiPort.ts`, então quem embeda resolve provider, modelo, `base_url` e
 * credencial EXATAMENTE como quem conversa — `ai_providers`, `ai_config`
 * (empresa → global → agente `default`) e `ai_credentials` (empresa → global).
 *
 * 🔴 É o que impede o defeito que o #372 documentou e o #72 matou. Um `fetch`
 * direto no `embed`, com a chave lida na unha, recriaria o caminho
 * paralelo: embedding deixaria de ser configurável por empresa e uma empresa
 * em outro gateway receberia a chave errada, calada.
 *
 * ⚠️ **Client ADMIN.** `ai_config` só é legível por `is_internal_staff()` e
 * `ai_credentials` guarda segredo — mesmo motivo do `agentRuntime.ts`.
 */

import type { IAiDbAdapter } from '../dbAdapter/dbAdapter';
import { ConfigError } from '../providers/registry';
import type { IEmbedResponse } from '../core/types';
import { resolveAiPort } from './aiPort';

// ============== CONSTANTS ==============

/** A MESMA chave de `ai_config.agent` — cadastrada na tela `/admin/ai` como qualquer outro agente. */
export const EMBEDDING_AGENT_KEY = 'embedding';

// ============== TYPES ==============

export interface IBuildEmbedderParams {
  admin: IAiDbAdapter;
  /** Empresa dona da config/credencial. `null` resolve pelo global. */
  companyId: string | null;
}

export interface IEmbedder {
  /** Nome do modelo resolvido — é ele que vai para `ai_knowledge_entries.embedding_model`. */
  readonly model: string;
  readonly provider: string;
  embed(input: string[]): Promise<IEmbedResponse>;
}

// ============== FACTORY ==============

export async function buildEmbedder(
  { admin, companyId }: IBuildEmbedderParams,
): Promise<IEmbedder> {
  const { config, provider, credentials } = await resolveAiPort({
    admin,
    agent: EMBEDDING_AGENT_KEY,
    companyId,
  });

  // Recusa em vez de cair num `fetch` de emergência: um provider sem `embed`
  // (a Anthropic é um) configurado por engano tem de doer AQUI, com o nome do
  // provider na mensagem, e não virar um caminho paralelo escondido.
  const adapter = provider.adapter;
  const embedPort = adapter?.embed;
  if (!adapter || !embedPort) {
    throw new ConfigError(
      `Provider "${config.provider}" does not implement embeddings. `
      + `Set ai_config.agent='${EMBEDDING_AGENT_KEY}' to an OpenAI-compatible provider.`,
    );
  }

  return {
    model: config.model,
    provider: config.provider,
    embed: (input: string[]): Promise<IEmbedResponse> =>
      embedPort.call(adapter, { model: config.model, input, ...credentials }),
  };
}
