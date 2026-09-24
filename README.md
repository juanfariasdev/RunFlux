# RunFlux

Criador visual de backends. O fluxo é um grafo de plugins que pode ser testado no editor e compilado em um projeto independente para Node.js/Express ou AWS Lambda/CDK.

O backend exportado contém código, configuração, dependências declaradas e instruções de execução. Ele não precisa do editor nem de um servidor RunFlux para executar.

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
npm test          # Tipos, testes dos workspaces e contratos de todos os plugins
npm run build    # Bundles Node, editor e conferência do catálogo produzido
npm run test:plugins  # Contratos, execução HTTP e compilação dos backends exportados
```

Os testes verificam o resultado dos módulos gerados, executam requisições HTTP locais e compilam projetos exportados com TypeScript estrito. PostgreSQL é substituído somente na fronteira do driver nesses testes; o deploy real em AWS não faz parte da suíte.

## Estrutura

| Diretório | Responsabilidade |
| --- | --- |
| `apps/workflow-editor` | Canvas, formulários, catálogo e testes interativos |
| `apps/project-server` | Persistência, versões, compilação e downloads |
| `packages/workflow-model` | Modelo do fluxo e ordenação do grafo |
| `packages/plugin-system` | Contratos, descoberta e componentes compartilhados dos plugins |
| `packages/expression-engine` | Interface de expressões sobre o avaliador canônico |
| `packages/validation-runtime` | Execução e validação no editor |
| `packages/compiler` | Grafo executável, geração local/AWS e empacotamento |
| `plugins` | Os 11 plugins disponíveis |
| `tests` | Contratos entre plugins, editor e projetos compilados |

Consulte [arquitetura e contratos](docs/architecture.md) e [análise dos plugins e validação](docs/plugin-audit.md) antes de adicionar um plugin.

## Escopo atual

O editor está preparado para desenvolvimento local. Sua execução interativa usa middleware do Vite; servir apenas o build estático não disponibiliza esse serviço. Projetos compilados têm seus próprios pontos de entrada.

O plugin de banco executa PostgreSQL no modo `production` e usa registros simulados no modo `sandbox`. O plugin Code executa JavaScript com os privilégios do processo Node; o modo sandbox do editor não é uma barreira de isolamento para código não confiável. O trigger manual está declarado apenas para o destino local.
