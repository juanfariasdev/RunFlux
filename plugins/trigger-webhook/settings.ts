import { HTTP_METHODS, type HttpAuthentication, type HttpMethod, type ParameterReader } from '@runflux/runtime';

const AUTHENTICATION_MODES = ['none', 'secret', 'headerAuth'] as const;

export interface WebhookSettings {
  readonly path: string;
  readonly method: HttpMethod | 'ANY';
  readonly authentication: HttpAuthentication;
  readonly rawBody: boolean;
}

/** The webhook path: absolute, without query, fragment or whitespace. */
export function readWebhookPath(parameters: ParameterReader): string {
  const path = parameters.string('path', '/webhook');
  if (!path.startsWith('/') || /[?#\s]/.test(path)) {
    throw parameters.error('path', 'must be an absolute URL path without query or fragment');
  }
  return path;
}

/** How the webhook is exposed. `secret` and `headerAuth` both compare a header with a secret. */
export function readWebhookSettings(parameters: ParameterReader): WebhookSettings {
  const method = parameters.string('httpMethod', 'POST').toUpperCase();
  if (method !== 'ANY' && !(HTTP_METHODS as readonly string[]).includes(method)) {
    throw parameters.error('httpMethod', `"${method}" is not an HTTP method`);
  }
  const mode = parameters.choice('authentication', AUTHENTICATION_MODES, parameters.choice('auth', AUTHENTICATION_MODES, 'none'));
  return {
    path: readWebhookPath(parameters),
    method: method as WebhookSettings['method'],
    authentication: mode === 'none'
      ? { type: 'none' }
      : { type: 'header', headerName: parameters.string('headerName', 'X-Webhook-Secret'), secretEnvVar: parameters.string('secretEnvVar', 'WEBHOOK_SECRET') },
    rawBody: parameters.boolean('rawBody', false),
  };
}
