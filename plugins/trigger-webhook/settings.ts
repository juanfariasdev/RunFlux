import {
  HTTP_METHODS,
  isEnvironmentVariableName,
  isHttpHeaderName,
  normalizeRoutePath,
  type HttpAuthentication,
  type HttpMethod,
  type ParameterReader,
} from '@runflux/runtime';

/** `secret` is the legacy name of `headerAuth`: both compare a header with a secret. */
const AUTHENTICATION_MODES = ['none', 'secret', 'headerAuth'] as const;

export const METHOD_OPTIONS = [...HTTP_METHODS, 'ANY'].map((method) => ({ value: method, label: method === 'ANY' ? 'Any method' : method }));
export const AUTHENTICATION_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'headerAuth', label: 'Header secret' },
];

export interface WebhookSettings {
  readonly path: string;
  readonly method: HttpMethod | 'ANY';
  readonly authentication: HttpAuthentication;
  readonly rawBody: boolean;
}

/** The webhook path in route form (`orders/` becomes `/orders`), without query, fragment or whitespace. */
export function readWebhookPath(parameters: ParameterReader): string {
  const path = parameters.string('path', '/webhook');
  if (/[?#\s]/.test(path)) throw parameters.error('path', 'must be a URL path without query, fragment or whitespace');
  return normalizeRoutePath(path);
}

/** The method the webhook answers, or `ANY`. */
export function readWebhookMethod(parameters: ParameterReader): WebhookSettings['method'] {
  const method = parameters.string('httpMethod', 'POST').toUpperCase();
  if (method !== 'ANY' && !(HTTP_METHODS as readonly string[]).includes(method)) {
    throw parameters.error('httpMethod', `"${method}" is not an HTTP method`);
  }
  return method as WebhookSettings['method'];
}

/** How the webhook is exposed to HTTP clients. */
export function readWebhookSettings(parameters: ParameterReader): WebhookSettings {
  const method = readWebhookMethod(parameters);
  const mode = parameters.choice('authentication', AUTHENTICATION_MODES, parameters.choice('auth', AUTHENTICATION_MODES, 'none'));
  return {
    path: readWebhookPath(parameters),
    method,
    authentication: mode === 'none' ? { type: 'none' } : readHeaderAuthentication(parameters),
    rawBody: parameters.boolean('rawBody', false),
  };
}

function readHeaderAuthentication(parameters: ParameterReader): HttpAuthentication {
  const headerName = parameters.string('headerName', 'X-Webhook-Secret');
  if (!isHttpHeaderName(headerName)) throw parameters.error('headerName', `"${headerName}" is not an HTTP header name`);
  const secretEnvVar = parameters.string('secretEnvVar', 'WEBHOOK_SECRET');
  if (!isEnvironmentVariableName(secretEnvVar)) throw parameters.error('secretEnvVar', `"${secretEnvVar}" is not an environment variable name`);
  return { type: 'header', headerName, secretEnvVar };
}
