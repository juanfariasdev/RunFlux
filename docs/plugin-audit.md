# Análise dos plugins e validação

## Catálogo

Todos os 11 plugins participam de descoberta, validação de manifesto, conferência das plataformas declaradas e carregamento dos artefatos. O catálogo é verificado também em Node sem Vitest e no build final do editor.

| Plugin | Componentes compartilhados | Comportamentos cobertos |
| --- | --- | --- |
| `trigger-manual-example` | Fábrica de geradores | Payload, label, timestamp e destino local |
| `trigger-webhook` | Configuração e listener | Saída nomeada, headers/query, rota correta, cancelamento, autenticação e corpo bruto/JSON |
| `trigger-cron` | Fábrica de geradores; agendamento no compilador | Saída nomeada, múltiplos triggers, seleção de ramo, timezone e tradução AWS |
| `condition-if` | Operadores, expressões e contexto | Saídas true/false e paridade entre execução e código gerado |
| `condition-switch` | Operadores, expressões e contexto | Regras, seleção de saída e fallback |
| `filter` | Operadores, expressões e contexto | Filtragem, composição de regras e saídas |
| `set` | Composição de campos e expressões | Tipos, valores ausentes, expressões e preservação de campos |
| `code-javascript` | Contexto e fábrica de geradores | Código assíncrono, `$json`, `$node`, `$env` e preservação do código literal |
| `http-output` | Cliente HTTP e expressões | Método, headers, corpo, resposta e falhas na fronteira HTTP |
| `log-output` | Fábrica de geradores | Registro estruturado e preservação do payload |
| `database-query` | Runtime PostgreSQL e expressões | Pool, SQL parametrizado, modos first/all, ambiente obrigatório e engine suportada |

## Problemas corrigidos

- Descoberta nativa omitia plugins TypeScript; o build podia terminar com apenas parte do catálogo.
- Serialização descartava metadados internos de parâmetros.
- Operadores e expressões tinham versões manuais divergentes no código gerado.
- Instâncias repetidas de plugins podiam receber o artefato errado conforme a ordem do canvas.
- Merges podiam executar antes de receber todos os pais; triggers e saídas eram inferidos incorretamente.
- Webhooks interativos podiam consumir eventos de outros caminhos e listeners previamente cancelados continuavam aguardando.
- Webhooks compilados não preservavam consistentemente autenticação, corpo, headers e query.
- O plugin de banco simulava uma consulta onde deveria executar SQL em produção.
- Compilação AWS aceitava suporte inventado e gerava configuração incompleta para múltiplos cron/webhooks.
- Falhas de build podiam resultar em download sinalizado como bem-sucedido; o ZIP não continha o projeto completo.
- Testes do servidor utilizavam o banco de desenvolvimento; agora cada execução cria, migra e remove um banco temporário.
- A verificação de tipos e os testes ignoravam parte dos projetos ou incluíam testes duplicados de `dist`.

## Evidências reproduzíveis

`npm test` executa os testes dos pacotes, plugins e aplicações, além de `tests/plugins` e `tests/compiler`. Estes últimos carregam o JavaScript efetivamente gerado, exercitam HTTP local, verificam catálogos e compilam projetos local/AWS com seus próprios `tsconfig.json` estritos. `npm run build` compara o catálogo estático com todos os manifestos descobertos.

O pipeline em `.github/workflows/ci.yml` repete instalação, geração do cliente Prisma, testes e build.

## Limites da validação

- O driver PostgreSQL é substituído nos testes de contrato. Disponibilidade, TLS, permissões e comportamento de um banco real precisam de validação no ambiente de destino.
- A suíte valida geração e compilação AWS; não provisiona recursos nem faz deploy em uma conta real.
- O build estático do editor contém o catálogo, mas a execução interativa depende do middleware de desenvolvimento do Vite.
- O modo sandbox é uma opção funcional dos plugins; código JavaScript e expressões não executam em um processo isolado.
- O trigger manual continua local conforme seu manifesto. PostgreSQL é o único banco implementado.
