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
files and the npm packages declared in `deployment.dependencies`.

## Discovery

```ts
import { PluginRegistry } from '@runflux/plugin-system';

const registry = new PluginRegistry();
const { errors } = await registry.discover({ pluginDirectories: ['plugins'] });
registry.resolve('log-output'); // NodeDefinition — the registry is a NodeCatalog
registry.get('log-output');     // manifest, runtimeModule, deployment, definition
```

A malformed plugin (invalid manifest, missing `runtimeModule`, a runtime without a node definition)
is reported in `errors` and never stops discovery of the others. Imports carry the file's
modification stamp, so a plugin edited while the editor runs is loaded again.

Plain Node consumers (the Vite plugins, `scripts/`) import the pre-bundled `@runflux/plugin-system/node`
entry, rebuilt by `npm run build:node`.

## Other modules

- `webhook-test-hub`: delivers requests sent to a webhook's test URL to the trigger waiting for it.
- `deployment`: the `PluginDeployment` contract the compiler reads.
- `testing`: `testPlugin()` builds a registrable plugin for tests.
- `api/list-plugins`, `api/check-plugin-reference`: the editor palette and version checks.
