/**
 * 🔧 preset — Declaração de preset e a fusão preset + modelo → `IAgentConfig`
 *
 * Um preset descreve o AGENTE: prompt, tools, middleware e tetos de
 * comportamento. Não descreve infraestrutura — nem provider, nem modelo. Essa
 * separação é o que faz "reusar em outro projeto" custar um arquivo: o preset
 * atravessa provedores sem reescrita, e a escolha de modelo permanece onde já
 * mora hoje, na config por empresa (`ai_config`, migration 019).
 */

import type { IAgentConfig, IAgentPreset } from './types';

// ============== TYPES ==============

/** Tudo que `createAgent` aceita sobrescrever sobre o preset, menos o modelo. */
export type NAgentOverrides = Partial<Omit<IAgentConfig, 'model'>>;

export interface IBuildConfigFromPresetParams {
  preset: IAgentPreset;
  /** Vem da config resolvida. Sem default: ausência é erro, nunca substituição. */
  model: string;
  overrides?: NAgentOverrides;
}

// ============== DEFINITION ==============

/**
 * Identidade tipada, no molde do `defineConfig` do Vite.
 *
 * Existe pelo lugar em que ela move o erro: sem a função, um literal solto só
 * é confrontado com `IAgentPreset` quando alguém o passa adiante, e o
 * compilador aponta a linha do CONSUMO. Com ela, o campo errado é sublinhado
 * no arquivo do preset, que é onde o autor está olhando.
 */
export function defineAgentPreset(preset: IAgentPreset): IAgentPreset {
  return preset;
}

// ============== MERGE ==============

/**
 * Remove chaves que existem com valor `undefined`. Um override explícito
 * `{ tools: undefined }` sobrescreve o preset com nada — e uma chave presente
 * valendo `undefined` não é a mesma coisa que chave ausente para quem faz
 * `'tools' in config`.
 */
const OPTIONAL_CONFIG_KEYS = [
  'tools',
  'middleware',
  'hooks',
  'outputSchema',
  'params',
  'maxTokens',
  'maxToolLoops',
] as const;

function dropUndefinedFields(config: IAgentConfig): IAgentConfig {
  for (const key of OPTIONAL_CONFIG_KEYS) {
    if (config[key] === undefined) { delete config[key]; }
  }
  return config;
}

/**
 * Funde preset, modelo e overrides numa `IAgentConfig`.
 *
 * A precedência dos tetos é override → preset → `preset.defaults`, e `defaults`
 * fica por último de propósito: é o piso sugerido pelo autor do preset, não uma
 * escolha, e qualquer coisa dita adiante o supera. Nenhum campo tem valor de
 * fábrica aqui — o teto real de voltas e de tokens é do motor
 * (`DEFAULT_MAX_TOOL_LOOPS` / `DEFAULT_MAX_TOKENS` em `loop.ts`), e duplicá-lo
 * criaria dois lugares para mudar um número só.
 */
export function buildConfigFromPreset(
  { preset, model, overrides }: IBuildConfigFromPresetParams,
): IAgentConfig {
  // `name`, `description` e `defaults` descrevem o PRESET, não a config — saem
  // aqui para não vazarem como propriedades estranhas dentro de `IAgentConfig`.
  const { name: _name, description: _description, defaults, ...presetConfig } = preset;

  const config: IAgentConfig = { ...presetConfig, ...overrides, model };

  const maxTokens = config.maxTokens ?? defaults?.maxTokens;
  if (maxTokens !== undefined) { config.maxTokens = maxTokens; }

  const maxToolLoops = config.maxToolLoops ?? defaults?.maxToolLoops;
  if (maxToolLoops !== undefined) { config.maxToolLoops = maxToolLoops; }

  return dropUndefinedFields(config);
}
