/**
 * 🎯 agentConfigSchema — As regras ESTRUTURAIS da config, em JSON Schema
 *
 * Separado de `validation.ts` porque é DADO, não lógica: nenhuma linha aqui
 * decide nada, e quem executa estas regras é o `validateAgainstSchema` do #68 —
 * inclusive o acúmulo das violações, que é comportamento nativo dele. As regras
 * que exigem julgamento (provider registrado, credencial presente, unicidade de
 * nome) ficam do outro lado, porque exigem julgamento.
 */

/**
 * Regras estruturais em JSON Schema, executadas pelo validador do #68.
 *
 * `systemPrompt` aparece só em `required`, sem `type`: a união
 * `string | IPromptTemplate` seria `anyOf`, que está FORA do limite declarado
 * do `jsonSchema.ts` e é ignorada em silêncio por ele. A discriminação vira
 * regra semântica em `validation.ts`, onde é exata — em vez de um ramo sub-validado sem
 * ninguém saber.
 */
export const AGENT_CONFIG_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['model', 'systemPrompt'],
  properties: {
    model: { type: 'string' },
    maxTokens: { type: 'integer' },
    maxToolLoops: { type: 'integer' },
    outputSchema: { type: 'object' },
    params: { type: 'object' },
    tools: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'description', 'schema', 'category', 'handler'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          schema: { type: 'object' },
          category: { enum: ['read', 'suggest', 'execute'] },
        },
      },
    },
    middleware: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'phase'],
        properties: {
          name: { type: 'string' },
          phase: { enum: ['pre-context', 'pre-model', 'post-model'] },
        },
      },
    },
  },
};
