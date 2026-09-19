/**
 * 🌐 openaiCompatible — Adapter do protocolo OpenAI-compatible (chat + embeddings)
 *
 * Adapter de PROTOCOLO, não de marca: com `baseUrl` configurável o mesmo arquivo
 * atende qualquer gateway compatível sem código novo (ADR §3.2/§8.4). Tudo que
 * este arquivo conhece do fio para aqui — o retorno é `NResponse`, idêntico ao
 * do Anthropic. As DUAS portas (`chat`, `embed`) dividem baseUrl, header e
 * credencial: é o que deixa o RAG reusar a cascata do chat, sem chave própria.
 */

import type {
  IChatRequest,
  IEmbedRequest,
  IEmbedResponse,
  IProviderAdapter,
  NMessage,
  NMessagePart,
  NResponse,
  NToolCall,
  NToolDef,
  NUsage,
} from '../core/types';
import { ConfigError } from './registry';
import { ProviderHttpError, ProviderParseError } from './errors';

// ============== CONSTANTS ==============

const PROVIDER_LABEL = 'openai-compatible';
const CHAT_COMPLETIONS_PATH = '/chat/completions';
const EMBEDDINGS_PATH = '/embeddings';

/**
 * O que este adapter sabe mapear de `IChatRequest.params`. Chave fora da lista é
 * ignorada em silêncio — `params` viaja opaco pelo motor e cada provedor tem o
 * seu dialeto, então recusar o que não se entende quebraria config legítima do
 * vizinho. `provider` é o bloco de roteamento do OpenRouter (`order`, `only`,
 * `quantizations`, `data_collection`, `max_price`), repassado verbatim.
 *
 * `tool_choice` NÃO está aqui de propósito: o forçamento é instrução do motor
 * (`IChatRequest.toolChoice`), e aceitá-lo por `params` deixaria a config da tela
 * desligar a garantia de saída estruturada sem ninguém perceber.
 */
export const PASSTHROUGH_PARAMS = [
  'temperature', 'top_p', 'reasoning', 'provider',
] as const satisfies readonly string[];

// ============== WIRE TYPES ==============

interface IWireToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface IWireResponse {
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: IWireToolCall[] };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

interface IWireEmbeddingResponse {
  data?: Array<{ index?: number; embedding?: number[] }>;
  usage?: { prompt_tokens?: number; total_tokens?: number };
}

// ============== HELPERS ==============

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** O v1 serializa `text`/`reasoning`; `file` fica de fora até haver caso multimodal (§3.2). */
function flattenContent(content: string | NMessagePart[] | undefined): string {
  if (typeof content === 'string') { return content; }
  if (!content) { return ''; }
  const chunks: string[] = [];
  for (const part of content) {
    if (part.type === 'text' || part.type === 'reasoning') { chunks.push(part.text); }
  }
  return chunks.join('\n');
}

// ============== REQUEST ==============

function buildHeaders(apiKey: string): Record<string, string> {
  return { 'authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' };
}

/** `args` é objeto no contrato; no fio vira string JSON. Espelho do `JSON.parse` da volta. */
function toWireToolCall(call: NToolCall): IWireToolCall {
  return {
    id: call.id,
    type: 'function',
    function: { name: call.name, arguments: JSON.stringify(call.args) },
  };
}

function toWireTool(tool: NToolDef): Record<string, unknown> {
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.schema },
  };
}

function mapMessages(messages: NMessage[]): Array<Record<string, unknown>> {
  const wire: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (message.role === 'tool') {
      wire.push({ role: 'tool', tool_call_id: message.toolCallId, content: message.content });
      continue;
    }
    if (message.role === 'assistant') {
      const calls = message.toolCalls ?? [];
      const entry: Record<string, unknown> = {
        role: 'assistant',
        content: flattenContent(message.content) || null,
      };
      if (calls.length > 0) { entry['tool_calls'] = calls.map(toWireToolCall); }
      wire.push(entry);
      continue;
    }
    wire.push({ role: message.role, content: flattenContent(message.content) });
  }
  return wire;
}

function pickParams(params: Record<string, unknown> | undefined): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  if (!params) { return picked; }
  for (const key of PASSTHROUGH_PARAMS) {
    if (params[key] !== undefined) { picked[key] = params[key]; }
  }
  return picked;
}

function buildRequestBody(req: IChatRequest): Record<string, unknown> {
  const messages: Array<Record<string, unknown>> = [];
  // Assimetria: aqui o system é a PRIMEIRA mensagem do array; na Anthropic é campo próprio.
  if (req.system) { messages.push({ role: 'system', content: req.system }); }
  messages.push(...mapMessages(req.messages));

  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens,
    messages,
    ...pickParams(req.params),
  };
  if (req.tools.length > 0) { body['tools'] = req.tools.map(toWireTool); }
  // Assimetria: nome ANINHADO sob `function`; na Anthropic é `{type:'tool', name}`.
  if (req.toolChoice) {
    body['tool_choice'] = { type: 'function', function: { name: req.toolChoice } };
  }
  return body;
}

// ============== RESPONSE ==============

function createToolArgsError(call: IWireToolCall, raw: string): ProviderParseError {
  return new ProviderParseError({
    toolName: call.function?.name ?? '<unknown>',
    toolCallId: call.id ?? '<unknown>',
    rawArguments: raw,
  });
}

