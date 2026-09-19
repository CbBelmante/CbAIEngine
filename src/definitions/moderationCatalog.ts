// ============== MODERATION CATALOG (DENO-COMPATIBLE) ==============
// 🛡️ O catálogo de conteúdo impróprio do engine: o QUE se bloqueia, e por quê

/**
 * 🔧 moderationCatalog — CONTEÚDO da moderação, separado da ESTRUTURA
 *
 * Aqui moram as categorias, os rótulos que o usuário lê e os termos que o
 * provider embutido casa. O COMO (a porta, o registry, os dois middlewares)
 * mora em `agent/middleware/moderation.ts`. Uma definição, dois pontos de
 * aplicação — entrada e saída —, no molde do `piiCatalog.ts`.
 *
 * Fixo em código, pela MESMA razão do catálogo de PII: uma deny-list que um
 * admin edita na tela é uma deny-list que um admin ESVAZIA, e o bloqueio
 * afrouxado fica sem rastro de quem afrouxou. Extensão por PR.
 *
 * ⚠️ Este arquivo contém, por necessidade, o vocabulário que ele bloqueia.
 * Não há como escrever uma deny-list sem a lista.
 */

// ============== O CRITÉRIO ==============

/**
 * 📌 Entra no catálogo o termo que satisfaz os TRÊS filtros ao mesmo tempo:
 *
 *   1. é **inequívoco no contexto de um application** — não tem leitura legítima
 *      numa conversa, comercial ou operação;
 *   2. é **expressão**, não palavra solta, sempre que a palavra solta tiver
 *      leitura inocente;
 *   3. bloqueá-lo é melhor do que deixá-lo passar — os dois erros custam, e
 *      não custam igual.
 *
 * O filtro 2 é o que segura o falso positivo, e ele é a regra mais importante
 * daqui: um guarda que barra o usuário no meio do trabalho é um guarda que alguém
 * desliga — e aí não há guarda nenhum. Precisão vale mais que cobertura,
 * porque a cobertura tem um caminho de upgrade (um provider remoto ou um juiz
 * LLM registrado na porta) e a confiança perdida não tem.
 *
 * O que fica de FORA, e por que ficar de fora não é descuido:
 *
 * · **Palavra solta ambígua** (`macaco`, `crioulo`, `bicha`) — cada uma tem
 *   uso corrente inocente em pt-BR: animal, região, fila. Falha o filtro 1.
 *
 * · **Ironia, sarcasmo e ofensa sem palavrão** — não têm forma. Falham o
 *   filtro 1 por construção: só um classificador com contexto os alcança, e é
 *   exatamente por isso que a porta é plugável.
 *
 * · **Ofuscação deliberada** (leetspeak, letras repetidas, separadores no meio
 *   da palavra) — perseguir variação vira corrida armamentista com regex, e
 *   cada nova variante aceita amplia o falso positivo sobre texto legítimo.
 *
 * · **Idioma estrangeiro** — o catálogo é pt-BR porque o produto é. Um
 *   provider remoto cobre multilíngue sem tocar aqui.
 *
 * ⚠️ O corolário honesto: este catálogo REDUZ a exposição; não a zera. É a
 * mesma franqueza do `piiCatalog.ts`. O valor dele não é "nada impróprio
 * passa" — é a porta existir, estar no caminho crítico das duas superfícies
 * (a interna e a do cliente) e ser trocável por algo mais forte.
 */

// ============== CATEGORIES ==============

/** As categorias bloqueadas. Acrescentar uma aqui é o ponto de extensão. */
export const MODERATION_CATEGORIES = {
  HATE: 'hate',
  SEXUAL: 'sexual',
  VIOLENCE: 'violence',
  SELF_HARM: 'self_harm',
} as const satisfies Record<string, string>;

export type ModerationCategory = typeof MODERATION_CATEGORIES[keyof typeof MODERATION_CATEGORIES];

export const ALL_MODERATION_CATEGORIES = Object.values(
  MODERATION_CATEGORIES,
) as ModerationCategory[];

