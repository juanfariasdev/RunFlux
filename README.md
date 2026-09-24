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

## Verificação

```sh
npm test              # Tipos (pacotes, testes e templates), testes dos workspaces e de tests/
npm run build         # Bundles Node, editor e conferência do catálogo produzido
npm run test:plugins  # Paridade editor/backend, backends exportados, build e síntese CDK
```

Os testes compilam backends, gravam o projeto como o download, constroem `dist/` e executam o resultado: requisições HTTP, processo do servidor, CLI, cron, handler Lambda e síntese da stack CDK. Cada plugin é executado no editor e no backend exportado com a exigência do mesmo resultado. PostgreSQL é substituído somente na fronteira do driver; o deploy real em AWS não faz parte da suíte.

## Estrutura

| Diretório | Responsabilidade |
| --- | --- |
| `apps/workflow-editor` | Canvas, formulários, catálogo e testes interativos |
| `apps/project-server` | Persistência, versões, compilação e downloads |
| `packages/workflow-model` | Modelo do fluxo e ordenação do grafo |
| `packages/runtime` | Motor, expressões, condições, campos, HTTP e hosts Express/Lambda/cron/CLI, iguais no editor e nos backends |
| `packages/plugin-system` | Contrato de plugin, descoberta, registro e hub de webhooks de teste |
| `packages/expression-engine` | Expressões dos previews do editor, sobre o avaliador do runtime |
| `packages/validation-runtime` | Execuções de teste do editor sobre o motor do runtime |
| `packages/compiler` | Validação, plano de deployment, alvos local/AWS, templates e empacotamento do runtime |
| `plugins` | Os 11 plugins: `runtime.ts` executável e `index.ts` com manifesto e deployment |
| `tests` | Paridade entre editor e backend e execução dos projetos exportados |

Consulte [arquitetura e contratos](docs/architecture.md), [análise dos plugins e validação](docs/plugin-audit.md) e o [guia do runtime](packages/runtime/README.md) antes de adicionar um plugin.

## Escopo atual

O editor está preparado para desenvolvimento local. Sua execução interativa usa middleware do Vite; servir apenas o build estático não disponibiliza esse serviço. Projetos compilados têm seus próprios pontos de entrada.

O plugin de banco executa PostgreSQL no modo `production` e usa registros simulados no modo `sandbox`. O plugin Code executa JavaScript com os privilégios do processo Node; o modo sandbox do editor não é uma barreira de isolamento para código não confiável. O trigger manual está declarado apenas para o destino local.
