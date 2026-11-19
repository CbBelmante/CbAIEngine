import { describe, it, expect } from 'vitest';
/**
 * Testes — sumarização de contexto, a alavanca de custo (ticket #360).
 *
 * 🔴 O que estes casos protegem, e por quê cada um morde:
 *
 *   · o LIMIAR nos dois sentidos — abaixo NÃO condensa (e nem chama o modelo),
 *     acima condensa. Um limiar que dispara por reflexo troca economia por gasto;
 *   · o trace bate com a REALIDADE — o caso ponta a ponta roda o motor de
 *     verdade com um provider que cobra tokens pelo tamanho REAL do que recebe,
 *     e compara com o que o `ai_run_steps` afirmou. Gravar a intenção e chamar
 *     de medida é o defeito que este arquivo existe para impedir;
 *   · o protocolo continua válido — um `tool_result` sem o `tool_use` que o
 *     pediu faz o provider recusar a requisição INTEIRA;
 *   · PII não vaza para quem resume — este middleware roda ANTES do gate final
 *     de redação, então o transcript que ele envia sairia cru;
 *   · sem config não há modelo emprestado — a recusa é do summarizer, e a
 *     conversa segue sem economizar.
 *
 * Sem rede e sem banco — dublê em memória, no padrão de `piiRedaction.test.ts`.
 * Rodar: npm run testEdge
 */

import {
  buildSummaryMessage,
  CONTEXT_SUMMARIZATION_MIDDLEWARE_NAME,
  CONTEXT_SUMMARY_HEADING,
  createContextSummarizationMiddleware,
  findSafeBoundary,
  type ISummarizeRequest,
  type ISummaryResult,
  NO_REDUCTION_REASON,
  renderTranscript,
  SUMMARIZER_FAILED_REASON,
} from '../src/middleware/contextSummarization';
import {
  estimateTokens,
  type ISummarizationPolicy,
  resolveSummarizationPolicy,
  SUMMARIZATION_DEFAULTS,
  SUMMARIZATION_PARAM_KEYS,
  TOKEN_ESTIMATOR_ID,
} from '../src/definitions/contextSummarization';
import { createDeferredStepSink } from '../src/observability/stepSink';
import { createRunRecorder } from '../src/observability/runRecorder';
import type { DbRow } from '../src/observability/types';
import type { IAiDbAdapter } from '../src/dbAdapter/dbAdapter';
import { RUN_TRIGGERS } from '../src/definitions/aiObservability';
import { runAgentLoop } from '../src/core/loop';
import type {
  IAgentConfig,
  IChatRequest,
  IMiddleware,
  IProviderAdapter,
  NMessage,
  NResponse,
} from '../src/core/types';

// ============== DUBLÊS ==============

/** Mock de IAiDbAdapter que guarda as linhas que o recorder escreveria. */
function memoryDb(): { db: IAiDbAdapter; rows: DbRow[] } {
  const rows: DbRow[] = [];
  const db: IAiDbAdapter = {
    getConfig: async () => null,
    getCredential: async () => null,
    listProviders: async () => [],
    listAllProviders: async () => [],
    getProvider: async () => null,
    openRun: async (run) => { rows.push(run as unknown as DbRow); return run.id ?? 'run-1'; },
    closeRun: async (_id, status, error) => { rows.push({ status, error } as unknown as DbRow); },
    recordInvocation: async (inv) => { rows.push(inv as unknown as DbRow); },
    recordStep: async (step) => { rows.push(step as unknown as DbRow); },
    getModelPricing: async () => null,
    getConsumptionStatus: async () => null,
    searchKnowledge: async () => [],
    getKnowledgeCategoryBySlug: async () => null,
    insertKnowledgeEntry: async () => null,
    insertInsights: async () => [],
    hasInsightsFrom: async () => false,
    recordToolMessage: async () => {},
  };
  return { db, rows };
}

function stepsOf(rows: DbRow[]): DbRow[] {
  // ⚠️ `stepType`, e não `step_type`: quem grava é `recordStep` do
  // `IAiDbAdapter`, que recebe camelCase. O nome em snake era do mock antigo,
  // e com ele o filtro devolvia lista vazia — toda asserção abaixo passava a
  // olhar `undefined`.
  return rows.filter((row) => row['stepType'] !== undefined);
}