/** Estreita texto vindo de um provider externo para o vocabulário fechado. */
export function isModerationCategory(value: unknown): value is ModerationCategory {
  return typeof value === 'string'
    && (ALL_MODERATION_CATEGORIES as readonly string[]).includes(value);
}

// ============== STAGES ==============

/**
 * Onde o bloqueio aconteceu. `input` é a mensagem do usuário antes de ir ao
 * modelo; `output` é a resposta do modelo antes de chegar ao usuário.
 */
export const MODERATION_STAGES = {
  INPUT: 'input',
  OUTPUT: 'output',
} as const satisfies Record<string, string>;

export type ModerationStage = typeof MODERATION_STAGES[keyof typeof MODERATION_STAGES];

// ============== LABELS ==============

/**
 * O rótulo que o USUÁRIO lê. Deliberadamente descritivo e sem jargão: quem foi
 * bloqueado precisa entender O QUE foi recusado para reescrever, e a categoria
 * crua (`self_harm`) não comunica isso a ninguém fora do código.
 */
export const MODERATION_CATEGORY_LABELS = {
  [MODERATION_CATEGORIES.HATE]: 'discurso de ódio',
  [MODERATION_CATEGORIES.SEXUAL]: 'conteúdo sexual explícito',
  [MODERATION_CATEGORIES.VIOLENCE]: 'violência ou instrução para causar dano',
  [MODERATION_CATEGORIES.SELF_HARM]: 'automutilação ou suicídio',
} as const satisfies Record<ModerationCategory, string>;

// ============== USER-FACING MESSAGE ==============

/**
 * A mensagem que o usuário recebe quando a moderação bloqueia.
 *
 * 🔴 Ela diz O QUE foi recusado e NUNCA devolve o conteúdo recusado — nem
 * trecho, nem citação, nem "você escreveu X". Devolver o texto ao usuário
 * derrotaria o bloqueio na saída (o conteúdo chegaria pela mensagem de erro) e
 * transformaria a moderação num eco na entrada.
 *
 * Constante em `definitions/` no molde do `AI_NOT_CONFIGURED_MESSAGE`: é o
 * precedente da casa para texto de usuário emitido por edge function, onde não
 * há a camada de i18n do front.
 */
const STAGE_PREFIX = {
  [MODERATION_STAGES.INPUT]: 'Mensagem bloqueada pela moderação',
  [MODERATION_STAGES.OUTPUT]: 'A resposta foi bloqueada pela moderação',
} as const satisfies Record<ModerationStage, string>;

const STAGE_SUFFIX = {
  [MODERATION_STAGES.INPUT]: 'Reescreva sem esse conteúdo.',
  [MODERATION_STAGES.OUTPUT]: 'Reformule o pedido.',
} as const satisfies Record<ModerationStage, string>;

/** Junta os rótulos com vírgula e "e" — texto para gente, não `join(', ')`. */
function joinLabels(labels: string[]): string {
  if (labels.length <= 1) {
    return labels[0] ?? '';
  }
  return `${labels.slice(0, -1).join(', ')} e ${labels.at(-1)}`;
}

export function buildModerationMessage(
  { stage, categories }: { stage: ModerationStage; categories: readonly ModerationCategory[] },
): string {
  const labels = categories.map((category) => MODERATION_CATEGORY_LABELS[category]);
  const detail = labels.length === 0
    ? 'conteúdo impróprio'
    : joinLabels(labels);
  return `${STAGE_PREFIX[stage]}: ${detail}. ${STAGE_SUFFIX[stage]}`;
}

// ============== TERMS ==============

/**
 * Os termos do provider EMBUTIDO, por categoria.
 *
 * 📌 Casamento por FRONTEIRA DE PALAVRA sobre texto normalizado (minúsculas,
 * sem acento) — ver `agent/middleware/catalogProvider.ts`. A fronteira é o que
 * impede `matar` de casar dentro de `matarias`, e a normalização é o que faz
 * `ódio` e `odio` valerem o mesmo sem duplicar a lista.
 *
 * 📌 Predominam EXPRESSÕES de várias palavras, e isso é o filtro 2 do critério
 * em ação: `matar` sozinho aparece em "matar a charada" e em "isso vai matar o
 * prazo"; `quero me matar` não aparece em conversa.
 *
 * ⚠️ `hate` é deliberadamente a lista mais curta. É a categoria em que a
 * palavra solta é mais ambígua em pt-BR e em que um classificador com contexto
 * ganha da regex por larga margem — é o caso de uso que justifica registrar um
 * provider remoto ou um juiz LLM na porta.
 */
