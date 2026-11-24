# 🔁 O caminho de volta da redação — o que falta no motor

**Estado:** não implementado. Este documento registra o mecanismo, o que o port exige e as guardas
que ele cobra, para que a ausência seja escolha e não esquecimento.

---

## O que existe hoje

`src/middleware/piiRedaction.ts` faz a **ida**, e só ela:

```ts
const scope = createRedactionScope();
scope.redactText('cpf 086.166.301-20 e (11) 98765-4321');
// → 'cpf [REDACTED:CPF#1] e [REDACTED:PHONE#1]'

Object.keys(scope);   // → redactText, counts
```

O escopo expõe `redactText` e `counts`. **Não há `restore`.**

---

## Por que isso é meia funcionalidade, e meia parece inteira

Quem abre o motor vê a redação, conclui que o assunto está resolvido, e grava o marcador.

⛔ **O marcador é véu para o MODELO, e para mais ninguém.** O banco guarda o dado verdadeiro, e a
tela mostra o dado verdadeiro — quem conversa com o agente é o dono do dado, e devolver-lhe
`[REDACTED]` é o sistema escondendo dele o que ele mesmo escreveu. Sem a volta:

| o que acontece | consequência |
|---|---|
| o agente grava uma memória | `Telefone de contato: [REDACTED:PHONE#1]` persiste para sempre — recuperável pela busca, e sem telefone nenhum dentro |
| a resposta chega à tela | o usuário lê um marcador no lugar da própria frase |

O projeto de origem do motor tem a volta e a usa nesses dois pontos. Ela ficou para trás na
extração.

---

## O que o port exige — não é copiar a função

### 1. O escopo precisa SAIR do middleware

Hoje ele nasce e morre dentro do `transform`:

```ts
transform(messages) {
  const scope = createRedactionScope();        // ← nasce
  const redacted = messages.map(/* … */);
  return scope.counts() === null ? messages : redacted;
}                                               // ← e morre, com o mapa dentro
```

Não há de onde restaurar. O motor precisa de uma forma de entregar o escopo ao chamador — escopo
recebido por parâmetro, ou devolvido por retorno de chamada —, e a escolha carrega a decisão
seguinte.

### 2. A unidade do escopo é uma vedação, não um detalhe

🔴 **Os ordinais só significam algo dentro do escopo que os atribuiu.** O `#1` de um mapa não é o
`#1` de outro. Restaurar com o escopo errado **devolve o dado de outra pessoa** — o único erro
pior que mostrar o marcador.

A unidade tem de ser declarada e provada por caso: no projeto de origem é **um escopo por turno**,
e o mesmo escopo atende o middleware, a gravação de memória e o passo do trace.

### 3. O modelo reescreve o marcador

Medido em produção: mandaram salvar `[REDACTED:CPF#1]` íntegro, e o modelo devolveu a forma
enfeitada — espaço estreito e reticências. A troca por texto exato não casa, e a tela mostra o
enfeite no lugar do dado.

⛔ A restauração precisa de **duas passadas**: a primeira troca o texto exato, a segunda procura o
padrão exigindo só o par **categoria + ordinal**, que é o mínimo que ainda identifica QUAL valor
restaurar. Marcador que perdeu os dois **fica como está** — adivinhar devolveria o dado de outra
pessoa.

---

## A guarda vai junto, ou não vai nada

⛔ **`restore` é arma carregada.** Chamado antes da saída para o provedor, desfaz a proteção
inteira pela porta dos fundos, e nenhum outro teste perceberia: a suíte continuaria verde sobre um
motor que não protege nada.

A entrega precisa incluir o caso que **lê a cadeia de middleware e falha** se encontrar um
`restore` na fase que antecede o provedor. É assim no projeto de origem, e é a única coisa que
impede o desfazimento silencioso.

⚠️ E o caso precisa de controle positivo: plantar um `restore` na cadeia e exigir vermelho. Guarda
que nunca foi vista reprovar é guarda que ninguém sabe se funciona.

---

## Ordem de execução

1. `IRedactionScope` ganha `restore(text)`, e o escopo guarda o mapa marcador → valor original
2. `createPiiRedactionMiddleware` passa a aceitar um escopo de fora, ou a entregar o seu
3. A segunda passada, por padrão, com o par categoria + ordinal
4. O caso que recusa `restore` na cadeia de saída, com controle positivo
5. `src/middleware/index.ts` exporta o que for público
6. O guia de quem consome: onde chamar, onde NUNCA chamar, e qual é a unidade do escopo

**Tamanho:** M. **Depende de:** nada — o trabalho é inteiro deste repositório.
