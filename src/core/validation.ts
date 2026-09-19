/**
 * 🛡️ validation — Recusa na ENTRADA, com a lista INTEIRA de defeitos
 *
 * Duas garantias, e as duas são sobre quando/quanto se descobre:
 *
 * 1. **Entrada, não runtime.** Config errada morre em `createAgent`, antes de
 *    qualquer `adapter.chat`. Descobrir na quarta volta significa ter gasto
 *    chave, tokens e latência para chegar a um erro que já era visível.
 *
 * 2. **Todos os erros de uma vez.** Config com três defeitos devolve três
 *    linhas. Parar no primeiro obriga a rodar três vezes para achar três
 *    problemas — e quem paga é a tela `/admin/ai` (#74), que precisa mostrar a
 *    lista inteira ao super admin numa tela só.
 *
 * O acúmulo não é engenhoca própria: as regras estruturais são delegadas ao
 * `validateAgainstSchema` do #68, que JÁ devolve `ISchemaViolation[]`. As
 * regras semânticas — as que o limite declarado dele não cobre — produzem o
 * MESMO tipo, e o resultado é a concatenação de todas. Um formato de erro só,
 * renderizado por `formatViolations`. Nenhum segundo validador.
 */

import { formatViolations, ROOT_PATH, validateAgainstSchema, type ISchemaViolation } from './jsonSchema';
import { AGENT_CONFIG_SCHEMA } from './agentConfigSchema';
import { ConfigError, resolveProvider, type IRegisteredProvider } from '../providers/registry';
import { isPromptTemplate } from './prompt';
import { OUTPUT_TOOL_NAME } from './structuredOutput';
import type { IAgentConfig } from './types';

// ============== ERROR ==============

/**
 * Carrega as violações estruturadas além da mensagem: a tela precisa da lista
 * para renderizar item a item, e reparsear texto formatado seria devolver ao
 * consumidor um trabalho que já foi feito aqui.
 */
export class AgentConfigError extends Error {
  override readonly name = 'AgentConfigError';
  readonly violations: ISchemaViolation[];

  constructor(violations: ISchemaViolation[]) {
    super(`Invalid agent config (${violations.length}): ${formatViolations(violations)}`);
    this.violations = violations;
  }
}

// ============== HELPERS ==============

function violate(path: string, message: string): ISchemaViolation {
  return { path, message };
}

function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim().length === 0;
}

// ============== SEMANTIC RULES ==============

/**
 * Sem modelo não há substituição — há recusa.
 *
 * Um default aqui gastaria chave num modelo que ninguém escolheu e esconderia
 * config faltante justamente de quem foi configurá-la. Quem escolhe modelo é
 * `ai_config` (empresa → global → agente `default`); se nem isso resolveu, o
 * pedido está incompleto e o lugar de dizer isso é aqui.
 */
function collectModelViolations(config: IAgentConfig): ISchemaViolation[] {
  if (isBlank(config.model)) {
    return [violate(`${ROOT_PATH}.model`, 'model is required and must be a non-empty string (no default is ever assumed)')];
  }
  return [];
}

function collectProviderViolations(
  { provider, apiKey }: { provider: string; apiKey?: string },
): ISchemaViolation[] {
  const path = `${ROOT_PATH}.provider`;
  if (isBlank(provider)) {
    return [violate(path, 'provider is required and must be a non-empty string')];
  }

  let registered: IRegisteredProvider;
  try {
    registered = resolveProvider(provider);
  } catch (error) {
    const detail = error instanceof ConfigError ? error.message : String(error);
    return [violate(path, detail)];
  }

  const violations: ISchemaViolation[] = [];
  // Adapter é opcional no registry (a cascata de credencial só precisa de
  // `envKey`), então um provider sem porta é registrável — e inútil para o motor.
  if (!registered.adapter) {
    violations.push(violate(`${path}.adapter`, `provider "${provider}" is registered without an adapter`));
  }
  if (isBlank(registered.envKey)) {
    violations.push(violate(`${path}.envKey`, `provider "${provider}" is registered without an envKey`));
  }
  if (isBlank(apiKey)) {
    violations.push(violate(
      `${ROOT_PATH}.credentials.apiKey`,
      `no API key for provider "${provider}" (cascade: ai_credentials by company, ai_credentials global)`,
    ));
  }
  return violations;
}

