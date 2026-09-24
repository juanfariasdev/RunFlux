import { FieldComposer, isRecord, ObjectParameterReader, readFields } from '@runflux/runtime';

/** Where a webhook trigger's test requests go on the editor's dev server. */
export const WEBHOOK_TEST_PREFIX = '/runflux-webhook-test';

/**
 * The body a test request built from a webhook's `sampleBody` carries: its field rows composed
 * the way the trigger composes them, or `{}` while a row is still invalid (e.g. a number field
 * holding text), since the user is still editing it.
 */
export function resolveSampleBodyForTest(sampleBody: unknown): unknown {
  if (!Array.isArray(sampleBody)) return sampleBody || { message: 'Sample test payload' };
  try {
    return new FieldComposer().compose(readFields(new ObjectParameterReader({ sampleBody }, 'trigger-webhook'), 'sampleBody'));
  } catch {
    return {};
  }
}

export interface WebhookTestRequest {
  readonly method: string;
  readonly url: string;
  readonly init: RequestInit;
}

/**
 * The request that reaches a webhook trigger waiting in a test run: its own method (POST for
 * `ANY`), its path, its sample query and, for methods that carry one, its sample body. Test
 * requests are routed by method, like requests to the exported backends.
 */
export function webhookTestRequest(parameters: Readonly<Record<string, unknown>>, origin: string): WebhookTestRequest {
  const configured = typeof parameters.httpMethod === 'string' ? parameters.httpMethod.toUpperCase() : 'POST';
  const method = configured === 'ANY' ? 'POST' : configured;
  const path = typeof parameters.path === 'string' && parameters.path.trim() ? parameters.path.trim() : '/webhook';
  const sampleQuery = isRecord(parameters.sampleQuery) ? parameters.sampleQuery : {};
  const query = new URLSearchParams(Object.entries(sampleQuery).map(([name, value]) => [name, String(value)])).toString();
  const url = `${origin}${WEBHOOK_TEST_PREFIX}${path.startsWith('/') ? path : `/${path}`}${query ? `?${query}` : ''}`;
  const bodyless = method === 'GET' || method === 'HEAD';
  return {
    method,
    url,
    init: bodyless
      ? { method }
      : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(resolveSampleBodyForTest(parameters.sampleBody)) },
  };
}
