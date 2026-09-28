import type { Plugin } from 'vite';
import { createValidationHttpHandlers, type WebhookDelivery } from '@runflux/validation-runtime/node';
import { ProjectServerEnvironmentClient } from './project-server-environment-client.ts';
import type { PluginRegistryCache } from './vite-plugin-registry.ts';
import { assertSafeExposure, createAccessGuard, DEFAULT_PLATFORM_SETTINGS, type PlatformSettings } from './vite-platform.ts';

/**
 * Dev-only endpoints of the editor, served from Vite's Node process, where the plugin runtimes are
 * loaded. The handlers come from @runflux/validation-runtime and only need `node:http`:
 * - `POST /runflux-validate` runs a workflow, or one node of it, with the validation runtime. A
 *   client that disconnects cancels its run.
 * - `/runflux-webhook-test/<path>` hands a request to the webhook trigger of a test run waiting on
 *   `<path>`, so curl or a third-party service can drive a test.
 * - `POST /runflux-webhook-cancel` stops every waiting webhook trigger.
 *
 * Test runs read the open project's stored values from the project server (RN-12). With the
 * platform token set, validate and cancel require it; webhook test URLs stay open (RN-14), and a
 * dev server exposed without the token refuses to start (RF-19).
 */
export function runfluxValidationPlugin(plugins: PluginRegistryCache, webhooks: WebhookDelivery, settings: PlatformSettings = DEFAULT_PLATFORM_SETTINGS): Plugin {
  const values = new ProjectServerEnvironmentClient(settings.projectServerUrl, settings.apiToken);
  const guard = createAccessGuard(settings.apiToken);
  // Webhook triggers of test runs wait on this hub for the requests sent to their test URL.
  const handlers = createValidationHttpHandlers({
    catalog: () => plugins.registry(),
    webhooks,
    projectEnvironment: (projectId, signal) => values.environmentOf(projectId, signal),
    ...(settings.apiToken ? { authorize: guard.authorize } : {}),
  });

  return {
    name: 'runflux-validation-runtime',
    configureServer(server) {
      assertSafeExposure(server.config.server.host, settings.apiToken);
      plugins.watch(server);
      server.middlewares.use('/runflux-webhook-cancel', (request, response) => handlers.cancelWebhooks(request, response));
      server.middlewares.use((request, response, next) => {
        if (!handlers.deliverWebhook(request, response)) next();
      });
      server.middlewares.use('/runflux-validate', (request, response) => handlers.validate(request, response));
    },
  };
}