export const MODERATION_TERMS = {
  [MODERATION_CATEGORIES.HATE]: [
    'macaco de merda',
    'volta pra senzala',
    'morte aos judeus',
    'raca inferior',
    'nao merece viver por ser',
  ],
  [MODERATION_CATEGORIES.SEXUAL]: [
    'conteudo pornografico',
    'pornografia infantil',
    'manda nudes',
    'mandar nudes',
    'foto pelada',
    'fotos peladas',
  ],
  [MODERATION_CATEGORIES.VIOLENCE]: [
    'como fazer uma bomba',
    'como fabricar explosivo',
    'como matar alguem',
    'como envenenar alguem',
    'como agredir alguem',
    'onde comprar arma ilegal',
  ],
  [MODERATION_CATEGORIES.SELF_HARM]: [
    'quero me matar',
    'como me matar',
    'quero me suicidar',
    'como me suicidar',
    'quero me cortar',
    'acabar com a minha vida',
  ],
} as const satisfies Record<ModerationCategory, readonly string[]>;

// ============== TRACE MARKER ==============

/**
 * A chave que o payload do trace ganha quando a moderação bloqueia:
 * `{ "moderationBlock": { "stage": "output", "categories": ["hate"] } }`.
 *
 * Registra QUE bloqueou, EM QUE estágio e POR QUAL categoria — e nunca o
 * conteúdo. Mesmo princípio do `piiRedacted`: o valor sai, o fato de que
 * existiu fica.
 */
export const MODERATION_TRACE_KEY = 'moderationBlock';

// ============== PROVIDER SELECTION ==============

/**
 * A variável que ESCOLHE o provider de moderação, por `id` do registry.
 *
 * 📌 Ausente → roda o embutido do catálogo. Presente e não registrada →
 * `ConfigError`, nunca um silencioso "volta pro catálogo": quem configurou um
 * provider e o viu ser ignorado teria um guarda diferente do que pediu, sem
 * nada dizendo. Ausência é padrão; presença errada é recusa.
 *
 * 📌 Isto NÃO é escolha de modelo — não gasta credencial e não decide
 * fornecedor de LLM. É a seleção de qual implementação da porta roda, no mesmo
 * espírito de `ai_providers.protocol`: mecanismo, não marca.
 *
 * Fica em variável de ambiente, e não em `ai_config`, porque o v1 não tem
 * migration (`ai_providers.protocol` só aceita os dois protocolos de chat) e
 * porque a escolha é de infraestrutura, não de empresa. Um provider por
 * empresa é extensão futura, e cabe em `ai_config` no dia em que existir.
 */
export const MODERATION_PROVIDER_ENV_KEY = 'CBAI_MODERATION_PROVIDER';

/** O limiar, quando o administrador quiser calibrar um provider que pontua. */
export const MODERATION_THRESHOLD_ENV_KEY = 'CBAI_MODERATION_THRESHOLD';

// ============== THRESHOLD ==============

/**
 * Limiar padrão para providers que pontuam (`scores`) em vez de decidir.
 *
 * 0.5 é o ponto neutro de um score normalizado em [0,1] — não é uma calibração
 * medida, e não finge ser. Quem registrar um provider com score DEVE calibrar
 * o próprio limiar contra dados reais; este valor existe para que a ausência
 * de calibração seja neutra, nunca permissiva.
 *
 * ⚠️ Não confundir com modelo default: aqui não há escolha de fornecedor nem
 * gasto de credencial — é a régua de leitura de um número que o provider já
 * devolveu.
 */
export const DEFAULT_MODERATION_THRESHOLD = 0.5;
