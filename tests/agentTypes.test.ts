import { describe, it, expect } from 'vitest';
/**
 * Testes — agent/types.ts contract verification
 *
 * Validates structural invariants of the agent type contract:
 * discriminated unions, neutral types, interface shapes.
 */

import { expect, expect } from 'vitest';

import type {
  ITextPart,
  IReasoningPart,
  IFilePart,
  NMessagePart,
  NMessage,
  NToolCall,
  NUsage,
  NResponse,
  IToolDef,
  IToolOutput,
  IProviderAdapter,
  IProvider,
  IChatRequest,
  IEmbedResponse,
  ICheckResult,
  IMiddleware,
  IAgentHooks,
  IPromptTemplate,
  IAgentConfig,
  IAgentPreset,
  IRunUsage,
  IAgentResult,
  IModelPricing,
} from '../src/core/types';

// ============== MESSAGE PARTS ==============

it('ITextPart - discriminated by type "text"', () => {
  const part: ITextPart = { type: 'text', text: 'hello' };
  expect(part.type).toBe('text');
  expect(part.text).toBe('hello');
});

it('IReasoningPart - discriminated by type "reasoning"', () => {
  const part: IReasoningPart = { type: 'reasoning', text: 'chain of thought' };
  expect(part.type).toBe('reasoning');
  expect(part.text).toBe('chain of thought');
});

it('IFilePart - discriminated by type "file"', () => {
  const part: IFilePart = { type: 'file', mimeType: 'image/png', url: 'https://example.com/img.png' };
  expect(part.type).toBe('file');
  expect(part.mimeType).toBe('image/png');
  expect(part.name).toBeUndefined();
});

it('IFilePart - optional name field', () => {
  const part: IFilePart = { type: 'file', mimeType: 'application/pdf', url: '/doc.pdf', name: 'report.pdf' };
  expect(part.name).toBe('report.pdf');
});

it('NMessagePart - exhaustive switch on discriminator', () => {
  const parts: NMessagePart[] = [
    { type: 'text', text: 'hi' },
    { type: 'reasoning', text: 'thinking...' },
    { type: 'file', mimeType: 'image/jpeg', url: '/photo.jpg' },
  ];

  const types: string[] = [];
  for (const part of parts) {
    switch (part.type) {
      case 'text': types.push('text'); break;
      case 'reasoning': types.push('reasoning'); break;
      case 'file': types.push('file'); break;
    }
  }
  expect(types).toEqual(['text', 'reasoning', 'file']);
});

// ============== NEUTRAL TYPES ==============

it('NMessage - system role accepts string content', () => {
  const msg: NMessage = { role: 'system', content: 'You are helpful.' };
  expect(msg.role).toBe('system');
  expect(msg.content).toBe('You are helpful.');
});

it('NMessage - user role accepts parts array', () => {
  const msg: NMessage = { role: 'user', content: [{ type: 'text', text: 'hello' }] };
  expect(msg.role).toBe('user');
  expect(Array.isArray(msg.content)).toBe(true);
});

it('NMessage - assistant role with toolCalls', () => {
  const msg: NMessage = {
    role: 'assistant',
    toolCalls: [{ id: 'tc_1', name: 'search', args: { query: 'test' } }],
  };
  expect(msg.role).toBe('assistant');
  expect(msg.toolCalls?.length, 1);
});

it('NMessage - assistant role without content (valid)', () => {
  const msg: NMessage = {
    role: 'assistant',
    toolCalls: [{ id: 'tc_1', name: 'lookup', args: {} }],
  };
  expect(msg.content).toBeUndefined();
});

it('NMessage - tool role with correlation id', () => {
  const msg: NMessage = { role: 'tool', toolCallId: 'tc_1', content: '{"result": 42}' };
  expect(msg.role).toBe('tool');
  expect(msg.toolCallId, 'tc_1');
});

it('NToolCall - args is always object, never string', () => {
  const tc: NToolCall = { id: 'tc_1', name: 'search', args: { query: 'test', limit: 10 } };
  expect(typeof tc.args).toBe('object');
  expect(tc.args.query).toBe('test');
});

it('NUsage - all three token counts present', () => {
  const usage: NUsage = { promptTokens: 100, completionTokens: 50, totalTokens: 150 };
  expect(usage.promptTokens + usage.completionTokens, usage.totalTokens);
});

