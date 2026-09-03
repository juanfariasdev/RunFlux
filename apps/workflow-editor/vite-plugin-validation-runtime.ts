import type { Plugin } from 'vite';
import { PluginRegistry } from '@runflux/plugin-system/node';
import { runNode, runWorkflow, type PluginExecutionMode, type WorkflowDefinition } from '@runflux/validation-runtime/node';

/**
 * Dev-only: `POST /runflux-validate` runs a workflow (or a single node of
 * it) for real, in Vite's own Node process — the only place a plugin's
 * `execute` function (real JS, not JSON) can actually run (003-validation-runtime).
 *
 * It also provides `/runflux-webhook-test/*` to receive real HTTP events
 * from curl or third-party webhooks during interactive node testing.
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
      // 1. Interactive test webhook receiver (E001: waiting for webhook payload)
      server.middlewares.use((req, res, next) => {
        const parsedUrl = req.url || '';
        if (!parsedUrl.startsWith('/runflux-webhook-test') && !parsedUrl.startsWith('/api/webhooks/test')) {
          return next();
        }

        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk;
        });
        req.on('end', () => {
          void (async () => {
            let parsedBody: any = {};
            if (body) {
              try {
                parsedBody = JSON.parse(body);
              } catch {
                parsedBody = body;
              }
            }

            const urlObj = new URL(parsedUrl, 'http://localhost');
            const query: Record<string, string> = {};
            urlObj.searchParams.forEach((val, key) => {
              query[key] = val;
            });

            // Deliver payload to the active waiting trigger-webhook node in memory
            const { pushTestWebhook } = await import('../../plugins/trigger-webhook/index.js');
            const subPath =
              urlObj.pathname.replace(/^\/runflux-webhook-test/, '').replace(/^\/api\/webhooks\/test/, '') ||
              '/webhook';

            const delivered = pushTestWebhook(subPath, {
              body: parsedBody,
              headers: req.headers,
              query,
              method: req.method || 'POST',
            });

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                success: true,
                captured: delivered,
                message: delivered
                  ? 'Webhook captured! The waiting test in RunFlux has completed.'
                  : 'Webhook payload received, but no node was actively waiting for it. Click "Test this node" in the editor first.',
                data: parsedBody,
              })
            );
          })().catch((err: Error) => {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          });
        });
      });

      // 2. Node & workflow validation runner
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
