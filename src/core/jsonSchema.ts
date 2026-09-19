/**
 * 🎯 jsonSchema — Validador mínimo de JSON Schema, sem dependência externa
 *
 * É o que torna a saída estruturada uma garantia nossa em vez de promessa do
 * modelo: `JSON.parse` aceita campo faltando, enum errado e número no lugar de
 * string, e a divergência só explode no consumidor. Aqui ela é detectada na
 * volta em que aconteceu, com o caminho do campo e o motivo.
 *
 * ⚠️ LIMITE DECLARADO (ADR §3.13): cobre `type`, `properties`, `required`,
 * `enum` e `items`. NÃO cobre `anyOf`/`oneOf`/`allOf`, `$ref`,
 * `additionalProperties`, `format` nem limites numéricos — e ignora keyword não
 * suportada EM SILÊNCIO, dando o ramo por válido. `type` é a única que reclama.
 * Schema fora desse conjunto fica sub-validado sem aviso.
 */

// ============== TYPES ==============

export interface ISchemaViolation {
  /** Caminho do campo na notação `$.a.b[0]`. */
  path: string;
  message: string;
}

export interface IValidationResult {
  valid: boolean;
  violations: ISchemaViolation[];
}

interface IValidationTarget {
  value: unknown;
  schema: Record<string, unknown>;
  path: string;
}

// ============== CONSTANTS ==============

export const ROOT_PATH = '$';

const TYPE_PREDICATES: Record<string, (value: unknown) => boolean> = {
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number' && Number.isFinite(value),
  integer: (value) => typeof value === 'number' && Number.isInteger(value),
  boolean: (value) => typeof value === 'boolean',
  object: (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  array: (value) => Array.isArray(value),
  null: (value) => value === null,
};

// ============== HELPERS ==============

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asSchema(value: unknown): Record<string, unknown> | null {
  return isPlainObject(value) ? value : null;
}

function joinPath(parent: string, key: string): string {
  return `${parent}.${key}`;
}

function describeValue(value: unknown): string {
  if (value === null) { return 'null'; }
  if (Array.isArray(value)) { return 'array'; }
  return typeof value;
}

// ============== RULES ==============

function checkType({ value, schema, path }: IValidationTarget): ISchemaViolation[] {
  const type = schema['type'];
  if (typeof type !== 'string') { return []; }

  const predicate = TYPE_PREDICATES[type];
  if (!predicate) {
    return [{ path, message: `unsupported schema type "${type}"` }];
  }
  if (!predicate(value)) {
    return [{ path, message: `expected ${type}, got ${describeValue(value)}` }];
  }
  return [];
}

function checkEnum({ value, schema, path }: IValidationTarget): ISchemaViolation[] {
  const allowed = schema['enum'];
  if (!Array.isArray(allowed) || allowed.includes(value)) { return []; }

  const rendered: string[] = [];
  for (const option of allowed) {
    rendered.push(JSON.stringify(option));
  }
  return [{
    path,
    message: `expected one of ${rendered.join(' | ')}, got ${JSON.stringify(value)}`,
  }];
}

function checkRequired({ value, schema, path }: IValidationTarget): ISchemaViolation[] {
  const required = schema['required'];
  if (!Array.isArray(required) || !isPlainObject(value)) { return []; }

  const violations: ISchemaViolation[] = [];
  for (const key of required) {
    if (typeof key !== 'string' || key in value) { continue; }
    violations.push({ path: joinPath(path, key), message: 'required property is missing' });
  }
  return violations;
}

function checkProperties({ value, schema, path }: IValidationTarget): ISchemaViolation[] {
  const properties = asSchema(schema['properties']);
  if (!properties || !isPlainObject(value)) { return []; }

  const violations: ISchemaViolation[] = [];
  for (const [key, rawSchema] of Object.entries(properties)) {
    const propertySchema = asSchema(rawSchema);
    if (!propertySchema || !(key in value)) { continue; }
    violations.push(...collectViolations({
      value: value[key],
      schema: propertySchema,
      path: joinPath(path, key),
    }));
  }
  return violations;
}

function checkItems({ value, schema, path }: IValidationTarget): ISchemaViolation[] {
  const itemSchema = asSchema(schema['items']);
  if (!itemSchema || !Array.isArray(value)) { return []; }

  const violations: ISchemaViolation[] = [];
  for (let index = 0; index < value.length; index++) {
    violations.push(...collectViolations({
      value: value[index],
      schema: itemSchema,
      path: `${path}[${index}]`,
    }));
  }
  return violations;
}

// ============== VALIDATION ==============

function collectViolations(target: IValidationTarget): ISchemaViolation[] {
  // Tipo errado encerra o ramo: olhar `properties` de algo que nem é objeto só
  // produziria ruído em cima do erro que já foi reportado.
  const typeViolations = checkType(target);
  if (typeViolations.length > 0) { return typeViolations; }

  return [
    ...checkEnum(target),
    ...checkRequired(target),
    ...checkProperties(target),
    ...checkItems(target),
  ];
}

export function validateAgainstSchema(
  { value, schema }: { value: unknown; schema: Record<string, unknown> },
): IValidationResult {
  const violations = collectViolations({ value, schema, path: ROOT_PATH });
  return { valid: violations.length === 0, violations };
}

/** Renderiza as violações numa linha só — é o texto devolvido ao modelo no retry. */
export function formatViolations(violations: ISchemaViolation[]): string {
  const lines: string[] = [];
  for (const violation of violations) {
    lines.push(`${violation.path}: ${violation.message}`);
  }
  return lines.join('; ');
}
