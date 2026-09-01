import type { Plugin } from 'vite';
// Same "./node" pre-bundled entry point pattern as
// vite-plugin-plugin-catalog.ts, for the same reason: this file is loaded by
// plain Node when Vite reads vite.config.ts, before any bundler exists.
import { PluginRegistry } from '@runflux/plugin-system/node';
import { runNode, runWorkflow, type PluginExecutionMode, type WorkflowDefinition } from '@runflux/validation-runtime/node';

/**
 * Dev-only: `POST /runflux-validate` runs a workflow (or a single node of
 * it) for real, in Vite's own Node process — the only place a plugin's
 * `execute` function (real JS, not JSON) can actually run (003-validation-runtime).
 *
 * Unlike `vite-plugin-plugin-catalog.ts`'s plugin catalog, there is no
 * production/build-time equivalent here: a plugin catalog is static data
 * that can be precomputed once at build time, but a validation run depends
 * on whatever workflow the developer has drawn *at that moment* — it cannot
 * be precomputed. A production build of the editor does not serve this
 * endpoint; a genuinely deployed instance of the editor would need a real
 * backend process for this, which is out of scope for this feature (see
 * roadmap.md, Premissas).
 */
export function runfluxValidationPlugin(pluginDirectories: string[]): Plugin {
  const urlPath = '/runflux-validate';

  async function discoverRegistry(): Promise<PluginRegistry> {
    const registry = new PluginRegistry();
    await registry.discover({ pluginDirectories });
    return registry;
  }

  return {
    name: 'runflux-validation-runtime',
    configureServer(server) {
      server.middlewares.use(urlPath, (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'method not allowed, use POST' }));
          return;
        }

        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk;
        });
        req.on('end', () => {
          void (async () => {
            const payload = JSON.parse(body) as {
              workflow: WorkflowDefinition;
              nodeId?: string;
              mode: PluginExecutionMode;
            };
            const registry = await discoverRegistry();
            const result = payload.nodeId
              ? await runNode(payload.workflow, payload.nodeId, registry, { mode: payload.mode })
              : await runWorkflow(payload.workflow, registry, { mode: payload.mode });
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result));
          })().catch((err: Error) => {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          });
        });
      });
    },
  };
}