/** O sink já ligado a um recorder de verdade — é a fiação que o handler monta. */
function tracedSink(): { record: ReturnType<typeof createDeferredStepSink>['record']; rows: DbRow[] } {
  const { db, rows } = memoryDb();
  const sink = createDeferredStepSink();
  sink.attach(createRunRecorder({
    dbAdapter: db,
    runId: 'run-1',
    agent: 'assistant',
    provider: 'test',
    trigger: RUN_TRIGGERS.USER,
  }));
  return { record: sink.record, rows };
}

interface ISummarizerSpy {
  summarize: (request: ISummarizeRequest) => Promise<ISummaryResult>;
  calls: ISummarizeRequest[];
}

function summarizerSpy(text = 'RECAP: o cliente pediu o prazo.'): ISummarizerSpy {
  const calls: ISummarizeRequest[] = [];
  return {
    calls,
    summarize: (request: ISummarizeRequest): Promise<ISummaryResult> => {
      calls.push(request);
      return Promise.resolve({
        text,
        usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
      });
    },
  };
}

function refusingSummarizer(): ISummarizerSpy {
  const calls: ISummarizeRequest[] = [];
  return {
    calls,
    summarize: (request: ISummarizeRequest): Promise<ISummaryResult> => {
      calls.push(request);
      return Promise.reject(new Error('No config found for agent "summarize"'));
    },
  };
}

// ============== FIXTURES ==============

const POLICY: ISummarizationPolicy = {
  triggerTokens: 200,
  keepRecentMessages: 4,
  charsPerToken: 4,
  maxSummaryTokens: 400,
};

/** ~120 chars por fala: 20 falas passam do limiar de 200 tokens (800 chars). */
function longHistory(turns = 20): NMessage[] {
  const messages: NMessage[] = [];
  for (let index = 0; index < turns; index++) {
    messages.push({ role: 'user', content: `pergunta ${index} ${'a'.repeat(110)}` });
    messages.push({ role: 'assistant', content: `resposta ${index} ${'b'.repeat(110)}` });
  }
  return messages;
}

const SHORT_HISTORY: NMessage[] = [
  { role: 'user', content: 'bom dia' },
  { role: 'assistant', content: 'bom dia! em que posso ajudar?' },
];

function build(
  { policy, spy, record }: {
    policy: ISummarizationPolicy;
    spy: ISummarizerSpy;
    record: ReturnType<typeof createDeferredStepSink>['record'];
  },
): IMiddleware {
  return createContextSummarizationMiddleware({ summarize: spy.summarize, recordStep: record, policy });
}

function runTransform(middleware: IMiddleware, messages: NMessage[]): Promise<NMessage[]> {
  // O contrato do motor: `transform` é opcional no tipo, presente aqui.
  return Promise.resolve(middleware.transform?.(messages) ?? messages);
}

// ============== O LIMIAR — OS DOIS SENTIDOS ==============

it('abaixo do limiar: NADA muda, e o modelo NÃO é chamado', async () => {
  const spy = summarizerSpy();
  const { record } = tracedSink();
  const middleware = build({ policy: POLICY, spy, record });

  const result = await runTransform(middleware, SHORT_HISTORY);

  // Mesma REFERÊNCIA: é o que faz `runTransforms` reportar `pass` em vez de
  // `transform` (middleware.ts). Um array novo idêntico passaria num expect
  // e mentiria no trace.
  expect(result).toBe(SHORT_HISTORY);
  expect(spy.calls.length, 'sumarização por reflexo é gasto, não economia').toBe(0);
});

it('acima do limiar: condensa, e as recentes ficam BYTE A BYTE', async () => {
  const spy = summarizerSpy();
  const { record } = tracedSink();
  const middleware = build({ policy: POLICY, spy, record });
  const history = longHistory();

  const result = await runTransform(middleware, history);

  expect(spy.calls.length).toBe(1);
  expect(result.length).not.toEqual(history.length);
  expect(result.slice(1), 'a conversa viva é preservada literal — o resumo só substitui o que já foi resolvido')
    .toEqual(history.slice(history.length - POLICY.keepRecentMessages));
});

it('o resumo entra IDENTIFICÁVEL: system + rótulo que diz que substitui', async () => {
  const spy = summarizerSpy('RECAP: prazo do #4821 é sexta.');
  const { record } = tracedSink();
  const middleware = build({ policy: POLICY, spy, record });

  const [first] = await runTransform(middleware, longHistory());

  expect(first?.role).toBe('system');
  const content = String((first as { content: string }).content);
  expect(content.startsWith(CONTEXT_SUMMARY_HEADING)).toBe(true);
  expect(content.includes('RECAP: prazo do #4821 é sexta.')).toBe(true);
});

