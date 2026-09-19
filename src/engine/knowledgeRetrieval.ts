/**
 * 🛡️ knowledgeRetrieval — O RAG entra pela FASE `pre-context`, não por atalho
 *
 * O motor tem uma fase de middleware para exatamente isto (`loop.ts:243`): ela
 * roda UMA vez, antes da primeira volta, e é onde o contexto se monta. Buscar
 * dentro do handler funcionaria e seria errado — amarraria o RAG ao
 * `assistant` e ao formato de hoje, quando o mecanismo já existe e serve
 * qualquer agente.
 *
 * O que ele injeta é uma `NMessage` de `role:'system'`, e isso é agnóstico de
 * provider por construção: o adapter OpenAI-compatible a mantém inline e o
 * Anthropic a funde no campo `system` (`anthropic.ts:161`). Nenhum dos dois
 * precisou saber que existe RAG.
 *
 * ⚠️ `IMiddleware.transform` recebe só `messages` — sem contexto, sem conexão.
 * Por isso a fábrica FECHA sobre o que a busca precisa (client do caller,
 * embedder, tetos), e é ali que a identidade do usuário entra.
 */

import type { IMiddleware, NMessage, NMessagePart } from '../core/types';
import type { IAiDbAdapter } from '../dbAdapter/dbAdapter';
import type { IAiKnowledgeHit } from '../dbAdapter/types';
import { searchKnowledge } from '../runtime/knowledgeSearch';

// ============== CONSTANTS ==============

export const KNOWLEDGE_MIDDLEWARE_NAME = 'knowledge-retrieval';

/**
 * O rótulo diz ao modelo que aquilo é conhecimento curado, não fala do usuário.
 * Sem ele, uma entrada em primeira pessoa ("prefiro contato por e-mail") seria
 * lida como pedido da conversa atual.
 */
export const KNOWLEDGE_BLOCK_HEADING =
  'Curated knowledge retrieved for this question. Use it when it applies; '
  + 'it is reference material, not a message from the user.';

// ============== TYPES ==============

export interface ICreateKnowledgeMiddlewareParams {
  adapter: IAiDbAdapter;
  embedQuery(text: string): Promise<number[]>;
  topK?: number;
  similarityThreshold?: number;
  priorityWeight?: number;
}

// ============== HELPERS ==============

function flattenContent(content: string | NMessagePart[] | undefined): string {
  if (typeof content === 'string') { return content; }
  if (!content) { return ''; }
  const chunks: string[] = [];
  for (const part of content) {
    if (part.type === 'text') { chunks.push(part.text); }
  }
  return chunks.join('\n');
}

/** A consulta é a última fala do usuário — é a pergunta em aberto, não o histórico inteiro. */
export function readLastUserText(messages: NMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role === 'user') { return flattenContent(message.content).trim(); }
  }
  return '';
}

/**
 * `similarity` e `entry_id` ficam DE FORA do texto: número solto no prompt vira
 * citação inventada, e o id não significa nada para quem lê a resposta.
 */
export function renderKnowledgeBlock(hits: IAiKnowledgeHit[]): string {
  const lines: string[] = [KNOWLEDGE_BLOCK_HEADING];
  for (const hit of hits) {
    lines.push(`\n## ${hit.title}\n${hit.content}`);
  }
  return lines.join('\n');
}

/** Antes da última fala do usuário: é onde o modelo lê o contexto logo antes da pergunta. */
function insertBeforeLastUser(messages: NMessage[], block: NMessage): NMessage[] {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === 'user') {
      return [...messages.slice(0, index), block, ...messages.slice(index)];
    }
  }
  return [...messages, block];
}

// ============== MIDDLEWARE ==============

/**
 * ⚠️ **Fail-soft com log.** RAG indisponível devolve o histórico INTACTO: o
 * agente responde sem conhecimento, que é pior do que responder com — e muito
 * melhor do que derrubar a conversa. O erro nunca é engolido em silêncio.
 */
export function createKnowledgeRetrievalMiddleware(
  params: ICreateKnowledgeMiddlewareParams,
): IMiddleware {
  return {
    name: KNOWLEDGE_MIDDLEWARE_NAME,
    phase: 'pre-context',
    async transform(messages: NMessage[]): Promise<NMessage[]> {
      const query = readLastUserText(messages);
      if (!query) { return messages; }

      try {
        const queryEmbedding = await params.embedQuery(query);
        const hits = await searchKnowledge({
          adapter: params.adapter,
          queryEmbedding,
          ...(params.topK !== undefined ? { topK: params.topK } : {}),
          ...(params.similarityThreshold !== undefined
            ? { similarityThreshold: params.similarityThreshold } : {}),
          ...(params.priorityWeight !== undefined ? { priorityWeight: params.priorityWeight } : {}),
        });

        // Zero resultados devolve o array ORIGINAL (mesma referência): é assim
        // que `runTransforms` reporta `pass` em vez de `transform` (middleware.ts:65),
        // e um bloco vazio no prompt só gastaria token.
        if (hits.length === 0) { return messages; }

        const block: NMessage = { role: 'system', content: renderKnowledgeBlock(hits) };
        return insertBeforeLastUser(messages, block);
      } catch (error) {
        console.error('[assistant:knowledge_retrieval]', error);
        return messages;
      }
    },
  };
}
