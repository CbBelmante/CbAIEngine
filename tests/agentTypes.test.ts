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
  expect(part.type, 'text');
  expect(part.text, 'hello');
});

it('IReasoningPart - discriminated by type "reasoning"', () => {
  const part: IReasoningPart = { type: 'reasoning', text: 'chain of thought' };
  expect(part.type, 'reasoning');
  expect(part.text, 'chain of thought');
});

it('IFilePart - discriminated by type "file"', () => {
  const part: IFilePart = { type: 'file', mimeType: 'image/png', url: 'https://example.com/img.png' };
  expect(part.type, 'file');
  expect(part.mimeType, 'image/png');
  expect(part.name, undefined);
});

it('IFilePart - optional name field', () => {
  const part: IFilePart = { type: 'file', mimeType: 'application/pdf', url: '/doc.pdf', name: 'report.pdf' };
  expect(part.name, 'report.pdf');
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
  expect(types, ['text', 'reasoning', 'file']);
});

// ============== NEUTRAL TYPES ==============

it('NMessage - system role accepts string content', () => {
  const msg: NMessage = { role: 'system', content: 'You are helpful.' };
  expect(msg.role, 'system');
  expect(msg.content, 'You are helpful.');
});

it('NMessage - user role accepts parts array', () => {
  const msg: NMessage = { role: 'user', content: [{ type: 'text', text: 'hello' }] };
  expect(msg.role, 'user');
  expect(Array.isArray(msg.content), true);
});

it('NMessage - assistant role with toolCalls', () => {
  const msg: NMessage = {
    role: 'assistant',
    toolCalls: [{ id: 'tc_1', name: 'search', args: { query: 'test' } }],
  };
  expect(msg.role, 'assistant');
  expect(msg.toolCalls?.length, 1);
});

it('NMessage - assistant role without content (valid)', () => {
  const msg: NMessage = {
    role: 'assistant',
    toolCalls: [{ id: 'tc_1', name: 'lookup', args: {} }],
  };
  expect(msg.content, undefined);
});

it('NMessage - tool role with correlation id', () => {
  const msg: NMessage = { role: 'tool', toolCallId: 'tc_1', content: '{"result": 42}' };
  expect(msg.role, 'tool');
  expect(msg.toolCallId, 'tc_1');
});

it('NToolCall - args is always object, never string', () => {
  const tc: NToolCall = { id: 'tc_1', name: 'search', args: { query: 'test', limit: 10 } };
  expect(typeof tc.args, 'object');
  expect(tc.args.query, 'test');
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
  expect(stopRes.finishReason, 'stop');

  const toolRes: NResponse = {
    text: '',
    toolCalls: [{ id: 'tc_1', name: 'search', args: {} }],
    finishReason: 'tool',
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  };
  expect(toolRes.finishReason, 'tool');
});

it('NResponse - no provider-specific fields leak', () => {
  const res: NResponse = {
    text: 'hello',
    toolCalls: [],
    finishReason: 'stop',
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  };
  const keys = Object.keys(res).sort();
  expect(keys, ['finishReason', 'text', 'toolCalls', 'usage']);
});

// ============== TOOLS ==============

it('IToolDef - category restricted to read|suggest|execute', () => {
  const categories: IToolDef['category'][] = ['read', 'suggest', 'execute'];
  expect(categories.length, 3);
});

it('IToolOutput - isError defaults to undefined', () => {
  const output: IToolOutput = { content: 'success' };
  expect(output.isError, undefined);
});

it('IToolOutput - isError can be true', () => {
  const output: IToolOutput = { content: 'failed', isError: true };
  expect(output.isError, true);
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
  expect(typeof req.apiKey, 'string');
});

it('IProvider - envKey is a variable name, not a secret', () => {
  const provider: IProvider = {
    id: 'ai-gateway',
    name: 'AI Gateway',
    adapter: { chat: () => Promise.reject('not implemented') } as unknown as IProviderAdapter,
    baseUrl: 'https://gateway.example.com',
    envKey: 'AI_GATEWAY_API_KEY',
  };
  expect(provider.envKey, 'AI_GATEWAY_API_KEY');
  expect(provider.id, 'ai-gateway');
});

it('IEmbedResponse - embeddings are number arrays', () => {
  const res: IEmbedResponse = {
    embeddings: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
    usage: { totalTokens: 20 },
  };
  expect(res.embeddings.length, 2);
  expect(res.embeddings[0].length, 3);
});

// ============== MIDDLEWARE ==============

it('IMiddleware - phase restricted to three values', () => {
  const phases: IMiddleware['phase'][] = ['pre-context', 'pre-model', 'post-model'];
  expect(phases.length, 3);
});

it('ICheckResult - ok:true means pass', () => {
  const pass: ICheckResult = { ok: true };
  expect(pass.ok, true);
  expect(pass.message, undefined);
});

it('ICheckResult - ok:false carries message', () => {
  const fail: ICheckResult = { ok: false, message: 'PII detected' };
  expect(fail.ok, false);
  expect(fail.message, 'PII detected');
});

// ============== HOOKS ==============

it('IAgentHooks - all callbacks are optional', () => {
  const hooks: IAgentHooks = {};
  expect(Object.keys(hooks).length, 0);
});

it('IAgentHooks - individual hook can be set', () => {
  let called = false;
  const hooks: IAgentHooks = {
    onRunStart: () => { called = true; },
  };
  hooks.onRunStart?.('run_1', {} as IAgentConfig);
  expect(called, true);
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
  expect(template.sections.length, 2);
  expect(template.sections[0].builder({ agent: 'engine-cs', userId: 'u1' }), 'I am CbAIEngine.');
  expect(template.sections[1].when?.({ agent: 'engine-cs', userId: 'u1' }), true);
  expect(template.sections[1].when?.({ agent: 'other', userId: 'u1' }), false);
});

// ============== CONFIG & RESULT ==============

it('IAgentConfig - model string follows provider:model format', () => {
  const config: IAgentConfig = {
    model: 'ai-gateway:qwen3.5-27b',
    systemPrompt: 'You are helpful.',
  };
  const [provider, model] = config.model.split(':');
  expect(provider, 'ai-gateway');
  expect(model, 'qwen3.5-27b');
});

it('IAgentConfig - systemPrompt accepts string or template', () => {
  const simple: IAgentConfig = { model: 'anthropic:claude-haiku-4-5-20251001', systemPrompt: 'Be helpful.' };
  expect(typeof simple.systemPrompt, 'string');

  const templated: IAgentConfig = {
    model: 'anthropic:claude-haiku-4-5-20251001',
    systemPrompt: { base: 'Be helpful.', sections: [] },
  };
  expect(typeof templated.systemPrompt, 'object');
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
    description: 'Assistente CS do Volan CbAIEngine',
    systemPrompt: 'You are the CbAIEngine assistant.',
    defaults: { maxTokens: 1500 },
  };
  expect(preset.name, 'engine-cs');
  expect('defaultModel' in preset, false);
  expect(preset.defaults?.maxTokens, 1500);
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
  expect(usage.provider, 'ai-gateway');
  expect(usage.invocations, 2);
  expect(usage.costUsd, 0.0035);
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
  expect(result.structured, undefined);
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
  expect(cost, 0.0015);
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

  expect(checkExhaustion({ type: 'text', text: 'a' }), 'text');
  expect(checkExhaustion({ type: 'reasoning', text: 'b' }), 'reasoning');
  expect(checkExhaustion({ type: 'file', mimeType: 'x/y', url: '/z' }), 'file');
});