/**
 * A assimetria central do ticket: `arguments` chega como string JSON e
 * `NToolCall.args` é sempre objeto. Entrada hostil — string malformada vira
 * `ProviderParseError` com a tool e o payload, nunca o `SyntaxError` cru.
 */
function parseToolArgs(call: IWireToolCall): Record<string, unknown> {
  const raw = call.function?.arguments ?? '';
  if (raw.trim() === '') { return {}; }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw createToolArgsError(call, raw);
  }
  if (!isPlainObject(parsed)) { throw createToolArgsError(call, raw); }
  return parsed;
}

function mapToolCalls(calls: IWireToolCall[]): NToolCall[] {
  const mapped: NToolCall[] = [];
  for (const call of calls) {
    mapped.push({
      id: call.id ?? '',
      name: call.function?.name ?? '',
      args: parseToolArgs(call),
    });
  }
  return mapped;
}

function mapUsage(usage: IWireResponse['usage']): NUsage {
  const promptTokens = usage?.prompt_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: usage?.total_tokens ?? promptTokens + completionTokens,
  };
}

function toNeutralResponse(data: IWireResponse): NResponse {
  const choice = data.choices?.[0];
  const toolCalls = mapToolCalls(choice?.message?.tool_calls ?? []);
  return {
    text: (choice?.message?.content ?? '').trim(),
    toolCalls,
    // Assimetria: 'tool_calls' aqui, 'tool_use' na Anthropic — as duas viram 'tool'.
    finishReason: choice?.finish_reason === 'tool_calls' ? 'tool' : 'stop',
    usage: mapUsage(data.usage),
  };
}

// ============== EMBEDDING ==============

/**
 * Fica aqui, não em `errors.ts`: aquele é o que os DOIS adapters lançam, e o
 * Anthropic não serve embeddings. Lançar em vez de devolver vetor curto — um
 * faltando casaria o vetor de um texto com o outro, e a busca mentiria calada.
 */
export class EmbeddingResponseError extends Error {
  override readonly name = 'EmbeddingResponseError';
  constructor(expected: number, received: number) {
    super(`Provider "${PROVIDER_LABEL}" returned an unusable embedding payload: `
      + `expected ${expected} vectors, received ${received} usable`);
  }
}

/** `data` não vem ordenado: é o `index` de cada item que casa o vetor com o input. */
function mapEmbeddings(payload: IWireEmbeddingResponse, expected: number): number[][] {
  const byIndex = new Map<number, number[]>();
  for (const row of payload.data ?? []) {
    if (typeof row.index === 'number' && Array.isArray(row.embedding)) { byIndex.set(row.index, row.embedding); }
  }
  const embeddings: number[][] = [];
  for (let index = 0; index < expected; index++) {
    const vector = byIndex.get(index);
    if (!vector) { throw new EmbeddingResponseError(expected, byIndex.size); }
    embeddings.push(vector);
  }
  return embeddings;
}

// ============== ADAPTER ==============

/** Mesma recusa nas duas portas: status de erro vira `ProviderHttpError`, nunca corpo meio-lido. */
async function assertOk(response: Response): Promise<void> {
  if (response.ok) { return; }
  throw new ProviderHttpError({ provider: PROVIDER_LABEL, status: response.status, body: await response.text() });
}

function resolveEndpoint({ baseUrl, path }: { baseUrl: string | undefined; path: string }): string {
  if (!baseUrl) {
    throw new ConfigError(
      `Provider "${PROVIDER_LABEL}" requires a baseUrl. `
      + 'Set it in the system — the adapter is protocol-only.',
    );
  }
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

export const openaiCompatibleAdapter: IProviderAdapter = {
  async chat(req: IChatRequest): Promise<NResponse> {
    const response = await fetch(resolveEndpoint({ baseUrl: req.baseUrl, path: CHAT_COMPLETIONS_PATH }), {
      method: 'POST',
      headers: buildHeaders(req.apiKey),
      body: JSON.stringify(buildRequestBody(req)),
    });

    await assertOk(response);
    return toNeutralResponse(await response.json() as IWireResponse);
  },

  /**
   * A dimensão NÃO é conferida aqui: 1536 é regra da casa (coluna `vector(1536)`
   * da 021), não do protocolo — quem grava é quem recusa (`embed`). Lista
   * vazia não vira request: gastaria chamada para receber nada.
   */
  async embed(req: IEmbedRequest): Promise<IEmbedResponse> {
    if (req.input.length === 0) { return { embeddings: [], usage: { totalTokens: 0 } }; }

    const response = await fetch(resolveEndpoint({ baseUrl: req.baseUrl, path: EMBEDDINGS_PATH }), {
      method: 'POST',
      headers: buildHeaders(req.apiKey),
      body: JSON.stringify({ model: req.model, input: req.input }),
    });

    await assertOk(response);
    const payload = await response.json() as IWireEmbeddingResponse;
    const tokens = payload.usage?.total_tokens ?? payload.usage?.prompt_tokens ?? 0;
    return { embeddings: mapEmbeddings(payload, req.input.length), usage: { totalTokens: tokens } };
  },
};
