/**
 * 🎯 agent — Porta de entrada do motor: `createAgent` e o barrel do módulo
 *
 * `createAgent` é onde uma config defeituosa morre. Recebe preset, provider,
 * modelo e credencial já resolvidos, valida os quatro DE UMA VEZ e só então
 * devolve algo executável. O que sai daqui é um agente cuja config já foi
 * conferida — quem chama `run()` não precisa se defender de novo.
 *
 * ⚠️ `config.ts` fica FORA deste barrel de propósito: ele importa
 * the database adapter e lê `environment variables`, e arrastar isso para dentro do
 * barrel obrigaria todo consumidor — inclusive um teste que só queria o
 * renderer — a ter cliente de banco e the runtime environment. Quem precisa da cascata
 * importa `./config.ts` direto.
 */

import { runAgentLoop, type IProviderCredentials } from './loop';
import { buildConfigFromPreset, type NAgentOverrides } from './preset';
import { joinRenderedPrompt, renderPrompt, type IRenderedPrompt } from './prompt';
import { resolveProvider } from '../providers/registry';
import { AgentConfigError, assertAgentConfig } from './validation';
import type {
  IAgentConfig,
  IAgentPreset,
  IAgentResult,
  IPromptContext,
  IToolContext,
  NMessage,
} from './types';

// ============== TYPES ==============

export interface ICreateAgentParams {
  preset: IAgentPreset;
  /** Id no registry. Vem da config resolvida (`ai_config.provider`). */
  provider: string;
  /** Modelo resolvido. Sem valor de fábrica: ausente é recusa, nunca substituição. */
  model: string;
  /** Credencial JÁ resolvida pela cascata de `config.ts`. */
  credentials: IProviderCredentials;
  overrides?: NAgentOverrides;
}

export interface IAgentRunParams {
  runId: string;
  messages: NMessage[];
  toolContext: IToolContext;
  /** Contexto das sections. Ignorado quando `systemPrompt` é string pura. */
  promptContext: IPromptContext;
}

export interface IAgent {
  /** `IAgentPreset.name` — a mesma chave de `ai_config.agent`. */
  readonly name: string;
  readonly provider: string;
  readonly config: IAgentConfig;
  /**
   * Exposto separado de `run` porque o par estável/volátil é a fronteira do
   * prompt caching: quem for montar blocos com `buildSystemBlocks` (#72)
   * precisa das duas metades, não da string já achatada.
   */
  renderPrompt(context: IPromptContext): Promise<IRenderedPrompt>;
  run(params: IAgentRunParams): Promise<IAgentResult>;
}

// ============== FACTORY ==============

/**
 * Valida a config inteira e devolve o agente pronto.
 *
 * A validação acontece AQUI, antes de qualquer chamada ao provider, e reporta
 * todos os defeitos numa `AgentConfigError` só. Empurrá-la para dentro de
 * `run()` transformaria erro de configuração em erro de execução: a falha
 * apareceria com a chave já gasta, no meio de um loop, longe da causa.
 */
export function createAgent(
  { preset, provider, model, credentials, overrides }: ICreateAgentParams,
): IAgent {
  const config = buildConfigFromPreset({ preset, model, overrides });

  assertAgentConfig({ config, provider, apiKey: credentials.apiKey });

  // Só depois da validação: `assertAgentConfig` já provou que o provider existe
  // e tem adapter. A guarda abaixo é inalcançável por esse caminho e fica assim
  // mesmo — o registry é um Map global e mutável (`registerProvider`,
  // `clearRegistry`), e um `as` aqui trocaria uma checagem de uma linha por uma
  // afirmação ao compilador que ninguém verifica.
  const adapter = resolveProvider(provider).adapter;
  if (!adapter) {
    throw new AgentConfigError([{
      path: '$.provider.adapter',
      message: `provider "${provider}" is registered without an adapter`,
    }]);
  }

  return {
    name: preset.name,
    provider,
    config,
    renderPrompt(context: IPromptContext): Promise<IRenderedPrompt> {
      return renderPrompt({ prompt: config.systemPrompt, context });
    },
    async run({ runId, messages, toolContext, promptContext }: IAgentRunParams): Promise<IAgentResult> {
      const rendered = await renderPrompt({ prompt: config.systemPrompt, context: promptContext });
      return await runAgentLoop({
        config,
        adapter,
        system: joinRenderedPrompt(rendered),
        messages,
        toolContext,
        credentials,
        run: { id: runId, provider, agent: preset.name },
      });
    },
  };
}

// ============== BARREL ==============

export * from './types';
export * from './prompt';
export * from './preset';
export * from './validation';
export * from './agentConfigSchema';
export * from './jsonSchema';
export * from './hooks';
export * from './middleware';
export * from './structuredOutput';
export * from './toolRunner';
export * from './loop';
export * from '../providers/registry';
export * from '../providers/errors';
export * from '../providers/index';
