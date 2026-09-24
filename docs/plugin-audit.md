# Análise dos plugins e validação

## Catálogo

Os 11 plugins passam por descoberta, validação de manifesto, carregamento do runtime e empacotamento nos backends exportados. O catálogo também é verificado em Node puro, sem Vitest, e no build final do editor.

| Plugin | Componentes do runtime | Comportamentos cobertos |
| --- | --- | --- |
| `trigger-manual-example` | `Clock` | Payload, label, timestamp e destino apenas local |
| `trigger-webhook` | `TriggerEventSource`, `FieldComposer` | Formato da requisição, espera por teste, cancelamento, payload de exemplo só em teste; rota normalizada, método, segredo (nome de header e de variável válidos) e corpo bruto (deployment) |
| `trigger-cron` | `Clock`, `CronExpression` | Payload agendado; expressão e fuso validados; sugestões de agendamento; agendamento local e EventBridge (deployment) |
| `condition-if` | `ConditionEvaluator`, leitores de condição | Saídas true/false, and/or, comparação estrita, operadores inválidos |
| `condition-switch` | `ConditionEvaluator`, leitores de condição | Primeira regra verdadeira, fallback, limite de cinco regras |
| `filter` | `ConditionEvaluator`, leitores de condição | Passagem e encerramento do ramo sem erro |
| `set` | `FieldComposer`, `readFields` | Tipos, expressões, campos ausentes, campos no formato de objeto, preservação da entrada |
| `code-javascript` | — | Código assíncrono, `$json`, `$node`, `$env`, código literal, falhas |
| `http-output` | `HttpClient` | Método, headers, corpo, resposta, falhas HTTP e de transporte, configuração inválida |
| `log-output` | `Logger` | Registro e preservação do payload |
| `database-query` | `DatabaseClient`, `PostgresClient` | SQL literal obrigatório e valores vinculados, first/all, conexão como `{{$env.NOME}}` (nome puro ainda aceito), variável obrigatória e com nome válido, sandbox que testa a conexão com `SELECT 1` e simula as linhas, pools próprios fechados no dispose, cliente injetado preservado |

## Evidências reproduzíveis

- Cada plugin tem testes próprios, pelo harness `executeNode`, para sucesso, configuração inválida e falhas.
- `tests/plugins/parity.test.ts` executa cada plugin no editor e no backend exportado e exige o mesmo resultado.
- `tests/compiler/exported-local.test.ts` e `exported-aws.test.ts` compilam, gravam, constroem e executam os backends: HTTP com autenticação, merges, roteamento, processo do servidor na porta que ele informa e desligamento limpo com SIGTERM, worker cron com SIGINT, CLI, handler Lambda e síntese da stack CDK (com e sem function URL, código a partir de `dist/`).
- `tests/compiler/build.test.ts` executa `npm run build` do próprio projeto exportado, com todos os plugins e apenas as dependências que o `package.json` declara, e o `tsc` estrito do projeto.
- `tests/examples/` executa os três workflows de `examples/` (API HTTP, CRUD PostgreSQL e Switch) no teste do editor, no app Express exportado, no processo `node dist/server.mjs` e no handler Lambda. O banco é um PostgreSQL real (PGlite, servido pelo protocolo do PostgreSQL) acessado pelo driver `pg` do backend, e as chamadas HTTP de saída vão para um servidor local. Os testes exigem que todos os nós de cada exemplo executem, e o servidor de projetos importa, compila e oferece o download de cada exemplo.
- `tests/plugins/editor-dev-server.test.ts` cobre o servidor do editor: cache do registro de plugins e sua invalidação, catálogo, erros 400/405 e cancelamento de uma execução de teste quando o cliente desconecta.
- `tests/plugins/database.test.ts` substitui o PostgreSQL apenas no driver: um mock no editor e um pacote `pg` falso no backend exportado.

`npm test` executa os tipos (pacotes, testes e templates), os testes de todos os workspaces e `tests/`. `npm run build` compara o catálogo estático com os manifestos descobertos. O pipeline em `.github/workflows/ci.yml` repete instalação, geração do cliente Prisma, testes e build.

## Limites da validação

- Disponibilidade, TLS, permissões e comportamento de um PostgreSQL real precisam de validação no ambiente de destino.
- A suíte sintetiza a stack AWS, mas não provisiona recursos nem faz deploy em uma conta real.
- O build estático do editor contém o catálogo, mas as execuções interativas dependem do middleware de desenvolvimento do Vite.
- O plugin Code executa JavaScript com os privilégios do processo: o modo sandbox não isola código não confiável.
- O trigger manual existe apenas para o destino local, e PostgreSQL é o único banco implementado.