// ============== O TRACE — ANTES/DEPOIS QUE BATEM COM A REALIDADE ==============

it('o trace grava antes/depois em tokens, e declara COMO mediu', async () => {
  const spy = summarizerSpy();
  const { record, rows } = tracedSink();
  const middleware = build({ policy: POLICY, spy, record });
  const history = longHistory();

  const result = await runTransform(middleware, history);

  const [step] = stepsOf(rows);
  const payload = step?.['payload'] as Record<string, unknown>;
  expect(payload['name']).toBe(CONTEXT_SUMMARIZATION_MIDDLEWARE_NAME);
  expect(payload['estimator']).toBe(TOKEN_ESTIMATOR_ID);
  expect(payload['charsPerToken']).toBe(POLICY.charsPerToken);
  expect(payload['messagesBefore']).toBe(history.length);
  expect(payload['messagesAfter']).toBe(result.length);

  // 🔴 A âncora: o número gravado é recomputado do array REALMENTE devolvido,
  // com a régua declarada no próprio payload. Um `tokensAfter` de intenção
  // (o teto pedido ao modelo, um valor fixo) não sobrevive a isto.
  const charsAfter = result.map((message) => String((message as { content: string }).content).length)
    .reduce((total, chars) => total + chars, 0);
  expect(payload['charsAfter']).toBe(charsAfter);
  expect(payload['tokensAfter'])
    .toBe(estimateTokens({ chars: charsAfter, charsPerToken: POLICY.charsPerToken }));
  expect(
    Number(payload['tokensAfter']) < Number(payload['tokensBefore']),
    'o passo só é gravado como condensação quando houve redução',
  ).toBe(true);
});

// ============== PONTA A PONTA PELO MOTOR ==============

/**
 * O provider dublê COBRA pelo tamanho real do que recebe — é a única forma de
 * provar que a redução é de verdade e não uma contabilidade paralela. Se o
 * middleware devolvesse o histórico intacto e mentisse no trace, `promptTokens`
 * não se mexeria e o caso abaixo ficaria vermelho.
 */
function chargingAdapter(): { adapter: IProviderAdapter; seen: IChatRequest[] } {
  const seen: IChatRequest[] = [];
  return {
    seen,
    adapter: {
      chat(request: IChatRequest): Promise<NResponse> {
        seen.push(request);
        const chars = request.messages
          .map((message) => String((message as { content?: string }).content ?? '').length)
          .reduce((total, value) => total + value, 0);
        const promptTokens = estimateTokens({ chars, charsPerToken: 4 });
        return Promise.resolve({
          text: 'ok',
          toolCalls: [],
          finishReason: 'stop',
          usage: { promptTokens, completionTokens: 5, totalTokens: promptTokens + 5 },
        });
      },
    },
  };
}

function loopConfig(middleware: IMiddleware[]): IAgentConfig {
  return { model: 'test-model', systemPrompt: 'system', middleware, maxToolLoops: 1 };
}

async function runThroughEngine(middleware: IMiddleware[]): Promise<number> {
  const { adapter } = chargingAdapter();
  const result = await runAgentLoop({
    config: loopConfig(middleware),
    adapter,
    system: 'system',
    messages: longHistory(),
    toolContext: { db: null, userId: 'user-1' },
    credentials: { apiKey: 'k' },
    run: { id: 'run-1', provider: 'test', agent: 'assistant' },
  });
  return result.usage.promptTokens;
}

it('ponta a ponta: o provider COBRA menos, e o trace disse a verdade', async () => {
  const spy = summarizerSpy();
  const { record, rows } = tracedSink();
  const middleware = build({ policy: POLICY, spy, record });

  const withMiddleware = await runThroughEngine([middleware]);
  const withoutMiddleware = await runThroughEngine([]);

  // 🔴 CONTRAPROVA VIVA: tirar o middleware da cadeia devolve o gasto integral.
  expect(withMiddleware < withoutMiddleware, `sem redução real não há alavanca (${withMiddleware} vs ${withoutMiddleware})`)
    .toBe(true);

  const payload = stepsOf(rows)[0]?.['payload'] as Record<string, unknown>;
  // O trace não é uma contabilidade paralela: o que ele afirmou é o que o
  // provider cobrou, medido do lado de fora.
  expect(payload['tokensBefore']).toBe(withoutMiddleware);
  expect(payload['tokensAfter']).toBe(withMiddleware);
});

// ============== INTEGRIDADE DO PROTOCOLO ==============

