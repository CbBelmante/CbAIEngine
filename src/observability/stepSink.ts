/**
 * 🔧 stepSink — Como um MIDDLEWARE grava um passo próprio no trace
 *
 * O motor emite `onMiddleware(name, phase, outcome)` e nada mais: a assinatura
 * é do contrato (`types.ts`), e um middleware que precise registrar NÚMEROS —
 * a redução de tokens da sumarização, o motivo de um bloqueio de moderação —
 * não tem por onde. Alterar o hook para caber um payload novo mudaria o motor
 * a cada middleware novo, que é exatamente o que a arquitetura de fases existe
 * para evitar.
 *
 * A saída é este canal estreito: o middleware recebe um `MiddlewareStepRecorder`
 * pela fábrica e escreve seu próprio `ai_run_steps`. Nada aqui é da sumarização
 * — é superfície compartilhada, e o segundo middleware que precisar dela usa
 * como está.
 *
 * 🔴 O `seq` é o motivo de existir um sink DIFERIDO em vez de um `RunRecorder`
 * novo. O `seq` é um contador por run, e o drill-down da Observabilidade ordena
 * por ele: um segundo recorder recomeçaria do 1 e embaralharia a timeline com
 * dois passos "primeiro". O sink liga o middleware ao MESMO recorder dos hooks
 * de persistência — e precisa ser diferido porque a cadeia de middleware é
 * montada ANTES de `resolveAiPort`, e o recorder só pode nascer depois (é o
 * `provider` resolvido que ele carrega).
 *
 * Uso:
 * ```ts
 * const trace = createDeferredStepSink();
 * const middleware = [createSomeMiddleware({ recordStep: trace.record })];
 * const { agent, recorder } = await buildAgentRuntime({ middleware, … });
 * trace.attach(recorder);        // antes de `agent.run()` — o middleware só roda lá dentro
 * ```
 */

import { reportPersistenceFailure } from './runRecorder';
import type { IStepRecord, RunRecorder } from './runRecorder';

// ============== TYPES ==============

/** O que um middleware recebe para escrever no trace. Nunca lança: falha vira log. */
export type MiddlewareStepRecorder = (record: IStepRecord) => Promise<void>;

export interface IDeferredStepSink {
  /** Injete ISTO no middleware. É estável — vale antes e depois do `attach`. */
  record: MiddlewareStepRecorder;
  /** Liga o sink ao recorder do run. Chamado uma vez, antes de `agent.run()`. */
  attach(recorder: RunRecorder): void;
}

// ============== CONSTANTS ==============

export const DETACHED_SINK_LABEL = 'stepSink:detached';

/**
 * Quem monta a cadeia esqueceu o `attach`. Não enfileiramos o passo para
 * entregar depois de propósito: a fila esconderia o erro de montagem e o trace
 * ficaria certo por acidente. O passo se perde, e o motivo aparece no log.
 */
export const DETACHED_SINK_REASON =
  'middleware wrote a trace step before attach(recorder) — the step was dropped';

// ============== FACTORY ==============

export function createDeferredStepSink(): IDeferredStepSink {
  let attached: RunRecorder | null = null;

  return {
    record(step: IStepRecord): Promise<void> {
      if (!attached) {
        reportPersistenceFailure({ label: DETACHED_SINK_LABEL, reason: DETACHED_SINK_REASON });
        return Promise.resolve();
      }
      // O recorder já é fail-soft (`persistSafely`): reporta o motivo e segue.
      // O middleware está no caminho crítico, e nada que ele escreva no trace
      // pode derrubar a conversa.
      return attached.recordStep(step);
    },

    attach(recorder: RunRecorder): void {
      attached = recorder;
    },
  };
}
