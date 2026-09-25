import type { Plugin } from 'vite';
import { WebhookTestHub } from '@runflux/plugin-system/node';
import { createValidationHttpHandlers } from '@runflux/validation-runtime/node';
import type { PluginRegistryCache } from './vite-plugin-registry.ts';

/**
 * Dev-only endpoints of the editor, served from Vite's Node process, where the plugin runtimes are
 * loaded. The handlers come from @runflux/validation-runtime and only need `node:http`:
 * - `POST /runflux-validate` runs a workflow, or one node of it, with the validation runtime. A
 *   client that disconnects cancels its run.
 * - `/runflux-webhook-test/<path>` hands a request to the webhook trigger of a test run waiting on
 *   `<path>`, so curl or a third-party service can drive a test.
 * - `POST /runflux-webhook-cancel` stops every waiting webhook trigger.
 */
export function runfluxValidationPlugin(plugins: PluginRegistryCache): Plugin {
  // Webhook triggers of test runs wait on this hub for the requests sent to their test URL.
  const handlers = createValidationHttpHandlers({ catalog: () => plugins.registry(), webhooks: WebhookTestHub.shared() });

  return {
    name: 'runflux-validation-runtime',
    configureServer(server) {
      plugins.watch(server);
      server.middlewares.use('/runflux-webhook-cancel', (request, response) => handlers.cancelWebhooks(request, response));
      server.middlewares.use((request, response, next) => {
        if (!handlers.deliverWebhook(request, response)) next();
      });
      server.middlewares.use('/runflux-validate', (request, response) => handlers.validate(request, response));
    },
  };
}