it('o corte NUNCA deixa um tool_result órfão no trecho preservado', () => {
  const messages: NMessage[] = [
    { role: 'user', content: 'lista os tickets' },
    { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'list_tickets', args: {} }] },
    { role: 'tool', toolCallId: 't1', content: '3 tickets' },
    { role: 'tool', toolCallId: 't2', content: '2 eventos' },
    { role: 'assistant', content: 'são 3' },
    { role: 'user', content: 'e os eventos?' },
  ];

  // Um corte cego pediria o índice 3 — um `tool` sem o `assistant` que o chamou.
  const boundary = findSafeBoundary({ messages, keepRecentMessages: 3 });

  // Avança sobre o `tool` órfão E sobre o `assistant` que abriria a conversa.
  expect(boundary).toBe(5);
  expect(messages[boundary]?.role).toBe('user');
});

/**
 * Quando NENHUMA fronteira serve, o corte vai ao fim — e o `transform` devolve o
 * histórico original em vez de mandar um array que só teria o `system` (que o
 * adapter Anthropic remove, deixando a requisição sem mensagem nenhuma).
 */
it('sem fronteira segura no trecho recente, NÃO condensa', async () => {
  const messages: NMessage[] = [
    { role: 'user', content: 'lista os tickets' },
    { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'list_tickets', args: {} }] },
    { role: 'tool', toolCallId: 't1', content: 'x'.repeat(400) },
    { role: 'assistant', content: 'y'.repeat(400) },
  ];
  expect(findSafeBoundary({ messages, keepRecentMessages: 3 })).toBe(messages.length);

  const spy = summarizerSpy();
  const { record } = tracedSink();
  const middleware = build({ policy: { ...POLICY, keepRecentMessages: 3 }, spy, record });

  const result = await runTransform(middleware, messages);

  expect(result).toBe(messages);
  expect(spy.calls.length, 'nem chega a pagar o resumo').toBe(0);
});

/**
 * 🔴 A SEGUNDA regra de fronteira, e a que faltava (review do #406).
 *
 * A mensagem de resumo é `role:'system'`, e o adapter Anthropic move todo
 * `system` para o campo próprio — some do array. Então quem ABRE o array no fio
 * é o primeiro do trecho preservado, e um `assistant` ali é uma conversa que
 * começa pela fala do modelo.
 *
 * Não é borda: `keep_recent_messages` PAR sobre um histórico que termina na
 * pergunta corrente faz a paridade cair num `assistant` sempre que o retrieval
 * não injetou bloco. Remover o avanço sobre `assistant` em `findSafeBoundary`
 * deixa os dois casos abaixo vermelhos.
 */
it('fronteira: keep PAR sobre histórico que termina em user NÃO abre com assistant', () => {
  // user,assistant,user,assistant,…,user — o formato que `loadHistory` devolve.
  const messages: NMessage[] = [];
  for (let index = 0; index < 5; index++) {
    messages.push({ role: 'user', content: `p${index}` });
    messages.push({ role: 'assistant', content: `r${index}` });
  }
  messages.push({ role: 'user', content: 'a pergunta corrente' });

  const boundary = findSafeBoundary({ messages, keepRecentMessages: 6 });

  expect(messages[boundary]?.role, 'o corte cai num assistant e precisa avançar').toBe('user');
});

it('condensação real: o trecho preservado abre com user, nunca com assistant', async () => {
  const spy = summarizerSpy();
  const { record } = tracedSink();
  const middleware = build({ policy: { ...POLICY, keepRecentMessages: 6 }, spy, record });

  const history: NMessage[] = [];
  for (let index = 0; index < 20; index++) {
    history.push({ role: 'user', content: `pergunta ${index} ${'a'.repeat(110)}` });
    history.push({ role: 'assistant', content: `resposta ${index} ${'b'.repeat(110)}` });
  }
  history.push({ role: 'user', content: 'a pergunta corrente' });

  const result = await runTransform(middleware, history);

  expect(result[0]?.role, 'o resumo abre o array…').toBe('system');
  // …e some no fio do adapter Anthropic, então quem ABRE de verdade é este:
  expect(result[1]?.role, 'sem o `system`, um assistant abriria a conversa no fio — o provider recusa')
    .toBe('user');
});

