/**
 * 🛡️ catalogProvider — O provider de moderação EMBUTIDO, movido a catálogo
 *
 * Determinístico, sem rede, sem credencial, sem custo e sem latência: casa os
 * termos de `definitions/moderationCatalog.ts` contra o texto normalizado. É a
 * implementação de referência da porta `IModerationProvider` — e a que roda
 * quando ninguém configurou outra.
 *
 * Ele é a família mais fraca das quatro (lista de termos), e isso é escolha,
 * não limitação aceita por descuido: precisão alta e zero dependência externa
 * valem mais como PISO do que cobertura alta com um ponto de falha novo no
 * caminho crítico. Cobertura entra depois, por `registerModerationProvider`,
 * sem tocar em uma linha daqui.
 */

import {
  ALL_MODERATION_CATEGORIES,
  MODERATION_TERMS,
  type ModerationCategory,
} from '../definitions/moderationCatalog';
import type { IModerationProvider, IModerationVerdict } from './moderation';

// ============== CONSTANTS ==============

/** O `id` do embutido no registry. Não é marca: é o nome do mecanismo. */
export const CATALOG_MODERATION_PROVIDER_ID = 'catalog';

const COMBINING_MARKS = /[\u0300-\u036f]/g;
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;
/** Espaço no termo casa qualquer corrida de espaço em branco no texto. */
const WHITESPACE = /\s+/g;

// ============== NORMALIZATION ==============

/**
 * Minúsculas e sem acento.
 *
 * 📌 A normalização é o que faz `ódio` e `odio` valerem o mesmo sem duplicar o
 * catálogo — e é o motivo de os termos serem escritos SEM acento lá: eles são
 * comparados contra texto já normalizado, nunca contra o texto cru.
 *
 * ⚠️ Não desfaz ofuscação deliberada (`ó.d.i.o`, `o0dio`). O catálogo declara
 * isso como limite conhecido, e perseguir variação com regex só ampliaria o
 * falso positivo sobre texto legítimo.
 */
export function normalizeForMatch(text: string): string {
  return text.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase();
}

// ============== MATCHER ==============

/**
 * Fronteira de palavra dos dois lados: é ela que impede `matar` de casar
 * dentro de `matarias` e `arma` dentro de `armazenar`. Sem ela, uma deny-list
 * de termos curtos produz mais falso positivo do que proteção.
 */
function buildTermPattern(term: string): RegExp {
  const escaped = normalizeForMatch(term)
    .replace(REGEX_SPECIALS, '\\$&')
    .replace(WHITESPACE, '\\s+');
  return new RegExp(`\\b${escaped}\\b`);
}

/** Uma compilação por termo, no carregamento do módulo — não por chamada. */
const PATTERNS_BY_CATEGORY: ReadonlyMap<ModerationCategory, readonly RegExp[]> = new Map(
  ALL_MODERATION_CATEGORIES.map((category) => [
    category,
    MODERATION_TERMS[category].map(buildTermPattern),
  ]),
);

export function matchCategories(text: string): ModerationCategory[] {
  const normalized = normalizeForMatch(text);
  return ALL_MODERATION_CATEGORIES.filter((category) =>
    (PATTERNS_BY_CATEGORY.get(category) ?? []).some((pattern) => pattern.test(normalized))
  );
}

// ============== PROVIDER ==============

/**
 * 📌 Não devolve `scores`. O catálogo DECIDE, não pontua — e inventar um score
 * sintético (`1.0` para o que casou) faria o limiar parecer calibrável quando
 * não há nada calibrando. A ausência do campo é a informação honesta, e a
 * porta já a prevê (`IModerationVerdict.scores` é opcional).
 */
export function createCatalogModerationProvider(): IModerationProvider {
  return {
    id: CATALOG_MODERATION_PROVIDER_ID,
    moderate(text: string): Promise<IModerationVerdict> {
      const categories = matchCategories(text);
      return Promise.resolve({ flagged: categories.length > 0, categories });
    },
  };
}
