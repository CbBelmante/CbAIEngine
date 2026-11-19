/**
 * 🧪 A bateria de conformidade do `IAiDbAdapter`
 *
 * ⛔ É O QUE FAZ O MOLDE VALER. Uma interface só promete; quem prova é um
 * conjunto único de casos rodando contra TODA implementação. Sem isto, cada
 * adapter novo é uma promessa — e a primeira divergência aparece em produção,
 * num banco que ninguém testou.
 *
 * Três defeitos são travados aqui.
 *
 * O primeiro: a cascata de config resolvendo errado. Tenant → global → agente
 * `default`: inverter a ordem faz um tenant herdar a config de outro, ou o
 * global sobrepor o override que alguém cadastrou de propósito.
 *
 * O segundo: preço ausente virando zero. «Sem preço cadastrado» e «de graça»
 * são coisas diferentes, e confundi-las é como uma conta grande passa
 * despercebida.
 *
 * O terceiro: o provedor desligado sumindo da lista de todos. Desligado e
 * inexistente são duas falhas com consertos diferentes, e `listAllProviders`
 * é o que as separa.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { createMemoryAdapter } from '../src/dbAdapter/memoryAdapter';

import type { IAiDbAdapter } from '../src/dbAdapter/dbAdapter';

// ============== O CONTRATO ==============

/**
 * O cenário que todo adapter precisa saber montar para ser medido.
 *
 * ⚠️ O SEED É DO ADAPTER, e não da bateria: cada backend grava do jeito dele —
 * um por SQL, outro por memória. O que a bateria cobra é o que se LÊ depois.
 */
export interface IAdapterUnderTest {
  name: string;
  make(): Promise<{
    adapter: IAiDbAdapter;
    seed(data: {
      providers?: { slug: string; name: string; baseUrl: string | null; protocol: string; enabled: boolean }[];
      configs?: { agent: string; tenantId: string | null; provider: string; model: string }[];
      credentials?: { provider: string; tenantId: string | null; apiKey: string }[];
      pricing?: { provider: string; model: string; inputPer1k: number; outputPer1k: number }[];
    }): Promise<void>;
    done?(): Promise<void>;
  }>;
}

const ANTHROPIC = {
  slug: 'anthropic',
  name: 'Anthropic',
  baseUrl: 'https://api.anthropic.com',
  protocol: 'anthropic',
  enabled: true,
};

const OFF = {
  slug: 'desligado',
  name: 'Provedor desligado',
  baseUrl: 'https://exemplo.test',
  protocol: 'openai-compatible',
  enabled: false,
};

const TENANT = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

// ============== A BATERIA ==============

