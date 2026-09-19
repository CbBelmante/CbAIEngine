/**
 * 🔧 errors — Erros de domínio compartilhados pelos dois adapters
 *
 * Ficam fora dos adapters porque os dois lançam os MESMOS erros: classes
 * duplicadas quebrariam o `instanceof` entre eles, e o teste não conseguiria
 * afirmar "os dois falham igual".
 */

// ============== ERRORS ==============

/**
 * O provider devolveu um tool-call que não vira `NToolCall.args`.
 *
 * Não entra em `types.ts` — aquele é o contrato neutro que o motor lê, e falha
 * de desserialização é assunto do adapter. Mesmo racional do
 * `StructuredOutputError`, que também mora ao lado de quem o lança.
 *
 * Lançar em vez de degradar para `{}`: o modelo PEDIU uma tool, e engolir o
 * pedido devolveria uma `NResponse` sintaticamente válida que mente sobre o que
 * o modelo quis — o loop seguiria sem a tool e ninguém saberia por quê. Erro de
 * domínio em vez do `SyntaxError` cru do `JSON.parse` para que quem trata saiba
 * QUAL tool-call quebrou e com que payload.
 */
export class ProviderParseError extends Error {
  override readonly name = 'ProviderParseError';
  readonly toolName: string;
  readonly toolCallId: string;
  readonly rawArguments: string;

  constructor(
    { toolName, toolCallId, rawArguments }:
    { toolName: string; toolCallId: string; rawArguments: string },
  ) {
    super(
      `Tool call "${toolName}" (id=${toolCallId}) carries arguments that are not a JSON object: `
      + `${rawArguments.slice(0, 200)}`,
    );
    this.toolName = toolName;
    this.toolCallId = toolCallId;
    this.rawArguments = rawArguments;
  }
}

/** O provider respondeu com status de erro. Guarda status e corpo truncado. */
export class ProviderHttpError extends Error {
  override readonly name = 'ProviderHttpError';
  readonly status: number;
  readonly body: string;

  constructor({ provider, status, body }: { provider: string; status: number; body: string }) {
    super(`Provider "${provider}" responded ${status}: ${body.slice(0, 500)}`);
    this.status = status;
    this.body = body;
  }
}
