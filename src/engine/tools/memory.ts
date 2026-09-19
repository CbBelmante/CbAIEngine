/**
 * 🔧 memory — `save_memory`, a 17ª tool: fato durável na base curada
 *
 * O harness separa a CONVERSA de hoje (threads/mensagens) do FATO durável. O
 * fato vira uma entrada na categoria reservada `agent-memories` e volta, em
 * sessão posterior, pela MESMA `ai_knowledge_search` — zero tabela nova, zero
 * mudança no motor (ADR §3.6b).
 *
 * 🔴 **`visibility` e `company_id` vêm da SESSÃO, nunca do modelo.** O schema
 * abaixo não expõe os dois campos, e o writer os carimba a partir do turno. Um
 * modelo induzido a "salvar uma memória pública da empresa X" não consegue
 * escrever fora do próprio escopo — a vedação é estrutural, não uma instrução
 * no prompt que o modelo pode ignorar.
 */

import { AGENT_MEMORIES_SLUG } from '../../definitions/knowledgeConfig';
import { defineAssistantTool } from './context';
import type { IAssistantToolResult } from './context';

// ============== CONSTANTS ==============

export const SAVE_MEMORY_TOOL_NAME = 'save_memory';

/** Teto de conteúdo — memória é fato curto, não transcrição de conversa. */
export const MEMORY_MAX_CONTENT_LENGTH = 2000;
export const MEMORY_MAX_TITLE_LENGTH = 200;

export const MEMORY_TITLE_REQUIRED = 'title is required';
export const MEMORY_CONTENT_REQUIRED = 'content is required';

// ============== HELPERS ==============

function readTrimmed(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

// ============== TOOL ==============

export const saveMemoryTool = defineAssistantTool({
  name: SAVE_MEMORY_TOOL_NAME,
  description: 'Saves a durable fact to long-term memory so it is available in future sessions. '
    + 'Use for stable preferences, decisions and account context the user expects you to remember '
    + '("they only accept calls after 4pm", "they decided to postpone onboarding to March"). '
    + 'Do NOT use for the current conversation, for anything transient, or for data already stored '
    + 'in tickets, events or companies.',
  schema: {
    type: 'object',
    required: ['title', 'content'],
    properties: {
      title: { type: 'string', description: 'Short label for the fact' },
      content: { type: 'string', description: 'The fact itself, in one or two sentences' },
    },
  },
  category: 'execute',
  async run(input, context): Promise<IAssistantToolResult> {
    const title = readTrimmed(input.title, MEMORY_MAX_TITLE_LENGTH);
    if (!title) { return { result: { error: MEMORY_TITLE_REQUIRED } }; }

    const content = readTrimmed(input.content, MEMORY_MAX_CONTENT_LENGTH);
    if (!content) { return { result: { error: MEMORY_CONTENT_REQUIRED } }; }

    const saved = await context.memory.save({ title, content });
    if (saved.error) { return { result: { error: saved.error } }; }

    // `indexing: true` é a verdade do momento: a entrada existe e ainda NÃO
    // está buscável. Dizer "saved" e pronto faria o modelo prometer ao usuário
    // uma recuperação que só acontece depois que a fila embeda.
    return {
      result: {
        ok: true,
        memory: { id: saved.id, title, category: AGENT_MEMORIES_SLUG },
        indexing: true,
      },
    };
  },
});

export const memoryTools = [saveMemoryTool];