it('condensação real: o trecho preservado não começa com tool', async () => {
  const spy = summarizerSpy();
  const { record } = tracedSink();
  const middleware = build({ policy: { ...POLICY, keepRecentMessages: 3 }, spy, record });

  const history: NMessage[] = [
    ...longHistory(10),
    { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'list_tickets', args: {} }] },
    { role: 'tool', toolCallId: 't1', content: 'x'.repeat(200) },
    { role: 'tool', toolCallId: 't2', content: 'y'.repeat(200) },
    { role: 'assistant', content: 'pronto' },
    // A pergunta corrente: `recordUserMessage` roda ANTES de `loadHistory`, então
    // o histórico que chega ao motor sempre termina numa fala do usuário.
    { role: 'user', content: 'e agora?' },
  ];

  const result = await runTransform(middleware, history);

  expect(result[0]?.role).toBe('system');
  expect(result[1]?.role).not.toEqual('tool', 'tool_result sem tool_use faz o provider recusar tudo');
  expect(result[1]?.role, 'e um assistant abrindo o array no fio também é recusado').toBe('user');
});

// ============== PII NÃO VAZA PARA QUEM RESUME ==============

/** CPF com dígito verificador VÁLIDO — o mesmo do `piiRedaction.test.ts`. */
const CPF_FORMATTED = '529.982.247-25';

it('o transcript enviado a quem resume vai REDIGIDO', async () => {
  const spy = summarizerSpy();
  const { record } = tracedSink();
  const middleware = build({ policy: POLICY, spy, record });

  const history: NMessage[] = [
    { role: 'user', content: `meu cpf é ${CPF_FORMATTED} ${'z'.repeat(300)}` },
    ...longHistory(10),
  ];
  await runTransform(middleware, history);

  const sent = spy.calls[0]?.text ?? '';
  // 🔴 Este middleware roda ANTES do gate final de PII: sem a redação própria,
  // o CPF sairia cru para o provider de quem resume — um quarto caminho de
  // exposição, contornando o catálogo do #359.
  expect(sent.includes(CPF_FORMATTED)).toBe(false);
  expect(sent.includes('[REDACTED:CPF#1]')).toBe(true);
});

// ============== SEM MODELO: RECUSA, JAMAIS FALLBACK ==============

it('summarizer que recusa: histórico INTACTO e o trace diz que pulou', async () => {
  const spy = refusingSummarizer();
  const { record, rows } = tracedSink();
  const middleware = build({ policy: POLICY, spy, record });
  const history = longHistory();

  const result = await runTransform(middleware, history);

  expect(result).toBe(history, 'economia que não pode rodar não derruba a conversa');
  const payload = stepsOf(rows)[0]?.['payload'] as Record<string, unknown>;
  expect(payload['skipped']).toBe(SUMMARIZER_FAILED_REASON);
  // A falha é DESCRITA, nunca engolida — a regra dura do projeto.
  expect(typeof (payload['error'] as Record<string, unknown>)['message']).toBe('string');
});

// ============== A CONFERÊNCIA DA PROMESSA ==============

it('resumo que não encolhe o contexto é DESCARTADO', async () => {
  const spy = summarizerSpy('R'.repeat(20_000));
  const { record, rows } = tracedSink();
  const middleware = build({ policy: POLICY, spy, record });
  const history = longHistory();

  const result = await runTransform(middleware, history);

  expect(result).toBe(history);
  const payload = stepsOf(rows)[0]?.['payload'] as Record<string, unknown>;
  expect(payload['skipped']).toBe(NO_REDUCTION_REASON);
});

// ============== MEMOIZAÇÃO — UMA CHAMADA POR TRECHO, NÃO POR VOLTA ==============

it('três voltas do tool-loop pagam UM resumo, não três', async () => {
  const spy = summarizerSpy();
  const { record } = tracedSink();
  const middleware = build({ policy: POLICY, spy, record });
  const history = longHistory();

  await runTransform(middleware, history);
  await runTransform(middleware, history);
  await runTransform(middleware, history);

  // A fase `pre-model` roda A CADA volta (loop.ts). Sem memoização, o remédio
  // custaria mais que a doença.
  expect(spy.calls.length).toBe(1);
});

// ============== O LIMIAR É DECLARATIVO ==============

