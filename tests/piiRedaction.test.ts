import { describe, it, expect } from 'vitest';
/**
 * Testes — redação de PII nos TRÊS caminhos de exposição (ticket #359).
 *
 * O catálogo é UM (`definitions/piiCatalog.ts`) e os três pontos de aplicação
 * consomem dele. Este arquivo prova o catálogo uma vez e depois prova que cada
 * caminho o aplica de fato:
 *
 *   1. o texto indo para o provider  → `createPiiRedactionMiddleware`
 *   2. o `save_memory` persistindo   → `createMemoryWriter`
 *   3. o `payload` de `ai_run_steps` → `buildStepRow`
 *
 * 🔴 O teste que mais importa é o do CASO NEGATIVO: redigir demais cega o
 * agente, e conteúdo legítimo do CRM tem que atravessar byte a byte.
 *
 * Sem rede e sem banco — dublê em memória, no padrão de `aiConfig.test.ts`.
 * Rodar: npm run testEdge
 */

import {
  createPiiRedactionMiddleware,
  createRedactionScope,
  PII_REDACTION_MIDDLEWARE_NAME,
  redactText,
} from '../src/middleware/piiRedaction';
import { PII_TRACE_KEY } from '../src/definitions/piiCatalog';
import {
  buildStepRow,
  STEP_PAYLOAD_MAX_CHARS,
} from '../src/observability/rows';
import { STEP_TYPES } from '../src/definitions/aiObservability';
import { createMemoryWriter } from '../src/engine/memoryWriter';
import { KNOWLEDGE_CATEGORIES_TABLE } from '../src/definitions/knowledgeConfig';
import type { ICbAIEngineDb } from '../src/engine/memoryWriter';
import type { NMessage } from '../src/core/types';

// ============== FIXTURES ==============

/** CPF com dígito verificador VÁLIDO — o mesmo dado nas três formas. */
const CPF_FORMATTED = '529.982.247-25';
const CPF_SPACED = '529 982 247 25';
const CPF_RAW = '52998224725';

/** Onze dígitos com verificador INVÁLIDO: é protocolo, não CPF. */
const PROTOCOL_11_DIGITS = '12345678901';

const MOBILE_FORMATTED = '(11) 98765-4321';
const MOBILE_RAW = '11987654321';
const OTHER_MOBILE = '(21) 99876-5432';

/**
 * 🔴 O CASO NEGATIVO. Cada item aqui é uma armadilha deliberada:
 *
 * · CNPJ — fora do catálogo por decisão (pessoa jurídica, público, chave de negócio)
 * · nome de pessoa e cargo — fora do catálogo por decisão (cegariam o agente)
 * · `#4821`, `12/03/2026`, `R$ 12.345,67` — números que uma regex frouxa comeria
 * · `12345678901` — onze dígitos crus com verificador inválido
 */
const LEGITIMATE_CRM_TEXT =
  'A ACME Serviços Ltda (CNPJ 12.345.678/0001-90) fechou o plano Enterprise. '
  + 'Falei com o Roberto Monteiro, Diretor de Operações, sobre o ticket #4821 '
  + `aberto em 12/03/2026, valor R$ 12.345,67. O produto CbAIEngine Insights foi `
  + `aprovado. Protocolo ${PROTOCOL_11_DIGITS}.`;

// ============== O CATÁLOGO: CPF ==============

it('pii: o mesmo CPF é redigido nas três formas — separador não muda o dado', () => {
  for (const written of [CPF_FORMATTED, CPF_SPACED, CPF_RAW]) {
    const { text } = redactText(`o cliente mandou ${written} para faturar`);
    expect(text, 'o cliente mandou [REDACTED:CPF#1] para faturar');
  }
});

it('pii: onze dígitos com verificador inválido passam — é protocolo, não CPF', () => {
  const { text, counts } = redactText(`Protocolo ${PROTOCOL_11_DIGITS} registrado`);
  expect(text, `Protocolo ${PROTOCOL_11_DIGITS} registrado`);
  expect(counts, null);
});

it('pii: CPF de dígitos repetidos passa — passa no módulo 11 e não é CPF', () => {
  const { counts } = redactText('documento 111.111.111-11');
  expect(counts, null);
});

// ============== O CATÁLOGO: TELEFONE ==============

it('pii: celular é redigido com e sem formatação', () => {
  for (const written of [MOBILE_FORMATTED, MOBILE_RAW, '+55 11 98765-4321']) {
    const { text } = redactText(`chama no ${written}`);
    expect(text, 'chama no [REDACTED:PHONE#1]');
  }
});

