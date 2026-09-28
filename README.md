# RunFlux

Criador visual de backends. O fluxo é um grafo de plugins que pode ser testado no editor e compilado em um projeto independente para Node.js/Express ou AWS Lambda/CDK.

O backend exportado contém o fluxo como dado (`src/workflow.json`), pontos de entrada em TypeScript, o runtime do RunFlux já compilado em `vendor/`, configuração e instruções de execução. Ele não precisa do editor nem de um servidor RunFlux para executar.

## Desenvolvimento

Requisitos: Node.js 22 ou superior e npm com suporte a workspaces.

```sh
npm ci
cp apps/project-server/.env.example apps/project-server/.env
npm run db:generate
npm run db:migrate
npm run dev:all
```

O servidor de projetos usa a porta 3001; o terminal do Vite informa o endereço do editor. O banco SQLite de desenvolvimento pertence ao servidor de projetos. A suíte de testes cria e migra um banco temporário independente.

## Executando a plataforma com segurança

- **Local por padrão.** O servidor de projetos escuta em `127.0.0.1`, e o editor o alcança pelo proxy `/api` do Vite. Nenhum token é pedido.
- **Exposto.** Com `HOST` num endereço de rede, o servidor só sobe com `RUNFLUX_API_TOKEN`. Use `HOST=0.0.0.0` (ou `::`): um IP específico deixa de escutar em `127.0.0.1`, que o proxy do editor e a leitura das variáveis dos testes usam. Com `HOST` assim, o servidor só sobe com `RUNFLUX_API_TOKEN` (no mínimo 32 caracteres), e toda rota `/api/*` exige `Authorization: Bearer <token>`. O editor pede o token na primeira resposta 401 e o guarda na sessão do navegador. Exporte o token no shell que roda `npm run dev:all` (`export RUNFLUX_API_TOKEN=$(openssl rand -base64 32)`): os dois processos o leem, e o `apps/project-server/.env` deste repositório é versionado, então não guarde segredos nele. O dev server do Vite também aceita o token desse `.env` quando ele não é versionado. Com `--host`, ele só sobe com o token, e seus endpoints de teste passam a exigi-lo. As URLs de teste de webhook continuam abertas enquanto um teste espera. Atrás de um proxy reverso na mesma máquina, defina o token mesmo sem `HOST`.
- **Limites.** Corpos acima de `RUNFLUX_BODY_LIMIT` (padrão `5mb`) recebem 413. Só as origens de `RUNFLUX_CORS_ORIGINS` leem respostas de um navegador.
- **Variáveis.** Os valores são gravados cifrados (AES-256-GCM) e nunca voltam em uma resposta nem aparecem no editor; os previews de `$env` mostram `••••••`. As execuções de teste leem os valores do servidor de projetos por uma rota interna, aceita só por loopback. A chave fica em `~/.runflux/secret.key` (ou em `RUNFLUX_SECRET_KEY`): faça backup dela junto com o banco. Projetos compilados levam os nomes e as descrições, com valores vazios.

## Verificação

```sh
npm test              # Tipos (pacotes, testes e templates), testes dos workspaces e de tests/
npm run build         # Bundles Node, editor e conferência do catálogo produzido
npm run test:plugins  # Paridade editor/backend, backends exportados, build e síntese CDK
```

Os testes compilam backends, gravam o projeto como o download, constroem `dist/` e executam o resultado: requisições HTTP, processo do servidor, CLI, cron, handler Lambda e síntese da stack CDK. Cada plugin é executado no editor e no backend exportado com a exigência do mesmo resultado. Os workflows de [`examples/`](examples/README.md) (API HTTP com todos os métodos, CRUD em PostgreSQL e Switch) rodam no teste do editor, no app Express, no processo do servidor e no handler Lambda exportados, contra um PostgreSQL real embutido (PGlite). O deploy real em AWS não faz parte da suíte.

## Estrutura

| Diretório | Responsabilidade |
| --- | --- |
| `apps/workflow-editor` | Canvas, formulários, catálogo e testes interativos |
| `apps/project-server` | Persistência, versões, compilação e downloads |
| `packages/workflow-model` | Modelo do fluxo e detecção de ciclos na edição |
| `packages/runtime` | Motor, expressões, condições, campos, HTTP e hosts Express/Lambda/cron/CLI, iguais no editor e nos backends |
| `packages/plugin-system` | Contrato de plugin, descoberta, registro e hub de webhooks de teste |
| `packages/expression-engine` | Expressões dos previews do editor, sobre o avaliador do runtime |
| `packages/validation-runtime` | Execuções de teste do editor sobre o motor do runtime |
| `packages/compiler` | Validação, plano de deployment, alvos local/AWS, templates e empacotamento do runtime |
| `plugins` | Os 12 plugins: `runtime.ts` executável e `index.ts` com manifesto e deployment |
| `examples` | Workflows de exemplo prontos para importar no editor |
| `tests` | Paridade entre editor e backend, execução dos projetos exportados e dos exemplos |

Consulte [arquitetura e contratos](docs/architecture.md), [análise dos plugins e validação](docs/plugin-audit.md) e o [guia do runtime](packages/runtime/README.md) antes de adicionar um plugin.

## Escopo atual

O editor está preparado para desenvolvimento local. Sua execução interativa usa middleware do Vite; servir apenas o build estático não disponibiliza esse serviço. Projetos compilados têm seus próprios pontos de entrada.

O plugin de banco executa PostgreSQL no modo `production`. No modo `sandbox`, ele só confirma a conexão com um `SELECT 1` e simula as linhas, sem executar o SQL configurado. A conexão é informada como `{{$env.NOME}}` (o padrão é `{{$env.DATABASE_URL}}`); projetos antigos, que guardavam só o nome da variável, são convertidos ao abrir. O plugin Code executa JavaScript com os privilégios do processo Node; o modo sandbox do editor não é uma barreira de isolamento para código não confiável. O trigger manual está declarado apenas para o destino local.
