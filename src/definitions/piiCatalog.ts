/**
 * 🔧 piiCatalog — O catálogo de dado pessoal do engine: o QUE se redige, e por quê
 *
 * Uma definição, três pontos de aplicação (middleware `pre-model`, `save_memory`
 * e o `payload` de `ai_run_steps`). Se divergir, o próximo worker precisa
 * adivinhar qual vale — por isso o catálogo mora aqui, sozinho, e os três
 * caminhos importam DESTE arquivo.
 *
 * Fixo em código, no molde da `029_ai_credentials.sql:26` (`v_denied constant
 * text[] := array['api_key']`): uma deny-list que um admin edita na tela é uma
 * deny-list que um admin ESVAZIA, e o vazamento fica sem rastro de quem
 * afrouxou. Extensão por PR, como a da migration é por migration.
 */

// ============== O CRITÉRIO ==============

/**
 * 📌 Entra no catálogo o que satisfaz os TRÊS filtros ao mesmo tempo:
 *
 *   1. é dado pessoal de pessoa NATURAL (LGPD art. 5º I);
 *   2. tem forma fechada e verificável — detectável sem adivinhação;
 *   3. o agente NÃO precisa do valor para raciocinar.
 *
 * Os três juntos dão CPF e telefone. O que fica de fora, e por que ficar de
 * fora não é descuido:
 *
 * · **Nome de pessoa** — é dado pessoal pela letra da lei, e mesmo assim fica.
 *   O engine é application: a conversa inteira é sobre gente nomeada,
 *   e redigir nome deixaria o agente incapaz de responder "o que o usuário
 *   pediu?". Some-se que detectar nome exige NER, não regex — qualquer
 *   heurística de palavra capitalizada comeria nome de empresa, de cidade e de
 *   produto. Falha os filtros 2 e 3.
 *
 * · **CNPJ** — é pessoa JURÍDICA (fora da LGPD) e público na Receita. Além
 *   disso é chave de negócio ativa: o próprio produto o injeta no contexto
 *   (`promptContext.ts`, linha `CNPJ: …`) e o usuário pergunta por ele. Falha o
 *   filtro 1, e redigi-lo seria perda de função com ganho zero.
 *
 * · **E-mail** — decisão do founder em 09/09/2026: pode trafegar. É a
 *   identidade operacional do produto (login, destinatário, referência entre
 *   pessoas), e redigi-lo custaria função sem fechar o vetor que importa.
 *
 * · **Endereço em prosa e CEP** — endereço não tem forma fechada (falha o
 *   filtro 2, e uma regex de logradouro produz mais falso positivo que
 *   proteção); CEP identifica LOGRADOURO, não pessoa (falha o filtro 1).
 *
 * · **UUID, número de ticket, data, valor** — só reidentificam DENTRO do
 *   domínio, que é onde já se pode. São a cola do sistema.
 */

// ============== CATEGORIES ==============

/** As categorias redigidas. Acrescentar uma aqui é o ponto de extensão. */
export const PII_CATEGORIES = {
  CPF: 'cpf',
  PHONE: 'phone',
} as const satisfies Record<string, string>;

export type PiiCategory = typeof PII_CATEGORIES[keyof typeof PII_CATEGORIES];

export const ALL_PII_CATEGORIES = Object.values(PII_CATEGORIES) as PiiCategory[];

// ============== PLACEHOLDER ==============

/**
 * O placeholder é TIPADO e ORDINAL: `[REDACTED:CPF#1]`.
 *
 * 📌 Apagar o dado cegaria o agente; substituí-lo por um rótulo que diz o TIPO
 * preserva a informação ("houve um CPF aqui, na fala do cliente") e mata só o
 * VALOR — o modelo continua respondendo "sim, ele mandou o CPF".
 *
 * O ordinal (`#1`, `#2`) resolve o outro lado: sem ele, duas conversas órfãs
 * viram o mesmo `[REDACTED:PHONE]` e o modelo perde a noção de que são pessoas
 * diferentes. Numera por ordem de aparição — NÃO é hash: o espaço de um CPF é
 * 10¹¹, e um hash gravado no trace seria reversível por força bruta em segundos.
 * Ordinal não carrega informação nenhuma fora do contexto em que foi atribuído.
 */
export const PII_PLACEHOLDER_PREFIX = 'REDACTED';

export function buildPiiPlaceholder(
  { category, ordinal }: { category: PiiCategory; ordinal: number },
): string {
  return `[${PII_PLACEHOLDER_PREFIX}:${category.toUpperCase()}#${ordinal}]`;
}

// ============== TRACE MARKER ==============

/**
 * A chave que o trace ganha quando houve redação: `{ "piiRedacted": { "cpf": 1 } }`.
 *
 * É o `changed_fields` da `029` traduzido — registra QUE redigiu, quantos
 * valores DISTINTOS por categoria, e nunca o dado. Ausente quando nada foi
 * redigido: uma chave zerada em todo step só gastaria espaço no teto do payload.
 */
export const PII_TRACE_KEY = 'piiRedacted';

// ============== PATTERNS ==============

/**
 * Candidato a CPF: 11 dígitos com `.`, `-` ou espaço em qualquer arranjo —
 * `52998224725`, `529.982.247-25` e `529 982 247 25` são o mesmo dado.
 *
 * 📌 Casar aqui NÃO redige: é só o candidato. O dígito verificador decide
 * (`isValidCpf`), e é ele que separa um CPF de um protocolo de 11 dígitos.
 *
 * ⚠️ CNPJ não casa por construção — a `/` de `12.345.678/0001-90` não está na
 * classe de separadores, então a sequência quebra antes de fechar 11 dígitos.
 */
export const CPF_CANDIDATE_PATTERN = /\d{3}[.\- ]?\d{3}[.\- ]?\d{3}[.\- ]?\d{2}/g;

/** Candidato a telefone BR, com ou sem `+55`, parênteses e separadores. */
export const PHONE_CANDIDATE_PATTERN = /(?:\+55[ -]?)?\(?\d{2}\)?[ -]?\d{4,5}[ -]?\d{4}/g;

export const CPF_DIGIT_COUNT = 11;
export const MOBILE_DIGIT_COUNT = 11;
export const LANDLINE_DIGIT_COUNT = 10;

/** Celular brasileiro carrega o nono dígito; é ele que torna o número inequívoco. */
export const MOBILE_NINTH_DIGIT = '9';

/** Assinaturas de fixo no Brasil: o número começa em 2–5. */
export const LANDLINE_FIRST_DIGITS: readonly string[] = ['2', '3', '4', '5'];

/**
 * DDDs em uso no Brasil. A lista existe para que `1234567890` — dez dígitos
 * quaisquer — não vire telefone só por ter o tamanho certo.
 */
export const BRAZILIAN_AREA_CODES: readonly string[] = [
  '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '21', '22', '24', '27', '28',
  '31', '32', '33', '34', '35', '37', '38',
  '41', '42', '43', '44', '45', '46', '47', '48', '49',
  '51', '53', '54', '55',
  '61', '62', '63', '64', '65', '66', '67', '68', '69',
  '71', '73', '74', '75', '77', '79',
  '81', '82', '83', '84', '85', '86', '87', '88', '89',
  '91', '92', '93', '94', '95', '96', '97', '98', '99',
];