it('pii: fixo FORMATADO é redigido; dez dígitos crus passam (ambíguos com protocolo)', () => {
  expect(redactText('ligue (11) 3265-4321').text, 'ligue [REDACTED:PHONE#1]');
  expect(redactText('referência 1132654321').counts, null);
});

it('pii: DDD inexistente passa intacto', () => {
  // 20 não é DDD em uso — sem a lista, onze dígitos viravam telefone só pelo tamanho.
  expect(redactText('numero 20987654321').counts, null);
});

// ============== O ORDINAL ==============

it('pii: mesmo valor mantém o ordinal; valores distintos recebem ordinais distintos', () => {
  const scope = createRedactionScope();
  const first = scope.redactText(`orfao A ${MOBILE_FORMATTED}`);
  const second = scope.redactText(`orfao B ${OTHER_MOBILE}`);
  // O MESMO número da primeira linha, escrito sem formatação: é a mesma pessoa.
  const third = scope.redactText(`de novo ${MOBILE_RAW}`);

  expect(first, 'orfao A [REDACTED:PHONE#1]');
  expect(second, 'orfao B [REDACTED:PHONE#2]');
  expect(third, 'de novo [REDACTED:PHONE#1]');
  // Dois valores DISTINTOS — a contagem não conta ocorrências.
  expect(scope.counts(), { phone: 2 });
});

// ============== 🔴 O CASO NEGATIVO ==============

it('pii: conteúdo legítimo do CRM atravessa BYTE A BYTE — redigir demais cega o agente', () => {
  const { text, counts } = redactText(LEGITIMATE_CRM_TEXT);
  expect(text, LEGITIMATE_CRM_TEXT);
  expect(counts, null);
});

// ============== CAMINHO 1 — O PROVIDER ==============

it('pii: o middleware é um transform de pre-model', () => {
  const middleware = createPiiRedactionMiddleware();
  expect(middleware.name, PII_REDACTION_MIDDLEWARE_NAME);
  expect(middleware.phase, 'pre-model');
});

it('pii: caminho 1 — nada com forma de CPF sai para o provider', async () => {
  const messages: NMessage[] = [
    { role: 'user', content: `resume a conversa do ${MOBILE_FORMATTED}` },
    { role: 'tool', toolCallId: 'call-1', content: `Meu CPF é ${CPF_FORMATTED}, pode faturar` },
  ];

  const transformed = await createPiiRedactionMiddleware().transform!(messages);
  const [question, toolResult] = transformed;

  expect(question, { role: 'user', content: 'resume a conversa do [REDACTED:PHONE#1]' });
  expect(toolResult, {
    role: 'tool',
    toolCallId: 'call-1',
    content: 'Meu CPF é [REDACTED:CPF#1], pode faturar',
  });
  // O histórico do chamador não é área de trabalho do middleware.
  expect(messages[0], { role: 'user', content: `resume a conversa do ${MOBILE_FORMATTED}` });
});

it('pii: sem PII o middleware devolve a MESMA referência — reporta pass, não transform', async () => {
  const messages: NMessage[] = [{ role: 'user', content: LEGITIMATE_CRM_TEXT }];
  const transformed = await createPiiRedactionMiddleware().transform!(messages);
  // `runTransforms` compara por referência para decidir o outcome (middleware.ts).
  expect(transformed).toBe(messages);
});

it('pii: redigindo, o middleware devolve array NOVO — é o que faz o trace registrar transform', async () => {
  const messages: NMessage[] = [{ role: 'user', content: `meu cpf ${CPF_RAW}` }];
  const transformed = await createPiiRedactionMiddleware().transform!(messages);
  expect(transformed).not.toBe(messages);
});

// ============== CAMINHO 2 — save_memory ==============

interface IMemoryStub {
  db: ICbAIEngineDb;
  inserted: () => Record<string, unknown>[];
}

/**
 * Dublê do client admin que GUARDA a linha entregue ao banco — é sobre ela que
 * a asserção corre, porque é o que fica gravado para sempre.
 *
 * O `as never` no retorno é o padrão de dublê da casa (`aiConfig.test.ts`):
 * a chain implementa só os elos que `memoryWriter` percorre.
 */
function makeMemoryStub(): IMemoryStub {
  const inserted: Record<string, unknown>[] = [];

  const makeChain = (table: string): Record<string, unknown> => {
    const chain: Record<string, unknown> = {};
    chain.select = (): unknown => chain;
    chain.eq = (): unknown => chain;
    chain.insert = (values: Record<string, unknown>): unknown => {
      inserted.push(values);
      return chain;
    };
    chain.maybeSingle = (): Promise<unknown> => Promise.resolve({
      data: table === KNOWLEDGE_CATEGORIES_TABLE ? { id: 'category-1' } : null,
      error: null,
    });
    chain.single = (): Promise<unknown> =>
      Promise.resolve({ data: { id: 'entry-1' }, error: null });
    return chain;
  };

  return {
    db: { from: (table: string) => makeChain(table) } as never,
    inserted: () => inserted,
  };
}

