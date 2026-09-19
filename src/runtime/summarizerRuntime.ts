/**
 * 🌐 summarizerRuntime — Config → quem resume o contexto, pela MESMA porta
 *
 * Irmão de `agentRuntime.ts` e `embeddingRuntime.ts`: entra pelo `aiPort.ts`,
 * então quem condensa contexto resolve provider, modelo, `base_url` e
 * credencial exatamente como quem conversa e quem embeda — `ai_providers`,
 * `ai_config` (empresa → global → agente `default`) e `ai_credentials`.
 *
 * 🔴 **Nunca existe modelo default.** O modelo que RESUME é escolhido em
 * `ai_config`, agente `summarize`, como qualquer outro. Sem linha cadastrada a
 * cascata recusa com `ConfigError` — e a recusa sobe, nunca vira uma chamada a
 * um modelo de fábrica. É justamente por esse agente ter config PRÓPRIA que a
 * sumarização é alavanca de custo: um modelo barato resumindo para um modelo
 * caro é onde a economia acontece.
 *
 * ⚠️ Chamada de turno único: sem tools, sem loop, sem `createAgent`. O que se
 * pede aqui é uma compressão de texto, e montar um agente completo para isso
 * criaria um run aninhado dentro do run que está sendo medido.
 */

import type { IAiDbAdapter } from '../dbAdapter/dbAdapter';
import { AI_AGENTS } from '../definitions/aiAgents';
import {
  CONTEXT_SUMMARY_SYSTEM_PROMPT,
  type ISummarizationPolicy,
  resolveSummarizationPolicy,
} from '../definitions/contextSummarization';
import { resolveConfig } from '../core/config';
import { ConfigError } from '../providers/registry';
import type {
  ContextSummarizer,
  ISummarizeRequest,
  ISummaryResult,
} from '../middleware/contextSummarization';
import { CBAI_SCHEMA, resolveAiPort } from './aiPort';

// ============== CONSTANTS ==============

const POLICY_LOG_LABEL = '[ai:summarization_policy]';

// ============== TYPES ==============

export interface IBuildSummarizerParams {
  admin: IAiDbAdapter;
  /** Empresa dona da config/credencial. `null` resolve pelo global. */
  companyId: string | null;
}

// ============== FACTORY ==============

export async function buildContextSummarizer(
  { admin, companyId }: IBuildSummarizerParams,
): Promise<ContextSummarizer> {
  const { config, provider, credentials } = await resolveAiPort({
    admin,
    agent: AI_AGENTS.SUMMARIZE,
    companyId,
  });

  // Um provider registrado sem adapter é registrável e inútil para o motor —
  // a mesma recusa explícita do `buildEmbedder`, com o nome do provider na
  // mensagem, em vez de um `fetch` de emergência escondido.
  const adapter = provider.adapter;
  if (!adapter) {
    throw new ConfigError(
      `Provider "${config.provider}" has no chat adapter. `
      + `Point ai_config.agent='${AI_AGENTS.SUMMARIZE}' at a provider that implements chat.`,
    );
  }

  return async function summarize(request: ISummarizeRequest): Promise<ISummaryResult> {
    const response = await adapter.chat({
      model: config.model,
      system: CONTEXT_SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: request.text }],
      tools: [],
      maxTokens: request.maxTokens,
      ...credentials,
      ...(config.params ? { params: config.params } : {}),
    });
    return { text: response.text, usage: response.usage };
  };
}

/**
 * A porta resolvida SÓ na primeira chamada — e uma vez só.
 *
 * 🔴 A razão é custo, que é o assunto do middleware inteiro: `resolveAiPort` faz
 * três leituras (`ai_providers`, `ai_config`, `ai_credentials`), e o caminho que
 * as usa dispara em conversa longa — a minoria dos turnos. Resolver na montagem
 * da cadeia cobraria as três de TODO turno para um resumo que quase nunca
 * acontece.
 *
 * A promessa é memoizada, não o resultado: chamadas concorrentes na mesma volta
 * compartilham uma resolução. Falha NÃO é memoizada — um provider que voltou do
 * ar volta a funcionar no turno seguinte.
 */
export function createLazyContextSummarizer(
  params: IBuildSummarizerParams,
): ContextSummarizer {
  let pending: Promise<ContextSummarizer> | null = null;

  return function summarize(request: ISummarizeRequest): Promise<ISummaryResult> {
    if (!pending) {
      pending = buildContextSummarizer(params).catch((error: unknown) => {
        pending = null;
        throw error;
      });
    }
    return pending.then((summarizer) => summarizer(request));
  };
}

// ============== POLICY ==============

/**
 * O LIMIAR, resolvido de `ai_config.params` do agente `summarize`.
 *
 * 🔴 Esta leitura é EAGER, ao contrário da porta acima, e a assimetria é
 * deliberada: o limiar é consultado em TODO turno (é ele que decide se há
 * condensação), enquanto o MODELO só é preciso quando o limiar estoura. Resolver
 * o limiar preguiçosamente faria o primeiro turno acima do teto usar o default
 * enquanto a empresa tinha outro cadastrado — uma divergência de cobrança que
 * ninguém veria. Uma leitura indexada por turno é o preço de um número correto.
 *
 * Sem linha de `ai_config` valem os defaults do catálogo. Isto NÃO é fallback de
 * modelo: quem recusa por falta de modelo é o summarizer, na hora de resumir.
 */
export async function resolveSummarizationPolicyFromConfig(
  { admin, companyId }: IBuildSummarizerParams,
): Promise<ISummarizationPolicy> {
  try {
    const config = await resolveConfig({
      agent: AI_AGENTS.SUMMARIZE,
      ...(companyId ? { companyId } : {}),
      adapter: admin,
    });
    return resolveSummarizationPolicy(config.params);
  } catch (error) {
    // 🔴 Duas coisas diferentes chegam aqui, e gritar `error` nas duas seria
    // ruído que treina o operador a ignorar o log. `ConfigError` é "ninguém
    // cadastrou o agente `summarize` ainda" — o estado DEFAULT do sistema hoje,
    // uma vez por turno, e nada quebrou: valem os defaults do catálogo. Qualquer
    // OUTRA falha (banco fora, schema errado) é problema de verdade e continua
    // em `error`. Nunca silenciado, nos dois casos.
    if (error instanceof ConfigError) {
      console.warn(POLICY_LOG_LABEL, 'sem ai_config para "summarize" — usando os defaults');
      return resolveSummarizationPolicy();
    }
    console.error(POLICY_LOG_LABEL, error);
    return resolveSummarizationPolicy();
  }
}
