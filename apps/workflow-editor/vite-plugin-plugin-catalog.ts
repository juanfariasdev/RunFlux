import type { Plugin } from 'vite';
// "./node" is the pre-bundled entry of plugin-system: this file runs in plain Node while Vite
// reads vite.config.ts, before any bundler exists (see packages/plugin-system/package.json,
// `build:node`, which the workspace build runs).
import { listPlugins } from '@runflux/plugin-system/node';
import type { PluginRegistryCache } from './vite-plugin-registry.ts';

/**
 * Serves the plugin catalog at `/runflux-plugins.json`. Discovery needs `node:fs`, so it runs in
 * Vite's Node process: the dev server answers from the shared registry (discovered again after
 * plugin files change) and a production build emits the catalog as a static asset at that URL.
 * The browser only fetches it; see src/adapters/plugin-catalog-adapter.ts.
 */
export function runfluxPluginCatalogPlugin(plugins: PluginRegistryCache): Plugin {
  const urlPath = '/runflux-plugins.json';

  return {
    name: 'runflux-plugin-catalog',
    configureServer(server) {
      plugins.watch(server);
      server.middlewares.use(urlPath, (_request, response) => {
        plugins.registry()
          .then((registry) => {
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify(listPlugins(registry)));
          })
          .catch((error: Error) => {
            response.statusCode = 500;
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ error: error.message }));
          });
      });
    },
    async generateBundle() {
      const catalog = listPlugins(await plugins.registry());
      this.emitFile({ type: 'asset', fileName: urlPath.slice(1), source: JSON.stringify(catalog) });
    },
  };
}
