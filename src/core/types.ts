/**
 * 🔧 Agent types — provider-agnostic contract for the AI agent module.
 *
 * Every downstream file (loop, providers, middleware, hooks, presets)
 * imports from here. No implementation — only shapes.
 */

// ============== MESSAGE PARTS (discriminated union) ==============

export interface ITextPart {
  type: 'text';
  text: string;
}

export interface IReasoningPart {
  type: 'reasoning';
  text: string;
}

export interface IFilePart {
  type: 'file';
  mimeType: string;
  url: string;
  name?: string;
}

export type NMessagePart = ITextPart | IReasoningPart | IFilePart;

// ============== NEUTRAL PROTOCOL TYPES ==============

export type NMessage =
  | { role: 'system' | 'user'; content: string | NMessagePart[] }
  | { role: 'assistant'; content?: string | NMessagePart[]; toolCalls?: NToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export type NToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type NToolDef = Pick<IToolDef, 'name' | 'description' | 'schema'>;

export type NUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type NResponse = {
  text: string;
  toolCalls: NToolCall[];
  finishReason: 'stop' | 'tool';
  usage: NUsage;
};

// ============== TOOLS ==============

export interface IToolContext {
  db: unknown;
  userId: string;
  [key: string]: unknown;
}

export interface IToolOutput {
  content: string;
  isError?: boolean;
}

export interface IToolDef {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  category: 'read' | 'suggest' | 'execute';
  scope?: string[];
  requiresConfirmation?: boolean;
  allowedWhen?(ctx: IToolContext): boolean;
  onNotAllowed?: string | ((ctx: IToolContext) => string);
  handler(input: Record<string, unknown>, ctx: IToolContext): Promise<IToolOutput>;
}

// ============== PROVIDER & CHAT ==============

export interface IEmbedRequest {
  model: string;
  input: string[];
  apiKey: string;
  baseUrl?: string;
}

export interface IEmbedResponse {
  embeddings: number[][];
  usage: { totalTokens: number };
}

export interface IProviderAdapter {
  chat(req: IChatRequest): Promise<NResponse>;
  embed?(req: IEmbedRequest): Promise<IEmbedResponse>;
}

export interface IProvider {
  id: string;
  name: string;
  adapter: IProviderAdapter;
  baseUrl?: string;
  envKey: string;
}

export interface IChatRequest {
  model: string;
  system: string;
  messages: NMessage[];
  tools: NToolDef[];
  maxTokens: number;
  baseUrl?: string;
  apiKey: string;
  /**
   * Nome da tool que o modelo é OBRIGADO a chamar. O motor preenche quando há
   * `outputSchema`; cada adapter traduz para o `tool_choice` do seu provider —
   * os formatos divergem, e a assimetria morre lá. Campo próprio em vez de uma
   * convenção dentro de `params`: `params` vem da config (banco) e é do modelo;
   * isto é instrução do motor, e misturar as duas deixaria a tela sobrescrever
   * o forçamento sem ninguém perceber.
   */
  toolChoice?: string;
  /** Params do provider (temperature, reasoning, etc.). O motor carrega opacamente; o adapter interpreta e valida. */
  params?: Record<string, unknown>;
}

// ============== MIDDLEWARE ==============

export interface ICheckResult {
  ok: boolean;
  message?: string;
}

export interface IMiddlewareContext {
  userId: string;
  agent: string;
}

export interface IMiddleware {
  name: string;
  phase: 'pre-context' | 'pre-model' | 'post-model';
  transform?(messages: NMessage[]): NMessage[] | Promise<NMessage[]>;
  check?(response: NResponse, ctx: IMiddlewareContext): ICheckResult | Promise<ICheckResult>;
  exitBehavior?: 'end' | 'continue';
  config?: Record<string, unknown>;
}

// ============== HOOKS ==============

export interface IAgentHooks {
  onRunStart?(runId: string, config: IAgentConfig): void | Promise<void>;
  onRunEnd?(runId: string, result: IAgentResult): void | Promise<void>;
  onModelCall?(req: IChatRequest): void | Promise<void>;
  onModelResponse?(res: NResponse): void | Promise<void>;
  onToolCall?(tool: string, args: Record<string, unknown>): void | Promise<void>;
  onToolResult?(tool: string, result: IToolOutput): void | Promise<void>;
  onMiddleware?(name: string, phase: string, outcome: 'pass' | 'block' | 'transform'): void | Promise<void>;
  onError?(err: unknown, phase: 'model' | 'tool' | 'middleware'): void | Promise<void>;
}

// ============== PROMPT ==============

export interface IPromptContext {
  agent: string;
  userId: string;
  [key: string]: unknown;
}

export interface IPromptSection {
  key: string;
  builder(ctx: IPromptContext): string | Promise<string>;
  when?(ctx: IPromptContext): boolean;
}

export interface IPromptTemplate {
  base: string;
  sections: IPromptSection[];
}

// ============== CONFIG & RESULT ==============

export interface IAgentConfig {
  model: string;
  tools?: IToolDef[];
  systemPrompt: string | IPromptTemplate;
  middleware?: IMiddleware[];
  hooks?: IAgentHooks;
  outputSchema?: Record<string, unknown>;
  maxToolLoops?: number;
  maxTokens?: number;
  /** Params do provider (temperature, reasoning, etc.). O motor carrega opacamente; o adapter interpreta e valida. */
  params?: Record<string, unknown>;
}

/**
 * Preset é COMPORTAMENTO — prompt, tools, middleware, tetos —, nunca a escolha
 * de modelo. Não há campo de modelo default aqui, e a ausência é a regra: quem
 * escolhe modelo é `ai_config` (empresa → global → agente `default`), e
 * `createAgent` recusa na entrada quando ela não vem.
 * Um default no preset devolveria a decisão ao código, gastaria chave num
 * modelo que ninguém escolheu e mascararia config faltante — e ainda prenderia
 * o preset a um provider, matando o plug-and-play que ele existe para servir.
 */
export interface IAgentPreset extends Omit<IAgentConfig, 'model'> {
  name: string;
  description: string;
  defaults?: Partial<Pick<IAgentConfig, 'maxTokens' | 'maxToolLoops'>>;
}

export interface IRunUsage extends NUsage {
  provider: string;
  model: string;
  costUsd: number | null;
  latencyMs: number;
  invocations: number;
}

export interface IAgentResult {
  text: string;
  toolCalls: NToolCall[];
  structured?: unknown;
  usage: IRunUsage;
  metadata?: Record<string, unknown>;
}

export interface IModelPricing {
  provider: string;
  model: string;
  inputPer1k: number;
  outputPer1k: number;
}

