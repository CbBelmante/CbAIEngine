/**
 * 🌐 agentRuntime — Config → agente pronto, para os consumidores de chat
 *
 * O mesmo trecho aparecia três vezes depois da migração: resolver `ai_config`,
 * resolver a credencial, registrar os providers, pendurar os hooks de
 * observabilidade e chamar `createAgent`. Aqui é uma vez.
 *
 * 🔴 Agnóstico a modelo e provedor: cada porta recebe a credencial que é DELA
 * (cadastrada em `ai_credentials`), nunca uma emprestada de outra.
 *
 * Resolver provider/modelo/credencial é trabalho do `aiPort.ts`, e de propósito:
 * quem embeda entra pela MESMA porta. O que sobrou aqui é o que é só de chat —
 * preset, tools, middleware e os hooks de observabilidade.
 */

import { createAgent } from '../core/index';
import type { IAgent } from '../core/index';
import type { IAiDbAdapter } from '../dbAdapter/dbAdapter';
import { resolveAiPort } from './aiPort';
import { createPersistenceHooks } from '../observability/persistenceHooks';
import { createRunRecorder } from '../observability/runRecorder';
import type { RunRecorder } from '../observability/runRecorder';
import { RUN_TRIGGERS } from '../definitions/aiObservability';
import type { RunTrigger } from '../definitions/aiObservability';
import type { IAgentHooks, IAgentPreset, IMiddleware, IToolDef } from '../core/types';

// ============== TYPES ==============

export interface IBuildAgentRuntimeParams {
  preset: IAgentPreset;
  /**
   * A MESMA chave de `ai_config.agent`, de `IAgentPreset.name` e de
   * `ai_agent_runs.agent` — o NOME do agente, nunca uma credencial.
   */
  agent: string;
  admin: IAiDbAdapter;
  dbAdapter: IAiDbAdapter;
  runId: string;
  companyId: string | null;
  tools?: IToolDef[];
  /**
   * Cadeia de middleware do agente (fases `pre-context`/`pre-model`/`post-model`).
   * Entra por AQUI, e não dentro do preset, porque a cadeia depende do REQUEST:
   * o retrieval do #77 fecha sobre o client do caller e o embedder da empresa,
   * que não existem quando o preset é declarado.
   */
  middleware?: IMiddleware[];
  outputSchema?: Record<string, unknown>;
  maxToolLoops?: number;
  trigger?: RunTrigger;
}

export interface IAgentRuntime {
  agent: IAgent;
  provider: string;
  model: string;
  /**
   * Os MESMOS hooks pendurados no agente, expostos para quem chama.
   *
   * 📌 O motor emite `onError` sozinho no que ele observa — falha de provider,
   * de tool e de `check`. O que ele NÃO observa é exceção vinda de um
   * `transform`: `runTransforms` roda fora do try/catch de `loop.ts`, então um
   * middleware que bloqueia em `pre-context` escaparia sem step de erro e
   * deixaria o run pendurado em `running` — e `ai_agent_runs` está no realtime
   * (migration 030), então o run eterno apareceria AO VIVO na tela.
   *
   * Expor os hooks deixa quem chama relatar esse caso pela MESMA política de
   * persistência, sem tocar no motor. Fechar o buraco de vez é uma linha no
   * `loop.ts`, e é trabalho do motor — não de quem pluga um middleware.
   */
  hooks: IAgentHooks;
  /**
   * O recorder do trace DESTE run — o MESMO que os hooks acima usam.
   *
   * É por ele que um middleware grava passo próprio (`observability/stepSink.ts`),
   * e a partilha não é economia: o `seq` é um contador por run e o drill-down da
   * Observabilidade ordena por ele — um recorder paralelo recomeçaria do 1 e
   * mostraria dois passos "primeiro" na timeline.
   *
   * Nasce aqui, e não no chamador, porque carrega o `provider` — que só existe
   * depois de `resolveAiPort`.
   */
  recorder: RunRecorder;
}

// ============== FACTORY ==============

export async function buildAgentRuntime(
  params: IBuildAgentRuntimeParams,
): Promise<IAgentRuntime> {
  const { preset, agent, admin, companyId } = params;

  const { config, credentials } = await resolveAiPort({ admin, agent, companyId });

  // A partir daqui `ai_agent_runs`, `ai_invocations` e `ai_run_steps` param de
  // ficar vazios. Mesmo `runId` que vai em `agent.run()` — é ele que amarra
  // invocações e steps ao run.
  //
  // O recorder nasce ANTES dos hooks e é passado a eles: os dois escrevem no
  // trace pelo mesmo contador de `seq`, e é ele que o `stepSink` entrega a um
  // middleware que precise gravar passo próprio.
  const recorder = createRunRecorder({
    dbAdapter: params.dbAdapter,
    runId: params.runId,
    agent: params.agent,
    provider: config.provider,
    ...(companyId ? { companyId } : {}),
    trigger: params.trigger ?? RUN_TRIGGERS.USER,
  });

  const hooks = createPersistenceHooks({
    dbAdapter: params.dbAdapter,
    runId: params.runId,
    agent: params.agent,
    provider: config.provider,
    recorder,
  });

  return {
    agent: createAgent({
      preset,
      provider: config.provider,
      model: config.model,
      credentials,
      overrides: buildOverrides({ params, config, hooks }),
    }),
    provider: config.provider,
    model: config.model,
    hooks,
    recorder,
  };
}

// ============== HELPERS ==============

/**
 * Só o que foi REALMENTE pedido entra em `overrides`: uma chave presente com
 * valor `undefined` sobrescreveria o que o preset define, e um agente perderia
 * as próprias tools por causa de um parâmetro que ninguém passou.
 */
function buildOverrides(
  { params, config, hooks }: {
    params: IBuildAgentRuntimeParams;
    config: { provider: string; params: Record<string, unknown> };
    hooks: IAgentHooks;
  },
): Record<string, unknown> {
  return {
    ...(params.tools ? { tools: params.tools } : {}),
    ...(params.middleware ? { middleware: params.middleware } : {}),
    ...(params.outputSchema ? { outputSchema: params.outputSchema } : {}),
    ...(params.maxToolLoops ? { maxToolLoops: params.maxToolLoops } : {}),
    hooks,
    params: config.params,
  };
}