function collectToolViolations(config: IAgentConfig): ISchemaViolation[] {
  const tools = config.tools;
  if (!Array.isArray(tools)) { return []; }

  const violations: ISchemaViolation[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < tools.length; index++) {
    const tool = tools[index];
    const path = `${ROOT_PATH}.tools[${index}]`;
    if (!tool) { continue; }

    if (typeof tool.handler !== 'function') {
      violations.push(violate(`${path}.handler`, 'handler must be a function'));
    }
    // Nome vazio passa pelo `type: 'string'` do schema e morre em silêncio no
    // fio: o modelo nunca consegue nomear a tool, e `toolRunner` nunca a acha.
    if (isBlank(tool.name)) {
      violations.push(violate(`${path}.name`, 'name is required and must be a non-empty string'));
      continue;
    }

    if (seen.has(tool.name)) {
      // `toolRunner` resolve por `find()`: nome repetido faz o segundo virar
      // código morto que nunca executa, sem erro nenhum.
      violations.push(violate(`${path}.name`, `duplicate tool name "${tool.name}"`));
    }
    seen.add(tool.name);

    if (config.outputSchema && tool.name === OUTPUT_TOOL_NAME) {
      violations.push(violate(
        `${path}.name`,
        `tool name "${OUTPUT_TOOL_NAME}" collides with the structured-output tool`,
      ));
    }
  }
  return violations;
}

function collectSectionViolations(sections: unknown): ISchemaViolation[] {
  const path = `${ROOT_PATH}.systemPrompt.sections`;
  if (!Array.isArray(sections)) {
    return [violate(path, 'sections must be an array')];
  }

  const violations: ISchemaViolation[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < sections.length; index++) {
    const section: unknown = sections[index];
    const itemPath = `${path}[${index}]`;
    if (typeof section !== 'object' || section === null) {
      violations.push(violate(itemPath, 'section must be an object'));
      continue;
    }

    const entry = section as Record<string, unknown>;
    if (typeof entry['builder'] !== 'function') {
      violations.push(violate(`${itemPath}.builder`, 'builder must be a function'));
    }
    if (entry['when'] !== undefined && typeof entry['when'] !== 'function') {
      violations.push(violate(`${itemPath}.when`, 'when must be a function when present'));
    }

    const key = entry['key'];
    if (isBlank(key)) {
      violations.push(violate(`${itemPath}.key`, 'key is required and must be a non-empty string'));
      continue;
    }
    const name = String(key);
    // Chave repetida não quebra o render — produz duas sections indistinguíveis
    // no prompt, e a intenção de sobrescrever uma delas falha em silêncio.
    if (seen.has(name)) {
      violations.push(violate(`${itemPath}.key`, `duplicate section key "${name}"`));
    }
    seen.add(name);
  }
  return violations;
}

function collectPromptViolations(config: IAgentConfig): ISchemaViolation[] {
  const prompt = config.systemPrompt;
  const path = `${ROOT_PATH}.systemPrompt`;

  if (prompt === undefined || prompt === null) { return []; }

  if (!isPromptTemplate(prompt)) {
    if (isBlank(prompt)) {
      return [violate(path, 'systemPrompt must be a non-empty string or a prompt template')];
    }
    return [];
  }

  const violations: ISchemaViolation[] = [];
  if (isBlank(prompt.base)) {
    violations.push(violate(`${path}.base`, 'base is required and must be a non-empty string'));
  }
  violations.push(...collectSectionViolations(prompt.sections));
  return violations;
}

/** `minimum` está fora do limite declarado do `jsonSchema.ts`; o piso mora aqui. */
function collectLimitViolations(config: IAgentConfig): ISchemaViolation[] {
  const violations: ISchemaViolation[] = [];
  const limits: Array<{ key: 'maxTokens' | 'maxToolLoops'; value: number | undefined }> = [
    { key: 'maxTokens', value: config.maxTokens },
    { key: 'maxToolLoops', value: config.maxToolLoops },
  ];
  for (const limit of limits) {
    if (limit.value === undefined || !Number.isInteger(limit.value)) { continue; }
    if (limit.value <= 0) {
      violations.push(violate(`${ROOT_PATH}.${limit.key}`, `${limit.key} must be greater than 0`));
    }
  }
  return violations;
}

// ============== AGGREGATION ==============

export interface IValidateAgentConfigParams {
  config: IAgentConfig;
  provider: string;
  apiKey?: string;
}

/**
 * Concatena TODAS as regras. Nenhum `return` antecipado entre elas: é
 * exatamente essa ausência que faz três defeitos virarem três violações.
 */
export function collectAgentConfigViolations(
  { config, provider, apiKey }: IValidateAgentConfigParams,
): ISchemaViolation[] {
  return [
    ...validateAgainstSchema({ value: config, schema: AGENT_CONFIG_SCHEMA }).violations,
    ...collectModelViolations(config),
    ...collectProviderViolations({ provider, apiKey }),
    ...collectPromptViolations(config),
    ...collectToolViolations(config),
    ...collectLimitViolations(config),
  ];
}

export function assertAgentConfig(params: IValidateAgentConfigParams): void {
  const violations = collectAgentConfigViolations(params);
  if (violations.length > 0) { throw new AgentConfigError(violations); }
}
