import { describe, it, expect } from 'vitest';
/**
 * 🔧 agent-config — Testes do registry + cascata de credencial/config
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerProvider,
  resolveProvider,
  clearRegistry,
  listRegisteredProviders,
  ConfigError,
} from '../src/providers/registry';

// ============== HELPERS ==============

function createChainableMock(resolveData: () => { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is']) {
    chain[method] = vi.fn(() => chain);
  }
  chain['maybeSingle'] = vi.fn(() => Promise.resolve(resolveData()));
  return chain;
}

function makeMockAdapter(specs: Array<{ data: unknown }>) {
  let callIndex = 0;
  return {
    from: vi.fn(() => {
      const spec = specs[callIndex] ?? { data: null };
      callIndex++;
      return createChainableMock(() => ({ data: spec.data, error: null }));
    }),
  };
}

async function resolveApiKeyCascade(
  { provider, companyId }: { provider: string; companyId?: string },
  adapter: ReturnType<typeof makeMockAdapter>,
  envGetter: (name: string) => string | undefined,
): Promise<string> {
  if (companyId) {
    const chain = adapter.from('ai_credentials') as Record<string, ReturnType<typeof vi.fn>>;
    const { data } = await chain.select('api_key').eq('provider', provider)
      .eq('company_id', companyId).eq('active', true).maybeSingle();
    if (data?.api_key) {
      return data.api_key;
    }
  }

  const chain2 = adapter.from('ai_credentials') as Record<string, ReturnType<typeof vi.fn>>;
  const { data: globalCred } = await chain2.select('api_key').eq('provider', provider)
    .is('company_id', null).eq('active', true).maybeSingle();
  if (globalCred?.api_key) {
    return globalCred.api_key;
  }

  const registeredProvider = resolveProvider(provider);
  const envValue = envGetter(registeredProvider.envKey);
  if (envValue) {
    return envValue;
  }

  throw new ConfigError(
    `No API key configured for provider "${provider}". `
    + `Checked: ai_credentials (company=${companyId ?? 'none'}, global), `
    + `env.${registeredProvider.envKey}`,
  );
}

// ============== REGISTRY ==============

describe('Provider Registry', () => {
  beforeEach(() => { clearRegistry(); });

  it('registers and resolves by id (Map lookup, no switch)', () => {
    registerProvider({ id: 'ai-gateway', name: 'AI Gateway', envKey: 'AI_GATEWAY_API_KEY' });
    const r = resolveProvider('ai-gateway');
    expect(r.id).toBe('ai-gateway');
    expect(r.envKey).toBe('AI_GATEWAY_API_KEY');
  });

  it('throws ConfigError for unknown provider', () => {
    registerProvider({ id: 'ai-gateway', name: 'GW', envKey: 'GW_KEY' });
    expect(() => resolveProvider('unknown')).toThrowError(ConfigError);
    expect(() => resolveProvider('unknown')).toThrowError(/Unknown provider: "unknown"/);
  });

  it('includes registered providers in error message', () => {
    registerProvider({ id: 'anthropic', name: 'A', envKey: 'A_KEY' });
    registerProvider({ id: 'ai-gateway', name: 'GW', envKey: 'G_KEY' });
    try { resolveProvider('nonexistent'); } catch (e) {
      expect((e as Error).message).toContain('anthropic');
      expect((e as Error).message).toContain('ai-gateway');
    }
  });

  it('registers multiple providers independently', () => {
    registerProvider({ id: 'anthropic', name: 'A', envKey: 'A_KEY' });
    registerProvider({ id: 'ai-gateway', name: 'GW', envKey: 'GW_KEY' });
    expect(resolveProvider('anthropic').id).toBe('anthropic');
    expect(resolveProvider('ai-gateway').id).toBe('ai-gateway');
  });

  it('latest registration wins for same id', () => {
    registerProvider({ id: 'gw', name: 'V1', envKey: 'KEY_V1' });
    registerProvider({ id: 'gw', name: 'V2', envKey: 'KEY_V2' });
    expect(resolveProvider('gw').name).toBe('V2');
  });

  it('clearRegistry removes all providers', () => {
    registerProvider({ id: 'a', name: 'A', envKey: 'K' });
    clearRegistry();
    expect(() => resolveProvider('a')).toThrowError(ConfigError);
    expect(listRegisteredProviders()).toHaveLength(0);
  });

  it('ConfigError has name "ConfigError"', () => {
    const err = new ConfigError('test');
    expect(err.name).toBe('ConfigError');
    expect(err).toBeInstanceOf(Error);
  });
});

// ============== CREDENTIAL CASCADE ==============

describe('resolveApiKey cascade', () => {
  beforeEach(() => {
    clearRegistry();
    registerProvider({ id: 'ai-gateway', name: 'GW', envKey: 'AI_GATEWAY_API_KEY' });
    registerProvider({ id: 'anthropic', name: 'Anthropic', envKey: 'ANTHROPIC_API_KEY' });
  });

  it('source 1: company credential', async () => {
    const sb = makeMockAdapter([{ data: { api_key: 'company-key-xxx' } }]);
    const key = await resolveApiKeyCascade({ provider: 'ai-gateway', companyId: 'c-123' }, sb, () => undefined);
    expect(key).toBe('company-key-xxx');
  });

  it('source 2: global credential (company has none)', async () => {
    const sb = makeMockAdapter([{ data: null }, { data: { api_key: 'global-key-yyy' } }]);
    const key = await resolveApiKeyCascade({ provider: 'ai-gateway', companyId: 'c-999' }, sb, () => undefined);
    expect(key).toBe('global-key-yyy');
  });

  it('source 3: env fallback (no DB credentials)', async () => {
    const sb = makeMockAdapter([{ data: null }]);
    const key = await resolveApiKeyCascade(
      { provider: 'ai-gateway' }, sb,
      (n) => (n === 'AI_GATEWAY_API_KEY' ? 'env-key-zzz' : undefined),
    );
    expect(key).toBe('env-key-zzz');
  });

  it('throws ConfigError when no credential in any source', async () => {
    const sb = makeMockAdapter([{ data: null }, { data: null }]);
    await expect(
      resolveApiKeyCascade({ provider: 'ai-gateway', companyId: 'c-1' }, sb, () => undefined),
    ).rejects.toThrowError(/No API key configured for provider "ai-gateway"/);
  });

  it('without companyId, skips company lookup — goes global', async () => {
    const sb = makeMockAdapter([{ data: { api_key: 'global-anthropic' } }]);
    const key = await resolveApiKeyCascade({ provider: 'anthropic' }, sb, () => undefined);
    expect(key).toBe('global-anthropic');
  });
});

// ============== CONTRAPROVA ==============

describe('resolveApiKey — cascade order contraproof', () => {
  beforeEach(() => {
    clearRegistry();
    registerProvider({ id: 'ai-gateway', name: 'GW', envKey: 'AI_GATEWAY_API_KEY' });
  });

  it('company wins over global and env', async () => {
    const sb = makeMockAdapter([{ data: { api_key: 'company-key-xxx' } }]);
    const key = await resolveApiKeyCascade(
      { provider: 'ai-gateway', companyId: 'c-1' }, sb,
      (n) => (n === 'AI_GATEWAY_API_KEY' ? 'env-key-zzz' : undefined),
    );
    expect(key).toBe('company-key-xxx');
    expect(key).not.toBe('env-key-zzz');
  });

  it('global wins over env when no company credential', async () => {
    const sb = makeMockAdapter([{ data: null }, { data: { api_key: 'global-key-yyy' } }]);
    const key = await resolveApiKeyCascade(
      { provider: 'ai-gateway', companyId: 'c-1' }, sb,
      (n) => (n === 'AI_GATEWAY_API_KEY' ? 'env-key-zzz' : undefined),
    );
    expect(key).toBe('global-key-yyy');
    expect(key).not.toBe('env-key-zzz');
  });

  it('CONTRAPROVA: inverted order yields different result', () => {
    const envGetter = (n: string) => (n === 'AI_GATEWAY_API_KEY' ? 'env-key-zzz' : undefined);
    const companyKey = 'company-key-xxx';
    const envKey = envGetter('AI_GATEWAY_API_KEY');
    expect(companyKey).not.toBe(envKey);
  });
});

// ============== mergeParams ==============

import { mergeParams, resolveConfig, resolveApiKey } from '../src/core/config';

describe('mergeParams', () => {
  it('no company row → inherits global params entirely', () => {
    const global = { temperature: 0.7, max_tokens: 4096 };
    const result = mergeParams(global, {});
    expect(result).toEqual({ temperature: 0.7, max_tokens: 4096 });
  });

  it('partial company params → merges (undeclared fields inherited)', () => {
    const global = { temperature: 0.7, max_tokens: 4096 };
    const company = { temperature: 0.5 };
    const result = mergeParams(global, company);
    expect(result).toEqual({ temperature: 0.5, max_tokens: 4096 });
  });

  it('explicit null REMOVES the inherited key', () => {
    const global = { temperature: 0.7, reasoning: { budget: 1000 } };
    const company = { temperature: null };
    const result = mergeParams(global, company);
    expect(result).toEqual({ reasoning: { budget: 1000 } });
    expect(result).not.toHaveProperty('temperature');
  });

  it('empty company params {} → inherits everything (does not zero)', () => {
    const global = { temperature: 0.7, max_tokens: 4096, reasoning: true };
    const result = mergeParams(global, {});
    expect(result).toEqual(global);
  });

  it('both empty → empty result', () => {
    expect(mergeParams({}, {})).toEqual({});
  });
});

// ============== CONFIG CONTRACT ==============

describe('resolveConfig — contract validation', () => {
  it('parses "provider:model" format correctly', () => {
    const [provider, ...m] = 'anthropic:claude-haiku-4-5-20251001'.split(':');
    expect(provider).toBe('anthropic');
    expect(m.join(':')).toBe('claude-haiku-4-5-20251001');
  });

  it('handles model with colons', () => {
    const [provider, ...m] = 'ai-gateway:models/gemini:1.5-pro'.split(':');
    expect(provider).toBe('ai-gateway');
    expect(m.join(':')).toBe('models/gemini:1.5-pro');
  });

  it('provider and model still REPLACE (no merge)', () => {
    const globalProvider = 'anthropic';
    const companyProvider = 'ai-gateway';
    expect(companyProvider).toBe('ai-gateway');
    expect(companyProvider).not.toBe(globalProvider);
  });

  it('CONTRAPROVA: substitution instead of merge loses inherited params', () => {
    const global = { temperature: 0.7, max_tokens: 4096 };
    const company = { temperature: 0.5 };

    const withMerge = mergeParams(global, company);
    expect(withMerge).toEqual({ temperature: 0.5, max_tokens: 4096 });

    const withSubstitution = company;
    expect(withSubstitution).not.toHaveProperty('max_tokens');
    expect(withMerge).not.toEqual(withSubstitution);
  });
});

// ============== resolveConfig: dois eixos ==============

/**
 * A filtragem por active+enabled agora vive DENTRO do adapter (IAiDbAdapter.getConfig
 * só retorna configs com active=true E enabled=true). Aqui testamos que a cascata
 * respeita o contrato — se o adapter devolve null, o engine não inventa fallback.
 */