it('NResponse - finishReason restricted to stop|tool', () => {
  const stopRes: NResponse = {
    text: 'Done.',
    toolCalls: [],
    finishReason: 'stop',
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  };
  expect(stopRes.finishReason).toBe('stop');

  const toolRes: NResponse = {
    text: '',
    toolCalls: [{ id: 'tc_1', name: 'search', args: {} }],
    finishReason: 'tool',
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  };
  expect(toolRes.finishReason).toBe('tool');
});

it('NResponse - no provider-specific fields leak', () => {
  const res: NResponse = {
    text: 'hello',
    toolCalls: [],
    finishReason: 'stop',
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  };
  const keys = Object.keys(res).sort();
  expect(keys).toEqual(['finishReason', 'text', 'toolCalls', 'usage']);
});

// ============== TOOLS ==============

it('IToolDef - category restricted to read|suggest|execute', () => {
  const categories: IToolDef['category'][] = ['read', 'suggest', 'execute'];
  expect(categories.length).toBe(3);
});

it('IToolOutput - isError defaults to undefined', () => {
  const output: IToolOutput = { content: 'success' };
  expect(output.isError).toBeUndefined();
});

it('IToolOutput - isError can be true', () => {
  const output: IToolOutput = { content: 'failed', isError: true };
  expect(output.isError).toBe(true);
});

// ============== PROVIDER & CHAT ==============

it('IChatRequest - carries resolved apiKey, not env reference', () => {
  const req: IChatRequest = {
    model: 'gpt-4o',
    system: 'You are helpful.',
    messages: [],
    tools: [],
    maxTokens: 1500,
    apiKey: 'sk-resolved-key',
  };
  expect(req.apiKey);
  expect(typeof req.apiKey).toBe('string');
});

it('IProvider - envKey is a variable name, not a secret', () => {
  const provider: IProvider = {
    id: 'ai-gateway',
    name: 'AI Gateway',
    adapter: { chat: () => Promise.reject('not implemented') } as unknown as IProviderAdapter,
    baseUrl: 'https://gateway.example.com',
    envKey: 'AI_GATEWAY_API_KEY',
  };
  expect(provider.envKey).toBe('AI_GATEWAY_API_KEY');
  expect(provider.id).toBe('ai-gateway');
});

it('IEmbedResponse - embeddings are number arrays', () => {
  const res: IEmbedResponse = {
    embeddings: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
    usage: { totalTokens: 20 },
  };
  expect(res.embeddings.length).toBe(2);
  expect(res.embeddings[0].length).toBe(3);
});

// ============== MIDDLEWARE ==============

it('IMiddleware - phase restricted to three values', () => {
  const phases: IMiddleware['phase'][] = ['pre-context', 'pre-model', 'post-model'];
  expect(phases.length).toBe(3);
});

it('ICheckResult - ok:true means pass', () => {
  const pass: ICheckResult = { ok: true };
  expect(pass.ok).toBe(true);
  expect(pass.message).toBeUndefined();
});

it('ICheckResult - ok:false carries message', () => {
  const fail: ICheckResult = { ok: false, message: 'PII detected' };
  expect(fail.ok).toBe(false);
  expect(fail.message).toBe('PII detected');
});

// ============== HOOKS ==============

it('IAgentHooks - all callbacks are optional', () => {
  const hooks: IAgentHooks = {};
  expect(Object.keys(hooks).length).toBe(0);
});

it('IAgentHooks - individual hook can be set', () => {
  let called = false;
  const hooks: IAgentHooks = {
    onRunStart: () => { called = true; },
  };
  hooks.onRunStart?.('run_1', {} as IAgentConfig);
  expect(called).toBe(true);
});

// ============== PROMPT ==============

it('IPromptTemplate - base + conditional sections', () => {
  const template: IPromptTemplate = {
    base: 'You are an assistant.',
    sections: [
      { key: 'identity', builder: () => 'I am CbAIEngine.' },
      { key: 'company', builder: (ctx) => `Company: ${ctx.agent}`, when: (ctx) => ctx.agent === 'engine-cs' },
    ],
  };
  expect(template.sections.length).toBe(2);
  expect(template.sections[0].builder({ agent: 'engine-cs', userId: 'u1' }))
    .toBe('I am CbAIEngine.');
  expect(template.sections[1].when?.({ agent: 'engine-cs', userId: 'u1' })).toBe(true);
  expect(template.sections[1].when?.({ agent: 'other', userId: 'u1' })).toBe(false);
});

