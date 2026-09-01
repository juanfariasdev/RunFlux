import type { Plugin } from 'vite';
// Uses the "./node" subpath — a pre-bundled, extension-complete entry point
// (see packages/plugin-system/package.json, `build:node`) — because this file
// is loaded by plain Node when Vite reads vite.config.ts, BEFORE any bundler
// exists. The package's default extensionless-import style (its main "."
// export) only resolves under a bundler (Vite/esbuild/vitest), not under
// Node's native ESM loader. Run `npm run build:node -w @runflux/plugin-system`
// after changing plugin-system's source, or wire it into the workspace build.
import { PluginRegistry, listPlugins } from '@runflux/plugin-system/node';

/**
 * Node-side Vite plugin (this file runs inside vite.config.ts's own process —
 * NEVER bundled for the browser). It is the resolution to the gap documented
 * in roadmap.md (D-09/D-10): PluginRegistry.discover() needs `node:fs` and
 * cannot run in a browser bundle. This plugin runs discovery here, in Vite's
 * own Node process, and exposes the result at a fixed URL:
 *
 * - Dev server: a middleware re-runs discovery on every request to that URL
 *   (so newly added plugins show up without restarting).
 * - Production build: discovery runs once at build time and the result is
 *   emitted as a static JSON asset at the same URL.
 *
 * The browser only ever does `fetch('/runflux-plugins.json')` — see
 * src/adapters/plugin-catalog-adapter.ts, HttpPluginCatalogAdapter.
 */
export function runfluxPluginCatalogPlugin(pluginDirectories: string[]): Plugin {
  const urlPath = '/runflux-plugins.json';

  async function discover() {
    const registry = new PluginRegistry();
    await registry.discover({ pluginDirectories });
    return listPlugins(registry);
  }

  return {
    name: 'runflux-plugin-catalog',
    configureServer(server) {
      server.middlewares.use(urlPath, (_req, res) => {
        discover()
          .then((data) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          })
          .catch((err: Error) => {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          });
      });
    },
    async generateBundle() {
      const data = await discover();
      this.emitFile({ type: 'asset', fileName: urlPath.slice(1), source: JSON.stringify(data) });
    },
  };
}