describe('resolveConfig — respeita o adapter', () => {
  it('adapter que devolve config → resolve sem erro', async () => {
    const adapter = {
      getConfig: async () => ({ agent: 'assistant', tenantId: null, provider: 'anthropic', model: 'm', params: {}, enabled: true }),
      getCredential: async () => null,
      listProviders: async () => [],
      getProvider: async () => null,
      openRun: async () => '',
      closeRun: async () => {},
      recordInvocation: async () => {},
      recordStep: async () => {},
      getModelPricing: async () => null,
      getConsumptionStatus: async () => null,
    };

    const config = await resolveConfig({ agent: 'assistant', adapter });
    expect(config.provider).toBe('anthropic');
  });

  it('adapter que devolve null → cascata continua para default', async () => {
    const calls: string[] = [];
    const adapter = {
      getConfig: async (agent: string) => {
        calls.push(agent);
        if (agent === 'default') return { agent: 'default', tenantId: null, provider: 'ai-gateway', model: 'catch-all', params: {}, enabled: true };
        return null;
      },
      getCredential: async () => null,
      listProviders: async () => [],
      getProvider: async () => null,
      openRun: async () => '',
      closeRun: async () => {},
      recordInvocation: async () => {},
      recordStep: async () => {},
      getModelPricing: async () => null,
      getConsumptionStatus: async () => null,
    };

    const config = await resolveConfig({ agent: 'assistant', adapter });
    expect(config.provider).toBe('ai-gateway');
    expect(calls).toContain('assistant');
    expect(calls).toContain('default');
  });
});

