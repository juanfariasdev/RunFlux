import { FIELDS_ROW_SCHEMA } from '@runflux/plugin-system/fields-row-schema';
import type { PluginModule } from '@runflux/plugin-system/types';
import { AUTHENTICATION_OPTIONS, METHOD_OPTIONS, readWebhookSettings } from './settings.js';

/**
 * Webhook Trigger: starts the workflow when an HTTP request reaches its path. Exported backends
 * expose the path themselves (Express or a Lambda function URL); the editor waits for a request
 * sent to its test URL.
 */
const HEADER_AUTHENTICATION = { parameter: 'authentication', oneOf: ['headerAuth', 'secret'] };

export const manifest: PluginModule['manifest'] = {
  id: 'trigger-webhook',
  name: 'Webhook Trigger',
  category: 'trigger',
  version: '1.0.0',
  parameters: [
    { name: 'path', label: 'Webhook Path', type: 'string', required: true, default: '/webhook' },
    { name: 'httpMethod', label: 'HTTP Method', type: 'string', required: true, default: 'POST', options: METHOD_OPTIONS },
    // No default: nodes saved before `authentication` existed still use their legacy `auth`.
    { name: 'authentication', label: 'Authentication Mode', type: 'string', required: false, options: AUTHENTICATION_OPTIONS },
    { name: 'headerName', label: 'Header Name', type: 'string', required: false, default: 'X-Webhook-Secret', showWhen: HEADER_AUTHENTICATION },
    { name: 'secretEnvVar', label: 'Secret Environment Variable Name', type: 'string', required: false, default: 'WEBHOOK_SECRET', showWhen: HEADER_AUTHENTICATION },
    { name: 'rawBody', label: 'Accept Any / Raw Body', type: 'boolean', required: false, default: false },
    {
      name: 'sampleBody',
      label: 'Sample Simulation Body (Fallback)',
      type: 'json',
      required: false,
      default: [{ name: 'message', value: 'Sample webhook payload', type: 'string' }],
      rowSchema: FIELDS_ROW_SCHEMA,
    },
    { name: 'sampleHeaders', label: 'Sample Headers', type: 'json', required: false, default: { 'content-type': 'application/json' } },
    { name: 'sampleQuery', label: 'Sample Query Params', type: 'json', required: false, default: {} },
  ],
  supportedPlatforms: ['local', 'aws'],
  outputs: ['main'],
};

export const runtimeModule = new URL('./runtime.ts', import.meta.url);

export const deployment: PluginModule['deployment'] = {
  triggers: (parameters) => [{ kind: 'http', ...readWebhookSettings(parameters) }],
  environment: (parameters) => {
    const { authentication } = readWebhookSettings(parameters);
    return authentication.type === 'header' ? [{ key: authentication.secretEnvVar, description: `Secret expected in ${authentication.headerName}` }] : [];
  },
};
