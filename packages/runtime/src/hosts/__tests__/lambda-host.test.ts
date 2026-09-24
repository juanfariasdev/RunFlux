import { afterEach, describe, expect, it, vi } from 'vitest';
import { LambdaHost, type LambdaEvent } from '../lambda/lambda-host.js';
import { hostEngine, httpTrigger } from './fixtures.js';

afterEach(() => vi.unstubAllEnvs());

const http = (rawPath: string, method: string, extra: Partial<LambdaEvent> = {}): LambdaEvent => ({ rawPath, requestContext: { http: { method } }, ...extra });
const body = (response: { body: string }) => JSON.parse(response.body);

describe('LambdaHost', () => {
  const secured = httpTrigger('orders', { authentication: { type: 'header', headerName: 'X-Orders-Key', secretEnvVar: 'ORDERS_KEY' } });
  const handler = new LambdaHost(hostEngine({ http: [secured, httpTrigger('events', { rawBody: true })], schedules: [{ nodeId: 'nightly', expression: '0 0 * * *', timezone: 'UTC' }] })).handler;

  it('routes function URL requests to their trigger with lower-cased headers and the query', async () => {
    vi.stubEnv('ORDERS_KEY', 'correct');
    const response = await handler(http('/orders', 'POST', { headers: { 'X-Orders-Key': 'correct' }, queryStringParameters: { page: '2' }, body: '{"id":42}' }));
    expect(response.statusCode).toBe(200);
    expect(response.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(body(response)).toMatchObject({ success: true, nodeOutputs: { orders: { body: { id: 42 }, headers: { 'x-orders-key': 'correct' }, query: { page: '2' } } } });
    expect(Object.keys(body(response).nodeOutputs)).toEqual(['orders']);
  });

  it('requires the secret even when its environment variable is absent', async () => {
    vi.stubEnv('ORDERS_KEY', '');
    expect((await handler(http('/orders', 'POST', { headers: {}, body: '{}' }))).statusCode).toBe(401);
  });

  it('decodes base64 raw bodies and treats an empty JSON body as an empty object', async () => {
    const raw = await handler(http('/events', 'POST', { body: Buffer.from('plain text').toString('base64'), isBase64Encoded: true }));
    expect(body(raw).result.body).toBe('plain text');
    vi.stubEnv('ORDERS_KEY', 'k');
    const empty = await handler(http('/orders', 'POST', { headers: { 'x-orders-key': 'k' } }));
    expect(body(empty).result.body).toEqual({});
  });

  it('answers 404, 405 and 400 like the Express host', async () => {
    expect((await handler(http('/missing', 'POST'))).statusCode).toBe(404);
    expect((await handler(http('/events', 'GET'))).statusCode).toBe(405);
    vi.stubEnv('ORDERS_KEY', 'k');
    const invalid = await handler(http('/orders', 'POST', { headers: { 'x-orders-key': 'k' }, body: '{broken' }));
    expect(invalid.statusCode).toBe(400);
    expect(body(invalid)).toEqual({ error: 'Invalid JSON body' });
  });

  it('starts the trigger a schedule names with the event as payload', async () => {
    const response = await handler({ runfluxTriggerId: 'nightly' });
    expect(body(response)).toEqual({ success: true, result: { runfluxTriggerId: 'nightly' }, nodeOutputs: { nightly: { runfluxTriggerId: 'nightly' } } });
  });

  it('answers 500 for invocations naming an unknown trigger', async () => {
    const response = await handler({ runfluxTriggerId: 'ghost' });
    expect(response.statusCode).toBe(500);
    expect(body(response)).toEqual({ success: false, error: 'Unknown node "ghost" in workflow "hosted"' });
  });

  it('runs every trigger with the JSON body when the workflow has no HTTP triggers', async () => {
    const plain = new LambdaHost(hostEngine()).handler;
    expect(body(await plain(http('/', 'POST', { body: '{"id":1}' })))).toEqual({ success: true, result: { id: 1 }, nodeOutputs: { manual: { id: 1 } } });
    expect(body(await plain(http('/', 'POST')))).toMatchObject({ result: {} });
    expect((await plain(http('/', 'POST', { body: 'nope' }))).statusCode).toBe(400);
  });

  it('answers 500 with the execution when a node fails', async () => {
    const failing = new LambdaHost(hostEngine({ http: [httpTrigger('orders')], failing: ['orders'] })).handler;
    const response = await failing(http('/orders', 'POST', { body: '{}' }));
    expect(response.statusCode).toBe(500);
    expect(body(response)).toMatchObject({ success: false, error: 'node failed' });
  });
});
