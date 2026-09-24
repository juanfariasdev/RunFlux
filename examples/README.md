# Exemplos de workflows

Três projetos prontos para importar no editor. Cada um reúne vários fluxos no mesmo workflow, e os testes em `tests/examples/` executam todos eles no editor e nos backends exportados.

| Arquivo | Conteúdo | Nós |
| --- | --- | --- |
| `http-api.runflux.json` | GET, POST, PUT, PATCH e DELETE com resposta, corpo bruto em qualquer método, chamadas de saída GET/POST/PUT/DELETE | 28 |
| `database-crud.runflux.json` | CRUD em PostgreSQL: schema, validação, filtros, jsonb, reajuste em lote, estatísticas, relatório agendado | 34 |
| `switch-routing.runflux.json` | Switch com cinco regras e fallback, Switch sem fallback, Switch acionado por agendamento | 22 |

## Como usar

1. Grave os exemplos como projetos no banco do editor:

   ```bash
   npm run examples:seed
   ```

   Rodar de novo atualiza um projeto cujo exemplo mudou, como nova versão, e mantém os valores de variáveis que você já configurou. Também dá para importar um arquivo pelo editor, em **📁 Projetos → Importar (.json)**.
2. Para o exemplo de banco, suba um PostgreSQL local. Não precisa de Docker: é o PGlite, com os dados em `.runflux/examples-postgres`.

   ```bash
   npm run examples:postgres   # PostgreSQL em localhost:5432, o DATABASE_URL padrão do exemplo
   ```

3. Abra o projeto, escolha **Production** (em **Sandbox**, o nó de banco simula as linhas), clique em **Test** e envie requisições para a URL de teste de cada webhook, com o método que ele atende. As execuções de teste usam as variáveis do projeto como `$env`.

   ```bash
   curl -X POST http://localhost:5173/runflux-webhook-test/items -H 'Content-Type: application/json' -d '{"name":"Monitor","price":899.9}'
   ```

   No exemplo de banco, comece por `POST /setup`. No editor, o cabeçalho `X-Admin-Key` não é verificado.
4. Compile para **Local** ou **AWS**, baixe o `.zip` e siga o README do projeto gerado. No backend local, as mesmas rotas respondem em `http://localhost:3000`.

A resposta de todo webhook é `{ success, result, nodeOutputs }`. `result` é a saída do último nó do ramo que executou.

## API HTTP (`http-api`)

| Rota | O que faz | Resposta |
| --- | --- | --- |
| `GET /items?category=&limit=` | Filtra um catálogo (Code) | `{ items, count, filters }` |
| `POST /items` | Valida nome e preço (If), cria e registra em log | `{ status: 'created', name, price, slug }` ou `{ status: 'rejected', error }` |
| `PUT /items?id=` | Substitui o item; exige `X-Api-Key` | `{ status: 'replaced', id, name, price }` |
| `PATCH /items?id=` | Altera só os campos enviados; exige `X-Api-Key` | `{ status: 'updated', id, changes }` ou `{ status: 'unchanged' }` |
| `DELETE /items?id=` | Remove o item informado | `{ status: 'deleted', id }` ou `{ status: 'rejected' }` |
| `ANY /echo` | Recebe o corpo bruto em qualquer método | `{ received, length, contentType }` |
| `POST /proxy` | Repassa `{ method, path, payload }` para `UPSTREAM_URL` (HTTP Request) | `{ upstreamStatus, upstream }` |
| `GET /upstream/health` | Chama GET, POST, PUT e DELETE em paralelo e junta as respostas | `{ healthy, checks }` |

Variáveis: `ITEMS_API_KEY` (segredo de PUT e PATCH) e `UPSTREAM_URL` (API chamada por `/proxy` e `/upstream/health`; o padrão, `https://httpbin.org/anything`, devolve cada requisição recebida).

## CRUD PostgreSQL (`database-crud`)

| Rota | O que faz |
| --- | --- |
| `POST /setup` | Cria a tabela `products` (idempotente); exige `X-Admin-Key` |
| `POST /setup/reset` | Esvazia a tabela e reinicia os ids; exige `X-Admin-Key` |
| `POST /products` | Valida e insere (`INSERT … RETURNING *`); um `sku` repetido falha com a violação de unicidade |
| `GET /products?search=&active=&limit=` | Lista com filtros; com `?id=`, retorna um produto ou `null` |
| `PUT /products?id=` | Atualiza só os campos enviados (`COALESCE`), inclusive as tags `jsonb` |
| `DELETE /products?id=` | Remove e retorna `id` e `sku`, ou `{ error: 'product not found' }` |
| `POST /products/reprice` | Reajusta em uma única instrução os preços dos produtos ativos; exige `X-Admin-Key` |
| `GET /products/stats` | Junta duas consultas pelo `$node`: totais, valor em estoque e tags distintas |
| Agendamento de hora em hora | Conta os produtos ativos e registra em log |

Os valores chegam ao SQL sempre como parâmetros (`$1`, `$2`…), e o SQL é literal. O Docker Compose do projeto exportado já sobe um PostgreSQL. Dentro do Compose, use `postgres` como host em `DATABASE_URL`. Variáveis: `DATABASE_URL` e `ADMIN_KEY`.

## Switch (`switch-routing`)

- `POST /tickets`: cinco regras, avaliadas em ordem (vence a primeira que casar):
  1. urgente ou cliente VIP (`or`);
  2. reembolso com valor acima de 0 (`and`), com um If que separa reembolsos acima de 1000;
  3. e-mail de parceiro (`endsWith`);
  4. tag `bug` (`contains` em lista);
  5. nota até 3 (`lessThanOrEqual`, também com texto).

  O fallback manda o ticket para a fila geral, e todas as filas convergem para um log.
- `POST /tickets/triage`: Switch sem fallback, com `notEquals`, `isEmpty`, `startsWith`, `regex`, `greaterThanOrEqual` e `notContains`. Um ticket que nenhuma regra aceita encerra o ramo sem erro.
- A cada 6 horas: o Switch escolhe o resumo da manhã ou da noite pela hora do disparo.

## Como os exemplos são testados

`tests/examples/` executa cada fluxo em quatro backends:

1. **Teste do editor**: o workflow inteiro roda como no botão **Test**, e a requisição vai para o webhook que espera aquele método e caminho.
2. **App Express exportado**: montado em processo a partir do runtime do `vendor/`.
3. **Processo do servidor exportado**: `node dist/server.mjs`, acessado por HTTP e encerrado com SIGTERM.
4. **Handler Lambda exportado**: `dist/handler.mjs`, com eventos de function URL e do EventBridge.

O banco é um PostgreSQL real (PGlite) acessado pelo driver `pg` do backend. A API externa é um servidor HTTP local. Os testes também:

- validam a estrutura de cada arquivo (todo nó é alcançável a partir de um trigger, saídas declaradas, variáveis declaradas);
- sintetizam a stack AWS;
- importam cada exemplo pela API do servidor de projetos, compilam e baixam o `.zip`;
- exigem que todos os nós de cada workflow executem ao menos uma vez.
