/**
 * 🔧 tools — `defineTool` e o registry por lookup, sem switch de tool
 *
 * O motor já sabe EXECUTAR uma tool (`toolRunner.ts`) e já declara a forma dela
 * (`IToolDef` em `types.ts`). O que faltava era o lugar onde um conjunto de
 * tools é declarado e resolvido por nome — e é só isso que mora aqui.
 *
 * Mesmo padrão de `providers/registry.ts`: lookup num `Map`, zero `switch`.
 * Acrescentar uma tool é acrescentar uma entrada; nenhum arquivo existente
 * precisa de cirurgia para receber a próxima.
 *
 * ⚠️ Fora do barrel de `index.ts` pelo mesmo motivo que `config.ts`: quem
 * precisa do registry importa `./tools.ts` direto. Aqui não há dependência de
 * runtime, mas o barrel é o contrato de entrada do motor, e o registry é
 * ferramenta de quem MONTA um agente, não de quem o consome.
 */

import type { IToolContext, IToolDef } from './types';

// ============== CONSTANTS ==============

export const DUPLICATE_TOOL_MESSAGE_PREFIX = 'Tool already registered:';

// ============== ERROR ==============

/**
 * Nome repetido é defeito de montagem, não de execução: o `Map` aceitaria o
 * segundo em silêncio e a primeira tool sumiria do agente sem nenhum sinal.
 * Lança na montagem, longe de qualquer chave gasta.
 */
export class ToolRegistryError extends Error {
  override readonly name = 'ToolRegistryError';
}

// ============== TYPES ==============

export interface IToolRegistry {
  /** Na ordem de registro — é ela que chega ao modelo em `IAgentConfig.tools`. */
  list(): IToolDef[];
  get(name: string): IToolDef | undefined;
  /** Acrescenta uma tool depois da construção. Nome repetido lança. */
  register(tool: IToolDef): void;
  has(name: string): boolean;
}

// ============== DEFINITION ==============

/**
 * Identidade tipada, no molde de `defineAgentPreset` (`preset.ts`).
 *
 * Existe pelo lugar em que move o erro: sem ela, um literal solto só é
 * confrontado com `IToolDef` quando alguém o passa adiante, e o compilador
 * aponta a linha do CONSUMO. Com ela, o campo errado é sublinhado no arquivo da
 * tool, que é onde o autor está olhando.
 */
export function defineTool(tool: IToolDef): IToolDef {
  return tool;
}

// ============== REGISTRY ==============

export function createToolRegistry(tools: IToolDef[] = []): IToolRegistry {
  const registry = new Map<string, IToolDef>();

  function register(tool: IToolDef): void {
    if (registry.has(tool.name)) {
      throw new ToolRegistryError(`${DUPLICATE_TOOL_MESSAGE_PREFIX} ${tool.name}`);
    }
    registry.set(tool.name, tool);
  }

  for (const tool of tools) { register(tool); }

  return {
    list: (): IToolDef[] => [...registry.values()],
    get: (name: string): IToolDef | undefined => registry.get(name),
    has: (name: string): boolean => registry.has(name),
    register,
  };
}

// ============== METADATA QUERIES ==============

/**
 * Filtra por `category`. Serve a quem monta o agente — um consumidor que só
 * pode ler (portal, cron) recebe as `read` sem precisar listar nomes na mão e
 * sem esquecer a tool nova que alguém acrescentou depois.
 */
export function filterToolsByCategory(
  { tools, category }: { tools: IToolDef[]; category: IToolDef['category'] },
): IToolDef[] {
  return tools.filter((tool) => tool.category === category);
}

/**
 * Tools aplicáveis a um scope. Tool SEM `scope` vale em todos — a ausência é
 * "irrestrita", nunca "nenhum", que é o que um `includes` cru devolveria.
 */
export function filterToolsByScope(
  { tools, scope }: { tools: IToolDef[]; scope: string },
): IToolDef[] {
  return tools.filter((tool) => !tool.scope || tool.scope.includes(scope));
}

/**
 * Resolve a mensagem de recusa sem executar a tool.
 *
 * `toolRunner.ts` já faz isto no caminho de execução; aqui a mesma pergunta é
 * respondida ANTES, para quem precisa explicar a indisponibilidade sem gastar
 * uma volta do modelo. `undefined` significa permitida.
 */
export function resolveToolRefusal(
  { tool, context }: { tool: IToolDef; context: IToolContext },
): string | undefined {
  if (!tool.allowedWhen || tool.allowedWhen(context)) { return undefined; }
  if (typeof tool.onNotAllowed === 'function') { return tool.onNotAllowed(context); }
  return tool.onNotAllowed;
}
