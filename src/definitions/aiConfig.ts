// ============== AI CONFIG (DENO-COMPATIBLE) ==============
// 🤖 Configurações de IA para edge functions

/**
 * Thresholds de consumo mensal de IA.
 *
 * Usados em edge functions para validar consumo antes de criar ai_agent_runs.
 * Edge functions chamam get_ai_consumption_status() e comparam percent
 * com estes valores.
 *
 * Padrão híbrido:
 * - Banco CALCULA status (get_ai_consumption_status)
 * - Código DECIDE ação (via thresholds abaixo)
 *
 * Vantagem: mudar threshold NÃO precisa de migration.
 */
export const AI_LIMIT_THRESHOLDS = {
  /** Porcentagem que dispara alerta (console.warn) */
  WARNING: 80,

  /** Porcentagem que bloqueia chamada (throw error) */
  BLOCK: 100,
} as const;

/**
 * Tipo inferido dos thresholds.
 */
export type AILimitThreshold = keyof typeof AI_LIMIT_THRESHOLDS;
