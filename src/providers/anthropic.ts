/**
 * 🌐 anthropic — Adapter da API nativa Anthropic (/v1/messages), por API key
 *
 * A segunda das duas portas de igual estatuto da §8.4, escolhida por
 * `ai_config.provider`. Generaliza o que assistant.f.ts:655-695 já roda em
 * produção. Tudo que este arquivo conhece do fio para aqui — o retorno é
 * `NResponse`, indistinguível do que o adapter irmão devolve.
 */

import type {
  IChatRequest,
  IProviderAdapter,
  NMessage,
  NMessagePart,
  NResponse,
  NToolCall,
  NToolDef,
  NUsage,
} from '../core/types';
import { ProviderHttpError, ProviderParseError } from './errors';
import { ConfigError } from './registry';

// ============== CONSTANTS ==============

const PROVIDER_LABEL = 'anthropic';
/**
 * Caminho, versão e headers são DESTE arquivo de propósito: o adapter tem de ser
 * autossuficiente. O antigo `core/ai/llm.ts`, de onde eles vinham, saiu de cena
 * no #72, ao migrar o assistant para este módulo.
 *
 * 🔴 O que NÃO mora aqui é o ENDEREÇO. Este arquivo já teve um
 * `DEFAULT_BASE_URL = 'https://api.anthropic.com'`, e ele era o último default
 * de provider do motor: um adapter que adivinha o destino é um adapter que
 * escolhe a casa por você. `base_url` vem de `ai_providers` como para qualquer
 * outra porta, e a ausência é recusa — a mesma do adapter irmão.
 */
const MESSAGES_PATH = '/v1/messages';
export const API_VERSION = '2023-06-01';

/**
 * O que este adapter sabe mapear de `IChatRequest.params`. Chave fora da lista é
 * ignorada em silêncio — inclusive o bloco `provider` do OpenRouter, que aqui não
 * tem sentido: a API direta não roteia entre provedores. `reasoning` (nome do
 * gateway) também é ignorado; o nome nativo daqui é `thinking`, e traduzir um
 * formato no outro seria inventar semântica que este adapter não implementa.
 *
 * `tool_choice` NÃO está aqui de propósito — mesmo motivo do adapter irmão: o
 * forçamento é instrução do motor (`IChatRequest.toolChoice`), não config de tela.
 */
export const PASSTHROUGH_PARAMS = [
  'temperature', 'top_p', 'top_k', 'thinking',
] as const satisfies readonly string[];

// ============== WIRE TYPES ==============

interface IWireBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface IWireResponse {
  content?: IWireBlock[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

// ============== HELPERS ==============

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Mesmo recorte do adapter irmão: `text`/`reasoning` no v1, `file` fora (§3.2). */
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
  return {
    'x-api-key': apiKey,
    'anthropic-version': API_VERSION,
    'content-type': 'application/json',
  };
}

function toWireTool(tool: NToolDef): Record<string, unknown> {
  return { name: tool.name, description: tool.description, input_schema: tool.schema };
}

/** `args` já é objeto no contrato e objeto no fio — nada a serializar (a assimetria é do outro lado). */
function toWireToolUse(call: NToolCall): Record<string, unknown> {
  return { type: 'tool_use', id: call.id, name: call.name, input: call.args };
}

function buildAssistantBlocks(
  { content, toolCalls }: { content?: string | NMessagePart[]; toolCalls?: NToolCall[] },
): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];
  const text = flattenContent(content);
  if (text) { blocks.push({ type: 'text', text }); }
  for (const call of toolCalls ?? []) { blocks.push(toWireToolUse(call)); }
  return blocks;
}

/**
 * Assimetria dupla dos tool results: lá cada resultado é uma mensagem
 * `role:'tool'` própria; aqui os resultados CONSECUTIVOS de uma mesma volta
 * viram UMA mensagem `role:'user'` com N blocos `tool_result`. O motor emite uma
 * `NMessage` por tool call (`loop.ts:213`), então o agrupamento tem de acontecer
 * aqui — nenhum consumidor precisa saber desta assimetria.
 *
 * Mensagens `role:'system'` do array não entram: foram absorvidas por
 * `buildSystem`, porque nesta API o system é campo próprio, não mensagem.
 */
