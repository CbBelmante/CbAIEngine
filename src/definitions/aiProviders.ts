// ============== AI PROVIDERS (DENO-COMPATIBLE) ==============
// 🔌 Vocabulário do catálogo de provedores de IA (`ai_providers`)

/**
 * Dialetos de fio que o motor sabe falar — espelho do CHECK
 * `ai_providers_protocol_check` (`019_ai_config.sql`).
 *
 * Protocolo NÃO é marca. `openai-compatible` atende OpenRouter, Groq, Together,
 * DeepSeek, vLLM ou um Ollama local trocando apenas a `base_url`: é por isso que
 * cadastrar um provedor novo é INSERT pela tela, e não deploy. A lista é fechada
 * pelos adapters que EXISTEM — um protocolo sem adapter seria um provedor que a
 * tela aceita e o motor recusa na hora da chamada.
 *
 * Compartilhado de propósito: a tela `/admin/ai` GRAVA estes valores e
 * `core/ai/providerCatalog.ts` os LÊ para escolher o adapter. Duplicar seria a
 * porta pela qual os dois lados divergem.
 */
export const AI_PROTOCOLS = {
  /** `/v1/messages` + `x-api-key`. Endereço fixo no adapter — dispensa `base_url`. */
  ANTHROPIC: 'anthropic',
  /** `${base_url}/chat/completions` + `Authorization: Bearer`. EXIGE `base_url`. */
  OPENAI_COMPATIBLE: 'openai-compatible',
} as const satisfies Record<string, string>;

export type AiProtocol = typeof AI_PROTOCOLS[keyof typeof AI_PROTOCOLS];

export const AI_PROTOCOL_VALUES: readonly AiProtocol[] = Object.values(AI_PROTOCOLS);

/** Estreita texto vindo do banco/formulário para o vocabulário fechado. */
export function isAiProtocol(value: unknown): value is AiProtocol {
  return typeof value === 'string' && (AI_PROTOCOL_VALUES as readonly string[]).includes(value);
}

/**
 * `base_url` é exigida por PROTOCOLO, não por provedor: sem endereço o adapter
 * de protocolo não tem para onde ligar e recusaria em runtime — depois de a
 * tela ter aceitado o cadastro. Espelha o CHECK `ai_providers_base_url_check`,
 * que cobra a URL só de provedor LIGADO (rascunho pode ficar incompleto).
 */
export function requiresBaseUrl(protocol: AiProtocol): boolean {
  return protocol === AI_PROTOCOLS.OPENAI_COMPATIBLE;
}

// ============== TABELAS ==============

/** Tabelas de configuração de IA no schema, editadas por `/admin/ai`. */
export const AI_CONFIG_TABLES = {
  PROVIDERS: 'ai_providers',
  CONFIG: 'ai_config',
  PRICING: 'ai_model_pricing',
  /** Somente leitura pelo front — a view não expõe `api_key`. */
  CREDENTIALS_VIEW: 'ai_credentials_view',
} as const satisfies Record<string, string>;