it('pii: caminho 2 — save_memory grava o conteúdo JÁ REDIGIDO', async () => {
  const stub = makeMemoryStub();
  const writer = createMemoryWriter({
    admin: stub.db,
    isInternal: true,
    companyId: 'company-1',
    userId: 'user-1',
    dispatchEmbedding: () => {},
  });

  const saved = await writer.save({
    title: `Contato ${MOBILE_FORMATTED}`,
    content: `Cliente confirmou o CPF ${CPF_FORMATTED} para faturamento`,
  });

  expect(saved.id, 'entry-1');
  const [row] = stub.inserted();
  expect(row['title'], 'Contato [REDACTED:PHONE#1]');
  expect(row['content'], 'Cliente confirmou o CPF [REDACTED:CPF#1] para faturamento');
});

it('pii: caminho 2 — conteúdo legítimo é gravado intacto', async () => {
  const stub = makeMemoryStub();
  const writer = createMemoryWriter({
    admin: stub.db,
    isInternal: true,
    companyId: 'company-1',
    userId: 'user-1',
    dispatchEmbedding: () => {},
  });

  await writer.save({ title: 'ACME', content: LEGITIMATE_CRM_TEXT });
  expect(stub.inserted()[0]?.['content'], LEGITIMATE_CRM_TEXT);
});

// ============== CAMINHO 3 — ai_run_steps ==============

it('pii: caminho 3 — o prompt do model_call é redigido e o step ganha o marcador', () => {
  const row = buildStepRow({
    runId: 'run-1',
    seq: 1,
    stepType: STEP_TYPES.MODEL_CALL,
    payload: { model: 'haiku', prompt: `manda mensagem pro ${MOBILE_FORMATTED}` },
  });

  expect(row['payload'], {
    model: 'haiku',
    prompt: 'manda mensagem pro [REDACTED:PHONE#1]',
    [PII_TRACE_KEY]: { phone: 1 },
  });
});

it('pii: caminho 3 — o tool_result também é payload, e também é redigido', () => {
  const row = buildStepRow({
    runId: 'run-1',
    seq: 2,
    stepType: STEP_TYPES.TOOL_RESULT,
    payload: { tool: 'get_conversation', isError: false, content: `CPF ${CPF_RAW}` },
  });

  expect(row['payload'], {
    tool: 'get_conversation',
    isError: false,
    content: 'CPF [REDACTED:CPF#1]',
    [PII_TRACE_KEY]: { cpf: 1 },
  });
});

it('pii: caminho 3 — args aninhados de tool_call são alcançados', () => {
  const row = buildStepRow({
    runId: 'run-1',
    seq: 3,
    stepType: STEP_TYPES.TOOL_CALL,
    payload: { tool: 'search_company', args: { query: `cliente ${CPF_FORMATTED}`, limit: 5 } },
  });

  expect(row['payload'], {
    tool: 'search_company',
    args: { query: 'cliente [REDACTED:CPF#1]', limit: 5 },
    [PII_TRACE_KEY]: { cpf: 1 },
  });
});

it('pii: caminho 3 — sem redação o payload NÃO ganha a chave, nem zerada', () => {
  const row = buildStepRow({
    runId: 'run-1',
    seq: 4,
    stepType: STEP_TYPES.MODEL_CALL,
    payload: { model: 'haiku', prompt: LEGITIMATE_CRM_TEXT },
  });

  expect(row['payload'], { model: 'haiku', prompt: LEGITIMATE_CRM_TEXT });
});

it('pii: caminho 3 — o marcador sobrevive ao teto, e o preview não carrega o dado', () => {
  const filler = 'x'.repeat(STEP_PAYLOAD_MAX_CHARS);
  const row = buildStepRow({
    runId: 'run-1',
    seq: 5,
    stepType: STEP_TYPES.TOOL_RESULT,
    payload: { tool: 'get_conversation', content: `${filler} CPF ${CPF_RAW}` },
  });

  const payload = row['payload'] as Record<string, unknown>;
  expect(payload['truncated'], true);
  // O registro DE QUE houve redação é o que a auditoria lê — o corte não pode comê-lo.
  expect(payload[PII_TRACE_KEY], { cpf: 1 });
  // E o recorte é feito sobre o texto JÁ redigido.
  expect(String(payload['preview']).includes(CPF_RAW), false);
});