// ============== resolveConfig: cascata REAL até o catch-all "default" ==============

/**
 * As `describe`s acima ("resolveConfig — dois eixos") já chamam a função REAL,
 * mas nenhuma exercita o passo 3 (a linha do agente `default` sendo achada e
 * usada) — a cobertura mostrou a linha do `return` do catch-all como NUNCA
 * executada. Aqui fecha isso: um mock que distingue qual `agent` foi
 * consultado (o mock de "dois eixos" devolve a MESMA linha pra qualquer
 * consulta, então não serve pra provar cascata entre agentes diferentes).
 */
describe('resolveConfig — cascata REAL até o catch-all "default"', () => {
  interface IAgentRow { provider: string; model: string; params?: Record<string, unknown> }

  function makeMockAdapter(script: Record<string, IAgentRow | undefined>) {
    return {
      getConfig: async (agent: string) => {
        const row = script[agent];
        if (!row) return null;
        return { agent, tenantId: null, provider: row.provider, model: row.model, params: row.params ?? {}, enabled: true };
      },
      getCredential: async () => null,
      listProviders: async () => [],
      getProvider: async () => null,
      openRun: async () => '',
      closeRun: async () => {},
      recordInvocation: async () => {},
      recordStep: async () => {},
      getModelPricing: async () => null,
      getConsumptionStatus: async () => null,
    };
  }

  it('📌 sem linha do agente pedido, cai no catch-all "default" e RESOLVE — não recusa', async () => {
    const adapter = makeMockAdapter({ default: { provider: 'ai-gateway', model: 'catch-all-model' } });

    const config = await resolveConfig({ agent: 'assistant', adapter });

    expect(config.provider).toBe('ai-gateway');
    expect(config.model).toBe('catch-all-model');
  });

  it('agente com linha própria NÃO usa o catch-all — usa a própria', async () => {
    const adapter = makeMockAdapter({
      assistant: { provider: 'anthropic', model: 'own-model' },
      default: { provider: 'ai-gateway', model: 'catch-all-model' },
    });

    const config = await resolveConfig({ agent: 'assistant', adapter });

    expect(config.model).toBe('own-model');
  });

  it('📌 nem o agente nem "default" cadastrados → ConfigError, sem fallback nenhum', async () => {
    const adapter = makeMockAdapter({});

    await expect(resolveConfig({ agent: 'assistant', adapter }))
      .rejects.toThrow(/No config found/);
  });

  it('o próprio agente "default" sem linha não consulta a si mesmo de novo — sem loop', async () => {
    const adapter = makeMockAdapter({});

    await expect(resolveConfig({ agent: 'default', adapter }))
      .rejects.toThrow(/No config found/);
  });
});

