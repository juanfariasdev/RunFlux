# @runflux/plugin-system

Discovery, manifest validation, and generator resolution for RunFlux plugins.

## Package boundary

This package is consumed by other packages/plugins via its name and subpath
exports — never via a relative path into its `src/`:

```ts
import { PluginRegistry } from '@runflux/plugin-system';
import { validateManifest } from '@runflux/plugin-system/manifest-validator';
import type { PluginModule } from '@runflux/plugin-system/types';
```

See `package.json#exports` for the full list of subpaths. A real plugin lives
in its own package (see `plugins/trigger-manual-example` for the reference
implementation) and only ever imports from `@runflux/plugin-system`, never
reaches into this package's internals by relative path.

> This is a workspace-local, source-resolved package (`exports` point at
> `.ts` files, not a `dist/` build) — fine for development via npm workspaces,
> vitest and `tsc`. A real build step (emitting `dist/`) is needed before this
> package can be published or consumed outside this workspace.

## Try it (manual walkthrough)

1. Look at `plugins/trigger-manual-example/` for a minimal plugin package: it
   exports a `manifest` (id, category, version, parameters, supported
   platforms) and a `generators` map (one function per supported platform),
   and depends on `@runflux/plugin-system` like any other consumer.
2. Discover it:

   ```ts
   import { PluginRegistry } from '@runflux/plugin-system';
   import { consoleDiscoveryLogger } from '@runflux/plugin-system/discovery/logger';

   const registry = new PluginRegistry();
   await registry.discover({
     pluginDirectories: ['../../plugins'],
     onLog: consoleDiscoveryLogger,
   });
   ```

3. List what was discovered:

   ```ts
   import { listPlugins } from '@runflux/plugin-system/api/list-plugins';
   console.log(listPlugins(registry));
   // { trigger: [{ id: 'trigger-manual-example', ... }] }
   ```

4. Resolve and run its generator:

   ```ts
   import { resolveGenerator } from '@runflux/plugin-system/api/resolve-generator';
   const generate = resolveGenerator(registry, 'trigger-manual-example', 'local');
   const artifact = generate({ label: 'hello' }, { workflowId: 'wf-1', nodeId: 'n1' });
   ```

5. Ask for an unsupported platform (e.g. `'aws'`) and see the clear error
   instead of a crash — this is what `workflow-editor`/`compiler` will surface
   to the user (EC-03).

For malformed-plugin handling and the full requirement list, see
`_reversa_sdd/sdd/plugin-system.md` and `_reversa_forward/001-plugin-system/onboarding.md`
in the RunFlux planning repo.

## Tests

Every module has a dedicated test file next to it (or in its `__tests__/`
folder): `manifest-validator`, `manifest-serializer`, `plugin-registry`,
`discovery/directory-scanner`, `discovery/package-scanner`,
`api/list-plugins`, `api/resolve-generator`. Run with `npm test` from this
package, or `npm test` at the workspace root to run every package's suite.
