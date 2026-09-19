/**
 * 🌐 embedDispatch — O empurrão para a fila, sempre fire-and-forget
 *
 * 🔴 **Quem grava NUNCA espera o embedding.** Salvar uma entrada é uma escrita
 * no Postgres; embedar é uma chamada a modelo, que demora e pode falhar. Se o
 * salvamento aguardasse, a UI (e o turno do agente) ficaria presa ao tempo do
 * provider — e uma indisponibilidade do gateway viraria "não consigo salvar".
 *
 * Por isso `dispatch` devolve `void`, e não `Promise`: não há o que aguardar, e
 * a assinatura torna o `await` impossível de escrever por acidente. A entrada
 * já está `pending`; se o empurrão se perder, a passada seguinte da fila
 * (`{ limit }`, cron ou reindex pela tela) a recolhe. Degradação, não perda.
 */

// ============== TYPES ==============

export type EmbedDispatcher = (entryIds: string[]) => void;

export interface ICreateEmbedDispatcherParams {
  /** Base das functions (`SUPABASE_URL`). Ausente desliga o empurrão — a fila ainda recolhe. */
  functionsBaseUrl: string | undefined;
  serviceRoleKey: string | undefined;
}

// ============== CONSTANTS ==============

export const EMBED_FUNCTION_PATH = '/functions/v1/embed';

// ============== FACTORY ==============

export function createEmbedDispatcher(
  { functionsBaseUrl, serviceRoleKey }: ICreateEmbedDispatcherParams,
): EmbedDispatcher {
  return (entryIds: string[]): void => {
    if (entryIds.length === 0) { return; }

    if (!functionsBaseUrl || !serviceRoleKey) {
      console.error('[embed:dispatch] skipped — missing SUPABASE_URL/SERVICE_ROLE_KEY', entryIds.length);
      return;
    }

    // Promise solta DE PROPÓSITO: o `.catch` existe para o erro ser visto, não
    // para ser esperado. Um rejeitado sem handler derrubaria o isolate.
    fetch(`${functionsBaseUrl.replace(/\/+$/, '')}${EMBED_FUNCTION_PATH}`, {
      method: 'POST',
      headers: { 'authorization': `Bearer ${serviceRoleKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ entryIds }),
    }).catch((error: unknown) => {
      console.error('[embed:dispatch]', error);
    });
  };
}