it('ai_config.params sobrescreve o limiar; lixo cai no default', () => {
  const overridden = resolveSummarizationPolicy({
    [SUMMARIZATION_PARAM_KEYS.TRIGGER_TOKENS]: 12_000,
    [SUMMARIZATION_PARAM_KEYS.KEEP_RECENT_MESSAGES]: 10,
  });
  expect(overridden.triggerTokens).toBe(12_000);
  expect(overridden.keepRecentMessages).toBe(10);

  // `params` é jsonb livre: a tela pode gravar string, zero ou negativo. Um
  // limiar `0` faria a sumarização rodar em toda conversa — o oposto do pedido.
  const rubbish = resolveSummarizationPolicy({
    [SUMMARIZATION_PARAM_KEYS.TRIGGER_TOKENS]: 0,
    [SUMMARIZATION_PARAM_KEYS.KEEP_RECENT_MESSAGES]: 'seis',
  });
  expect(rubbish.triggerTokens).toBe(SUMMARIZATION_DEFAULTS.trigger_tokens);
  expect(rubbish.keepRecentMessages).toBe(SUMMARIZATION_DEFAULTS.keep_recent_messages);

  // Contagem de MENSAGENS não aceita fração: `6.5` daria um índice de corte
  // fracionário, e o número gravado no trace deixaria de descrever o corte que
  // aconteceu. O limiar em TOKENS, esse sim, aceita fracionário.
  const fractional = resolveSummarizationPolicy({
    [SUMMARIZATION_PARAM_KEYS.KEEP_RECENT_MESSAGES]: 6.5,
    [SUMMARIZATION_PARAM_KEYS.TRIGGER_TOKENS]: 6000.5,
  });
  expect(fractional.keepRecentMessages).toBe(SUMMARIZATION_DEFAULTS.keep_recent_messages);
  expect(fractional.triggerTokens).toBe(6000.5);
});

it('o teto do resumo é INTEIRO: `max_tokens` fracionário nem sai daqui', () => {
  // `maxSummaryTokens` viaja como `maxTokens` até `max_tokens` no fio, e as duas
  // portas exigem inteiro. `ai_config.params` é `jsonb` livre: sem esta recusa,
  // um `400.5` gravado pela tela atravessaria o motor inteiro e só apareceria
  // como erro do provider — longe de quem o digitou.
  const fractional = resolveSummarizationPolicy({
    [SUMMARIZATION_PARAM_KEYS.MAX_SUMMARY_TOKENS]: 400.5,
  });
  expect(fractional.maxSummaryTokens).toBe(SUMMARIZATION_DEFAULTS.max_summary_tokens);
  expect(Number.isInteger(fractional.maxSummaryTokens)).toBeTruthy();

  // Contraprova do CASO NEGATIVO: inteiro legítimo tem de PASSAR. Uma recusa que
  // barra tudo passaria neste teste sem guardar nada.
  const honest = resolveSummarizationPolicy({
    [SUMMARIZATION_PARAM_KEYS.MAX_SUMMARY_TOKENS]: 900,
  });
  expect(honest.maxSummaryTokens).toBe(900);
});

it('o default do catálogo é o que vale quando ninguém configurou', async () => {
  const spy = summarizerSpy();
  const { record } = tracedSink();
  // Sem `policy`: o middleware usa o catálogo.
  const middleware = createContextSummarizationMiddleware({
    summarize: spy.summarize,
    recordStep: record,
  });

  // Abaixo de 6.000 tokens (24.000 chars) o default NÃO condensa…
  await runTransform(middleware, longHistory(20));
  expect(spy.calls.length).toBe(0);

  // …e acima, condensa. É o mesmo número do catálogo, medido dos dois lados.
  await runTransform(middleware, longHistory(120));
  expect(spy.calls.length).toBe(1);
});

// ============== HELPERS PUROS ==============

it('o transcript rotula quem falou — e conta os args de tool call', () => {
  const rendered = renderTranscript([
    { role: 'user', content: 'oi' },
    { role: 'assistant', content: 'eis', toolCalls: [{ id: 't1', name: 'list_tickets', args: { limit: 5 } }] },
    { role: 'tool', toolCallId: 't1', content: '3 tickets' },
  ]);

  expect(rendered.includes('user: oi')).toBe(true);
  expect(rendered.includes('tool result: 3 tickets')).toBe(true);
  // Args voltam ao histórico na volta seguinte e custam token como qualquer
  // outro conteúdo: ignorá-los subestimaria as conversas com mais voltas.
  expect(rendered.includes('list_tickets({"limit":5})')).toBe(true);
});

it('a mensagem de resumo é system — o papel que os dois adapters entendem', () => {
  // O adapter Anthropic funde `system` no campo próprio e o OpenAI-compatible a
  // mantém inline: `role:'system'` é o que torna o resumo agnóstico de provider.
  expect(buildSummaryMessage('x').role).toBe('system');
});