function mapMessages(messages: NMessage[]): Array<Record<string, unknown>> {
  const wire: Array<Record<string, unknown>> = [];
  let pendingResults: Array<Record<string, unknown>> = [];

  function flushPendingResults(): void {
    if (pendingResults.length === 0) { return; }
    wire.push({ role: 'user', content: pendingResults });
    pendingResults = [];
  }

  for (const message of messages) {
    if (message.role === 'system') { continue; }
    if (message.role === 'tool') {
      pendingResults.push({
        type: 'tool_result',
        tool_use_id: message.toolCallId,
        content: message.content,
      });
      continue;
    }
    flushPendingResults();
    if (message.role === 'assistant') {
      wire.push({ role: 'assistant', content: buildAssistantBlocks(message) });
      continue;
    }
    wire.push({ role: 'user', content: flattenContent(message.content) });
  }

  flushPendingResults();
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

/** O system é campo próprio aqui; qualquer `NMessage` de system é fundida nele. */
function buildSystem(req: IChatRequest): string {
  const parts: string[] = [];
  if (req.system) { parts.push(req.system); }
  for (const message of req.messages) {
    if (message.role === 'system') { parts.push(flattenContent(message.content)); }
  }
  return parts.join('\n\n');
}

function buildRequestBody(req: IChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens,
    messages: mapMessages(req.messages),
    ...pickParams(req.params),
  };
  const system = buildSystem(req);
  if (system) { body['system'] = system; }
  if (req.tools.length > 0) { body['tools'] = req.tools.map(toWireTool); }
  // Assimetria: nome PLANO sob `type:'tool'`; no OpenAI-compatible vai aninhado em `function`.
  if (req.toolChoice) { body['tool_choice'] = { type: 'tool', name: req.toolChoice }; }
  return body;
}

// ============== RESPONSE ==============

/**
 * `input` já é objeto — nada a desserializar. A checagem existe para o caso
 * hostil (provider devolve escalar/array): o erro é o MESMO do adapter irmão,
 * para que os dois caminhos falhem de forma indistinguível.
 */
function readToolInput(block: IWireBlock): Record<string, unknown> {
  const input = block.input ?? {};
  if (!isPlainObject(input)) {
    throw new ProviderParseError({
      toolName: block.name ?? '<unknown>',
      toolCallId: block.id ?? '<unknown>',
      rawArguments: JSON.stringify(block.input),
    });
  }
  return input;
}

function mapUsage(usage: IWireResponse['usage']): NUsage {
  const promptTokens = usage?.input_tokens ?? 0;
  const completionTokens = usage?.output_tokens ?? 0;
  // Assimetria: esta API não devolve total — o adapter soma para fechar NUsage.
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}

function toNeutralResponse(data: IWireResponse): NResponse {
  const blocks = data.content ?? [];
  const texts: string[] = [];
  const toolCalls: NToolCall[] = [];

  for (const block of blocks) {
    if (block.type === 'text' && block.text) { texts.push(block.text); }
    if (block.type === 'tool_use') {
      toolCalls.push({ id: block.id ?? '', name: block.name ?? '', args: readToolInput(block) });
    }
  }

  return {
    text: texts.join('\n').trim(),
    toolCalls,
    // Assimetria: 'tool_use' aqui, 'tool_calls' no OpenAI-compatible — as duas viram 'tool'.
    finishReason: data.stop_reason === 'tool_use' ? 'tool' : 'stop',
    usage: mapUsage(data.usage),
  };
}

// ============== ADAPTER ==============

/**
 * Sem endereço, RECUSA — nunca assume. Paridade literal com o
 * `openaiCompatible.ts`: os dois são adapters de PROTOCOLO, e um protocolo não
 * sabe em que casa está falando. Adivinhar o destino manda a credencial
 * cadastrada para um host que ninguém escolheu.
 */
function resolveEndpoint(baseUrl: string | undefined): string {
  if (!baseUrl) {
    throw new ConfigError(
      `Provider "${PROVIDER_LABEL}" requires a baseUrl. `
      + 'Set it in the system — the adapter is protocol-only.',
    );
  }
  return `${baseUrl.replace(/\/+$/, '')}${MESSAGES_PATH}`;
}

export const anthropicAdapter: IProviderAdapter = {
  async chat(req: IChatRequest): Promise<NResponse> {
    const response = await fetch(resolveEndpoint(req.baseUrl), {
      method: 'POST',
      headers: buildHeaders(req.apiKey),
      body: JSON.stringify(buildRequestBody(req)),
    });

    if (!response.ok) {
      throw new ProviderHttpError({
        provider: PROVIDER_LABEL,
        status: response.status,
        body: await response.text(),
      });
    }
    return toNeutralResponse(await response.json() as IWireResponse);
  },
};