export function runAdapterConformance(target: IAdapterUnderTest): void {
  describe(`conformidade do IAiDbAdapter — ${target.name}`, () => {
    let adapter: IAiDbAdapter;
    let seed: Awaited<ReturnType<IAdapterUnderTest['make']>>['seed'];
    let done: (() => Promise<void>) | undefined;

    beforeEach(async () => {
      const made = await target.make();

      adapter = made.adapter;
      seed = made.seed;
      done = made.done;
    });

    // ===== CONFIG =====

    it('sem config cadastrada, devolve nulo — nunca um modelo presumido', async () => {
      expect(await adapter.getConfig('assistant', TENANT)).toBeNull();
      await done?.();
    });

    it('o global do agente vale quando não há override do tenant', async () => {
      await seed({
        providers: [ANTHROPIC],
        configs: [{ agent: 'assistant', tenantId: null, provider: 'anthropic', model: 'global' }],
      });

      expect((await adapter.getConfig('assistant', TENANT))?.model).toBe('global');
      await done?.();
    });

    /** ⛔ O OVERRIDE DO TENANT PRECEDE o global: é para isso que ele existe. */
    it('o override do tenant precede o global', async () => {
      await seed({
        providers: [ANTHROPIC],
        configs: [
          { agent: 'assistant', tenantId: null, provider: 'anthropic', model: 'global' },
          { agent: 'assistant', tenantId: TENANT, provider: 'anthropic', model: 'do-tenant' },
        ],
      });

      expect((await adapter.getConfig('assistant', TENANT))?.model).toBe('do-tenant');
      await done?.();
    });

    /** ⛔ E NÃO ATRAVESSA: o override de um tenant não serve ao outro. */
    it('o override de um tenant não vale para outro', async () => {
      await seed({
        providers: [ANTHROPIC],
        configs: [
          { agent: 'assistant', tenantId: null, provider: 'anthropic', model: 'global' },
          { agent: 'assistant', tenantId: TENANT, provider: 'anthropic', model: 'do-tenant' },
        ],
      });

      expect((await adapter.getConfig('assistant', OTHER))?.model).toBe('global');
      await done?.();
    });

    it('sem o agente pedido, cai no agente `default`', async () => {
      await seed({
        providers: [ANTHROPIC],
        configs: [{ agent: 'default', tenantId: null, provider: 'anthropic', model: 'do-default' }],
      });

      expect((await adapter.getConfig('inexistente', TENANT))?.model).toBe('do-default');
      await done?.();
    });

    // ===== CREDENCIAL =====

    it('sem credencial, devolve nulo', async () => {
      await seed({ providers: [ANTHROPIC] });

      expect(await adapter.getCredential('anthropic', TENANT)).toBeNull();
      await done?.();
    });

    it('a credencial do tenant precede a global', async () => {
      await seed({
        providers: [ANTHROPIC],
        credentials: [
          { provider: 'anthropic', tenantId: null, apiKey: 'chave-global' },
          { provider: 'anthropic', tenantId: TENANT, apiKey: 'chave-do-tenant' },
        ],
      });

      expect((await adapter.getCredential('anthropic', TENANT))?.apiKey).toBe('chave-do-tenant');
      expect((await adapter.getCredential('anthropic', OTHER))?.apiKey).toBe('chave-global');
      await done?.();
    });

    // ===== PROVIDERS =====

    /**
     * ⛔ DESLIGADO NÃO É INEXISTENTE. `listProviders` traz os em uso;
     * `listAllProviders` traz todos, e é essa diferença que deixa o catálogo
     * dizer «alguém desligou» em vez de «nunca existiu».
     */
    it('a lista em uso esconde o desligado, e a lista de todos o mostra', async () => {
      await seed({ providers: [ANTHROPIC, OFF] });

      expect((await adapter.listProviders()).map((row) => row.slug)).toEqual(['anthropic']);
      expect((await adapter.listAllProviders()).map((row) => row.slug).sort())
        .toEqual(['anthropic', 'desligado']);
      await done?.();
    });

    it('o provedor se busca pelo slug, com o endereço dele', async () => {
      await seed({ providers: [ANTHROPIC] });

      expect(await adapter.getProvider('anthropic'))
        .toMatchObject({ slug: 'anthropic', baseUrl: 'https://api.anthropic.com', enabled: true });
      expect(await adapter.getProvider('nao-existe')).toBeNull();
      await done?.();
    });

    // ===== PRICING =====

    /** ⛔ SEM PREÇO É NULO, e jamais zero: zero diria que a chamada foi de graça. */
    it('preço não cadastrado devolve nulo', async () => {
      await seed({ providers: [ANTHROPIC] });

      expect(await adapter.getModelPricing('anthropic', 'sem-preco')).toBeNull();
      await done?.();
    });

    it('o preço cadastrado volta com as duas pontas', async () => {
      await seed({
        providers: [ANTHROPIC],
        pricing: [{ provider: 'anthropic', model: 'm', inputPer1k: 0.003, outputPer1k: 0.015 }],
      });

      expect(await adapter.getModelPricing('anthropic', 'm'))
        .toMatchObject({ inputPer1k: 0.003, outputPer1k: 0.015 });
      await done?.();
    });

    // ===== OBSERVABILIDADE =====

    it('o run abre, fecha e aceita invocação e passo', async () => {
      const runId = await adapter.openRun({
        id: '33333333-3333-3333-3333-333333333333',
        agent: 'assistant',
        tenantId: TENANT,
        trigger: 'user',
        status: 'running',
      });

      expect(runId).not.toBe('');

      await adapter.recordInvocation({
        runId,
        provider: 'anthropic',
        model: 'm',
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        costUsd: null,
        latencyMs: 120,
        toolCalls: 0,
      });

      await adapter.recordStep({
        runId,
        seq: 1,
        stepType: 'model_call',
        payload: { foo: 'bar' },
        durationMs: 10,
      });

      await adapter.closeRun(runId, 'ok', null);
      await done?.();
    });

    // ===== QUOTA =====

    /** ⚠️ SEM TETO não é «sem resposta»: o consumo existe, e o limite é que não. */
    it('sem limite cadastrado, o consumo volta sem teto', async () => {
      const status = await adapter.getConsumptionStatus(TENANT);

      expect(status === null || status.hasLimit === false).toBe(true);
      await done?.();
    });
  });
}

// ============== O ADAPTER DE MEMÓRIA ==============

runAdapterConformance({
  name: 'memória',
  async make() {
    const adapter = createMemoryAdapter();

    return {
      adapter,
      async seed(data) {
        for (const provider of data.providers ?? []) {
          adapter.state.providers.set(provider.slug, {
            slug: provider.slug,
            name: provider.name,
            baseUrl: provider.baseUrl,
            protocol: provider.protocol as 'anthropic' | 'openai-compatible',
            enabled: provider.enabled,
          });
        }

        for (const config of data.configs ?? []) {
          adapter.state.configs.push({
            agent: config.agent,
            tenantId: config.tenantId,
            provider: config.provider,
            model: config.model,
            params: {},
            enabled: true,
          });
        }

        for (const credential of data.credentials ?? []) {
          adapter.state.credentials.push({
            apiKey: credential.apiKey,
            provider: credential.provider,
            tenantId: credential.tenantId,
          });
        }

        for (const price of data.pricing ?? []) {
          adapter.state.pricing.set(`${price.provider}:${price.model}`, {
            provider: price.provider,
            model: price.model,
            inputPer1k: price.inputPer1k,
            outputPer1k: price.outputPer1k,
            currency: 'USD',
          });
        }
      },
    };
  },
});
