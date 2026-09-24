# @runflux/plugin-system

Plugin contracts, discovery and registry, manifest validation and the editor-side services around
plugins. Node execution lives in `@runflux/runtime`; see `docs/architecture.md` for the contract.

## A plugin package

```
plugins/log-output/
  index.ts      manifest, runtimeModule (URL of runtime.ts), optional deployment
  runtime.ts    default export: the NodeDefinition; the handler class
  __tests__/    executeNode-based tests (success, invalid configuration, failures)
```

`runtime.ts` is bundled into exported backends, so it may import only `@runflux/runtime`, its own
files and the npm packages declared in `deployment.dependencies`. `index.ts` never imports
`runtime.ts`; what both need lives in modules of its own (`parameters.ts`, `schedule.ts`…).

Manifest parameters describe their editor presentation: `options` (with `allowCustomOptions` for
suggestions), `showWhen`, `language` and `rowSchema`. `validateManifest` checks them.

## Discovery

```ts
import { PluginRegistry } from '@runflux/plugin-system';

const registry = new PluginRegistry();
const { errors } = await registry.discover({ pluginDirectories: ['plugins'] });
registry.resolve('log-output'); // NodeDefinition — the registry is a NodeCatalog
registry.get('log-output');     // manifest, runtimeModule, deployment, definition
```

A malformed plugin (invalid manifest, missing `runtimeModule`, a runtime without a node definition)
is reported in `errors` and never stops discovery of the others. A plugin edited while the editor
runs is loaded again by the next discovery: TypeScript plugins go through tsx, which never caches,
so their helper modules reload too; JavaScript plugins keep Node's own semantics, and their entry
and runtime URLs carry the file's modification stamp (helpers they import stay cached until the
process restarts).

Plain Node consumers (the Vite plugins, `scripts/`) import the pre-bundled `@runflux/plugin-system/node`
entry, rebuilt by `npm run build:node`.

## Other modules

- `condition-row-schema`, `fields-row-schema`: shared row shapes. `OPERATOR_OPTIONS` lists every
  operator the runtime's `ConditionEvaluator` implements; the right value hides for unary ones.
- `visibility`: `isParameterVisible` (a parameter's `showWhen`) and `isRowFieldHidden` (a row
  field's `hideWhen`), shared by the editor and its tests.
- `webhook-test-hub`: delivers requests sent to a webhook's test URL to the trigger waiting for it,
  comparing paths the way the exported backends route them.
- `deployment`: the `PluginDeployment` contract the compiler reads.
- `testing`: `testPlugin()` builds a registrable plugin for tests.
- `api/list-plugins`, `api/check-plugin-reference`: the editor palette and version checks.