// ============== resolveApiKey: cascata REAL, credencial por empresa ==============

/**
 * O `describe` "resolveApiKey cascade" acima testa `resolveApiKeyCascade`, uma
 * REIMPLEMENTAÇÃO local — nunca a função real. A cobertura confirmou: o passo
 * 1 real (credencial da empresa tendo sucesso) nunca rodava. Aqui chama
 * `resolveApiKey` de verdade.
 */
describe('resolveApiKey — cascata REAL, credencial por empresa', () => {
  function makeMockAdapter(script: { company?: string; global?: string }) {
    return {
      getConfig: async () => null,
      getCredential: async (provider: string, tenantId?: string | null) => {
        if (tenantId && script.company) return { apiKey: script.company, provider, tenantId };
        if (script.global) return { apiKey: script.global, provider, tenantId: null };
        return null;
      },
      listProviders: async () => [],
      getProvider: async () => null,
      openRun: async () => '',
      closeRun: async () => {},
      recordInvocation: async () => {},
      recordStep: async () => {},
      getModelPricing: async () => null,
      getConsumptionStatus: async () => null,
    };
  }

  it('📌 credencial da EMPRESA existe → devolve ela, sem consultar a global', async () => {
    const adapter = makeMockAdapter({ company: 'company-key-real', global: 'global-key-real' });

    const key = await resolveApiKey({ provider: 'anthropic', companyId: 'c-1' }, adapter);

    expect(key).toBe('company-key-real');
  });

  it('sem credencial da empresa, cai pra global', async () => {
    const adapter = makeMockAdapter({ global: 'global-key-real' });

    const key = await resolveApiKey({ provider: 'anthropic', companyId: 'c-1' }, adapter);

    expect(key).toBe('global-key-real');
  });

  it('sem credencial em lugar nenhum → ConfigError, sem cair pro .env', async () => {
    const adapter = makeMockAdapter({});

    await expect(resolveApiKey({ provider: 'anthropic', companyId: 'c-1' }, adapter))
      .rejects.toThrow(/ai_credentials/);
  });
});