// ============== CONFIG & RESULT ==============

it('IAgentConfig - model string follows provider:model format', () => {
  const config: IAgentConfig = {
    model: 'ai-gateway:qwen3.5-27b',
    systemPrompt: 'You are helpful.',
  };
  const [provider, model] = config.model.split(':');
  expect(provider).toBe('ai-gateway');
  expect(model).toBe('qwen3.5-27b');
});

it('IAgentConfig - systemPrompt accepts string or template', () => {
  const simple: IAgentConfig = { model: 'anthropic:claude-haiku-4-5-20251001', systemPrompt: 'Be helpful.' };
  expect(typeof simple.systemPrompt).toBe('string');

  const templated: IAgentConfig = {
    model: 'anthropic:claude-haiku-4-5-20251001',
    systemPrompt: { base: 'Be helpful.', sections: [] },
  };
  expect(typeof templated.systemPrompt).toBe('object');
});

/**
 * A ausência de modelo é o ponto do teste, não um detalhe dele: este literal
 * NÃO declara modelo nenhum e ainda assim satisfaz `IAgentPreset`. Se alguém
 * reintroduzir um campo de modelo obrigatório, é aqui que `deno check` fica
 * vermelho — a vedação mora no compilador, e a asserção abaixo só a torna
 * legível para quem lê o teste.
 */
it('IAgentPreset - behaviour only: satisfied with NO model field at all', () => {
  const preset: IAgentPreset = {
    name: 'engine-cs',
    description: 'Assistente de atendimento do CbAIEngine',
    systemPrompt: 'You are the CbAIEngine assistant.',
    defaults: { maxTokens: 1500 },
  };
  expect(preset.name).toBe('engine-cs');
  expect('defaultModel' in preset).toBe(false);
  expect(preset.defaults?.maxTokens).toBe(1500);
});

it('IRunUsage - extends NUsage with provider metadata', () => {
  const usage: IRunUsage = {
    promptTokens: 500,
    completionTokens: 200,
    totalTokens: 700,
    provider: 'ai-gateway',
    model: 'qwen3.5-27b',
    costUsd: 0.0035,
    latencyMs: 1200,
    invocations: 2,
  };
  expect(usage.provider).toBe('ai-gateway');
  expect(usage.invocations).toBe(2);
  expect(usage.costUsd).toBe(0.0035);
});

it('IAgentResult - metadata is open-ended, no domain leakage', () => {
  const result: IAgentResult = {
    text: 'Done.',
    toolCalls: [],
    usage: {
      promptTokens: 10, completionTokens: 5, totalTokens: 15,
      provider: 'ai-gateway', model: 'test', costUsd: null, latencyMs: 100, invocations: 1,
    },
    metadata: { contextUpdates: [], suggestions: [] },
  };
  expect(result.metadata);
  expect(result.structured).toBeUndefined();
});

it('IModelPricing - cost calculation follows documented formula', () => {
  const pricing: IModelPricing = {
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    inputPer1k: 0.001,
    outputPer1k: 0.005,
  };
  const prompt = 500;
  const completion = 200;
  const cost = (prompt / 1000) * pricing.inputPer1k + (completion / 1000) * pricing.outputPer1k;
  expect(cost).toBe(0.0015);
});

// ============== CONTRAPROVA — union exaustiva ==============

it('NMessagePart union - switch exhausts all variants', () => {
  const assertExhaustive = (_: never): never => {
    throw new Error('Non-exhaustive switch');
  };

  const checkExhaustion = (part: NMessagePart): string => {
    switch (part.type) {
      case 'text': return 'text';
      case 'reasoning': return 'reasoning';
      case 'file': return 'file';
      default: return assertExhaustive(part);
    }
  };

  expect(checkExhaustion({ type: 'text', text: 'a' })).toBe('text');
  expect(checkExhaustion({ type: 'reasoning', text: 'b' })).toBe('reasoning');
  expect(checkExhaustion({ type: 'file', mimeType: 'x/y', url: '/z' })).toBe('file');
});
